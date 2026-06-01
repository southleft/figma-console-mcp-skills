#!/usr/bin/env node
// figma-scan-code-accessibility — axe-core + JSDOM scan of an HTML string/file.
//
// Standalone Node script. NO Figma connection. Run:
//   cd scripts && npm install
//   node scan.mjs path/to/component.html
//   node scan.mjs --html '<button>Save</button>' --tags wcag22aa --map-to-codespec
//
// Visual rules (color-contrast, focus-visible, link-in-text-block, target-size) are DISABLED
// because JSDOM has no layout/computed styles — use figma-lint-design for visual a11y.

import { readFileSync } from "node:fs";

// ---- Parse CLI args ----
function parseArgs(argv) {
  const opts = { tags: [], context: null, includePassing: false, mapToCodeSpec: false, html: null, file: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--html") opts.html = argv[++i];
    else if (a === "--tags") opts.tags.push(...String(argv[++i] || "").split(",").map((t) => t.trim()).filter(Boolean));
    else if (a === "--context") opts.context = argv[++i];
    else if (a === "--include-passing") opts.includePassing = true;
    else if (a === "--map-to-codespec") opts.mapToCodeSpec = true;
    else if (!a.startsWith("--") && !opts.file && opts.html === null) opts.file = a;
  }
  return opts;
}

async function loadDeps() {
  try {
    let axeCore = await import("axe-core");
    if (axeCore.default) axeCore = axeCore.default;
    const { JSDOM } = await import("jsdom");
    return { axeCore, JSDOM };
  } catch (e) {
    throw new Error("axe-core or jsdom not installed. Run: cd scripts && npm install\n" + e.message);
  }
}

async function scanHtmlWithAxe(html, { axeCore, JSDOM }, options = {}) {
  const fullHtml = html.includes("<html") || html.includes("<!DOCTYPE")
    ? html
    : `<!DOCTYPE html><html lang="en"><head><title>Scan</title></head><body>${html}</body></html>`;

  const dom = new JSDOM(fullHtml, { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost" });
  const { document, window } = dom.window;

  const scriptEl = document.createElement("script");
  scriptEl.textContent = axeCore.source;
  document.head.appendChild(scriptEl);

  const runOptions = {};
  if (options.tags && options.tags.length > 0) runOptions.runOnly = { type: "tag", values: options.tags };

  // Disable rules that require visual rendering (always fail/incomplete in JSDOM).
  if (options.disableVisualRules !== false) {
    runOptions.rules = {
      "color-contrast": { enabled: false },
      "color-contrast-enhanced": { enabled: false },
      "link-in-text-block": { enabled: false },
      "target-size": { enabled: false },
    };
  }

  const context = options.context || document;
  try {
    const results = await window.axe.run(context, runOptions);
    dom.window.close();
    return results;
  } catch (err) {
    dom.window.close();
    throw new Error("axe-core scan failed: " + err.message);
  }
}

function formatAxeResults(axeResults) {
  const categories = [];
  const sevByImpact = { critical: "critical", serious: "critical", moderate: "warning", minor: "info" };

  for (const v of axeResults.violations || []) {
    const severity = sevByImpact[v.impact] || "warning";
    const nodes = v.nodes.map((n) => ({
      html: n.html ? n.html.substring(0, 200) : undefined,
      target: n.target,
      failureSummary: n.failureSummary ? n.failureSummary.substring(0, 300) : undefined,
    }));
    categories.push({
      rule: v.id,
      severity,
      count: v.nodes.length,
      description: v.help,
      wcagTags: v.tags.filter((t) => t.startsWith("wcag") || t.startsWith("best-practice")),
      helpUrl: v.helpUrl,
      nodes: nodes.slice(0, 10),
    });
  }

  const sevOrder = { critical: 0, warning: 1, info: 2 };
  categories.sort((a, b) => (sevOrder[a.severity] !== sevOrder[b.severity] ? sevOrder[a.severity] - sevOrder[b.severity] : b.count - a.count));

  const summary = { critical: 0, warning: 0, info: 0, total: 0 };
  for (const c of categories) { summary[c.severity] += c.count; summary.total += c.count; }

  return {
    engine: "axe-core",
    version: (axeResults.testEngine && axeResults.testEngine.version) || "unknown",
    mode: "jsdom-structural",
    note: "JSDOM mode: structural/semantic checks only. Visual rules (color contrast, focus visibility, target size) are disabled — use figma-lint-design for visual accessibility checks.",
    categories,
    summary,
    passes: (axeResults.passes || []).length,
    incomplete: (axeResults.incomplete || []).length,
    inapplicable: (axeResults.inapplicable || []).length,
  };
}

// Lightweight regex extraction of a CodeSpec.accessibility object from the HTML + axe results.
function axeResultsToCodeSpec(html, axeResults) {
  const spec = {};
  const lower = html.toLowerCase();

  const rootEl = html.match(/<(button|a|input|select|textarea|details|dialog|nav|main|form|label|fieldset)\b/i);
  if (rootEl) spec.semanticElement = rootEl[1].toLowerCase();
  else {
    const first = html.match(/<(\w+)[\s>]/);
    spec.semanticElement = first && !["div", "span", "html", "head", "body", "script", "style", "!doctype"].includes(first[1].toLowerCase()) ? first[1].toLowerCase() : "div";
  }

  const role = html.match(/role=["']([^"']+)["']/i); if (role) spec.role = role[1];
  const label = html.match(/aria-label=["']([^"']+)["']/i); if (label) spec.ariaLabel = label[1];

  const nativeFocus = ["button", "a", "input", "select", "textarea"];
  spec.focusVisible = /focus-visible|:focus\b|outline.*focus|ring.*focus|focus.*ring/i.test(html) || nativeFocus.includes(spec.semanticElement || "");

  if (/\bdisabled\b|aria-disabled/i.test(lower)) spec.supportsDisabled = true;
  if (/aria-invalid|aria-errormessage|aria-describedby.*error/i.test(lower)) spec.supportsError = true;

  if (/aria-required=["']true["']|required(?!=)/i.test(html)) spec.ariaRequired = true;
  else if (/aria-required=["']false["']/i.test(html)) spec.ariaRequired = false;

  const keys = [];
  if (spec.semanticElement === "button" || spec.role === "button") keys.push("Enter", "Space");
  else if (spec.semanticElement === "a" || spec.role === "link") keys.push("Enter");
  else if (spec.semanticElement === "input" || spec.semanticElement === "textarea") keys.push("Tab (focus)", "Type (input)");
  else if (spec.semanticElement === "select" || spec.role === "listbox") keys.push("Arrow keys", "Enter", "Space");
  else if (spec.role === "checkbox" || spec.role === "switch") keys.push("Space");
  else if (spec.role === "tab") keys.push("Arrow keys");
  if (/onkeydown|onkeyup|onkeypress|@keydown|@keyup|v-on:keydown/i.test(html) && !keys.includes("Custom key handler")) keys.push("Custom key handler");
  if (keys.length) spec.keyboardInteractions = keys;

  for (const v of (axeResults.violations || [])) {
    if (v.id === "button-name" || v.id === "label") spec.ariaLabel = undefined;
  }
  return spec;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  let html = opts.html;
  if (html === null) {
    if (!opts.file) {
      console.error("Usage: node scan.mjs <file.html> | --html '<markup>' [--tags wcag22aa] [--context '#sel'] [--include-passing] [--map-to-codespec]");
      process.exit(2);
    }
    html = readFileSync(opts.file, "utf8");
  }

  let deps;
  try { deps = await loadDeps(); }
  catch (e) { console.error(JSON.stringify({ error: e.message, hint: "Install dependencies: cd scripts && npm install" }, null, 2)); process.exit(1); }

  try {
    const axeResults = await scanHtmlWithAxe(html, deps, { tags: opts.tags, context: opts.context || undefined });
    const formatted = formatAxeResults(axeResults);
    if (!opts.includePassing) { delete formatted.passes; delete formatted.incomplete; delete formatted.inapplicable; }
    if (opts.mapToCodeSpec) {
      formatted.codeSpecAccessibility = axeResultsToCodeSpec(html, axeResults);
      formatted.codeSpecAccessibility._usage = "Pass this object as codeSpec.accessibility in figma-check-design-parity for automated a11y parity checking.";
    }
    console.log(JSON.stringify(formatted, null, 2));
  } catch (e) {
    console.error(JSON.stringify({ error: e.message, hint: "Check that the HTML is valid. For visual accessibility checks, use figma-lint-design instead." }, null, 2));
    process.exit(1);
  }
}

main();
