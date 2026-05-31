#!/usr/bin/env node
// figma-export-tokens — DETERMINISTIC token converter.
//
// Ports the Figma Console MCP's formatter logic (src/core/tokens/*) so output is
// tested code, not freehanded by the model. Turns the JSON from read-variables.js
// into DTCG / CSS custom properties / Tailwind v4 / SCSS / TS / JSON.
//
// USAGE
//   node convert-tokens.mjs <variables.json> --format <fmt> [--out <dir>] [--prefix <p>]
//   cat variables.json | node convert-tokens.mjs --format css
//
//   <variables.json>  the object returned by scripts/read-variables.js  ({ collections: [...] }).
//                     Save the use_figma result to a file, or pipe it on stdin.
//   --format          dtcg (default) | css | tailwind | scss | ts | json-nested | json-flat
//   --out <dir>       write the file(s) into <dir>; otherwise prints to stdout
//   --prefix <p>      prefix for CSS var / SCSS names (e.g. "cbds-")
//
// WHY THIS EXISTS: the conversion has real edge cases — per-type units (opacity is
// unitless, spacing is px), multi-collection theming (one :root + .dark, not two :root),
// alias→var(), and slug collisions. Doing it in tested code makes the output deterministic
// and repeatable. Node 18+, zero dependencies.

import fs from 'node:fs';
import path from 'node:path';

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flags = {};
const positionals = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const next = argv[i + 1];
    flags[a.slice(2)] = next && !next.startsWith('--') ? argv[++i] : true;
  } else positionals.push(a);
}
const FORMAT = String(flags.format || 'dtcg').toLowerCase();
const OUT_DIR = typeof flags.out === 'string' ? flags.out : null;
const PREFIX = typeof flags.prefix === 'string' ? flags.prefix : '';

// ── input ─────────────────────────────────────────────────────────────────────
let raw;
try {
  raw = positionals[0] ? fs.readFileSync(positionals[0], 'utf8') : fs.readFileSync(0, 'utf8');
} catch (e) {
  console.error('Could not read input. Pass a file path or pipe JSON on stdin.\n' + e.message);
  process.exit(1);
}
let data;
try { data = JSON.parse(raw); } catch (e) { console.error('Input is not valid JSON: ' + e.message); process.exit(1); }
const collections = data.collections || (Array.isArray(data) ? data : null);
if (!collections) { console.error('Input has no `collections` — expected the output of read-variables.js.'); process.exit(1); }

const warnings = [];

// ── helpers (ported from src/core/tokens) ──────────────────────────────────────
function slugify(s) {
  return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function pathToCssName(segs) { return segs.map(slugify).join('-'); }

// Figma resolvedType + variable name → DTCG-ish type. (ports mapResolvedType/inferFloatType/inferStringType)
function mapType(figmaType, name) {
  const l = String(name).toLowerCase();
  if (figmaType === 'COLOR') return 'color';
  if (figmaType === 'BOOLEAN') return 'boolean';
  if (figmaType === 'STRING') {
    if (l.includes('font-family') || l.includes('font/family')) return 'fontFamily';
    // Figma sometimes models weights as STRING style names ("Bold"). Treat as fontWeight
    // so they map to numeric CSS weights instead of emitting an invalid bare word.
    if (l.includes('font-weight') || l.includes('weight')) return 'fontWeight';
    return 'string';
  }
  // FLOAT
  if (l.includes('opacity') || l.includes('alpha')) return 'number';
  if (l.includes('font-weight') || l.includes('weight')) return 'fontWeight';
  if (l.includes('duration') || l.includes('delay')) return 'duration';
  return 'dimension';
}

const WEIGHT_NAMES = {
  thin: 100, hairline: 100, extralight: 200, 'extra light': 200, ultralight: 200, 'ultra light': 200,
  light: 300, normal: 400, regular: 400, book: 400, medium: 500,
  semibold: 600, 'semi bold': 600, demibold: 600, 'demi bold': 600,
  bold: 700, extrabold: 800, 'extra bold': 800, ultrabold: 800, black: 900, heavy: 900,
};
function needsQuoting(s) { return /[^a-zA-Z0-9_-]/.test(s); }

// ── normalize into a flat token list ───────────────────────────────────────────
const tokens = [];
const allModeNames = [];
const seenMode = new Set();
for (const col of collections) {
  const modeNames = (col.modes || []).map((m) => m.name);
  const sole = modeNames.length <= 1;
  for (const mn of modeNames) if (!seenMode.has(mn)) { seenMode.add(mn); allModeNames.push(mn); }
  for (const v of (col.variables || [])) {
    tokens.push({
      collection: col.name,
      path: String(v.name).split('/'),
      name: v.name,
      type: mapType(v.type, v.name),
      figmaType: v.type,
      scopes: v.scopes || [],
      valuesByMode: v.valuesByMode || {},
      modeNames,
      sole,
      id: v.id || null,
      key: v.key || null,
      description: v.description || '',
    });
  }
}

// slug-collision detection
const byCss = {};
for (const t of tokens) { const c = pathToCssName(t.path); (byCss[c] = byCss[c] || []).push(t.name); }
for (const [c, names] of Object.entries(byCss)) {
  const uniq = [...new Set(names)];
  if (uniq.length > 1) warnings.push(`Slug collision on --${c}: ${uniq.join(', ')} all slug to the same name (last write wins). Rename to disambiguate.`);
}

function pickPrimaryMode(t) {
  const modes = Object.keys(t.valuesByMode);
  const pref = modes.find((m) => ['light', 'default', 'value', 'base'].includes(m.trim().toLowerCase()));
  return pref || t.modeNames.find((m) => m in t.valuesByMode) || modes[0];
}
function isAlias(v) { return v && typeof v === 'object' && typeof v.reference === 'string'; }

// ── CSS value formatting (ports formatCssValue) ─────────────────────────────────
function cssLiteral(value, type) {
  if (typeof value === 'number') return type === 'dimension' ? `${value}px` : String(value);
  if (typeof value === 'string') {
    if (type === 'color') return value;
    if (type === 'fontWeight') {
      const w = WEIGHT_NAMES[value.trim().toLowerCase()];
      if (w) return String(w);
      warnings.push(`Font weight "${value}" isn't numeric — emitted as a string. Use 100–900 in Figma for valid CSS.`);
      return needsQuoting(value) ? JSON.stringify(value) : value;
    }
    if (type === 'fontFamily' || type === 'string') return needsQuoting(value) ? JSON.stringify(value) : value;
    return value;
  }
  if (typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

// ── CSS custom properties (ports renderMultiSelector / selectorFor / emitTokenLines) ─
function selectorFor(mode, sole) {
  const l = String(mode).trim().toLowerCase();
  if (sole || ['', 'default', 'light', 'value', 'base', 'mode 1', 'mode1'].includes(l)) return ':root';
  if (l === 'dark') return '.dark';
  return `[data-theme="${slugify(mode)}"]`;
}
function emitCss() {
  const sel2lines = {};
  const order = [];
  for (const mode of allModeNames) {
    for (const t of tokens) {
      if (!t.modeNames.includes(mode)) continue;
      const val = t.valuesByMode[mode];
      if (val === undefined || val === null) continue;
      const sel = selectorFor(mode, t.sole);
      if (!sel2lines[sel]) { sel2lines[sel] = []; order.push(sel); }
      const cssName = `--${PREFIX}${pathToCssName(t.path)}`;
      if (isAlias(val)) {
        const bare = val.reference.replace(/^\{|\}$/g, '');
        if (bare.startsWith('__library:') || bare === 'unknown') {
          warnings.push(`${t.name}: cross-library/unresolved alias — emitted as a comment in CSS.`);
          sel2lines[sel].push(`  /* ${cssName}: skipped — unresolved alias */`);
        } else {
          sel2lines[sel].push(`  ${cssName}: var(--${PREFIX}${pathToCssName(bare.split('.'))});`);
        }
      } else {
        sel2lines[sel].push(`  ${cssName}: ${cssLiteral(val, t.type)};`);
      }
    }
  }
  const sels = [...new Set(order)].sort((a, b) => (a === ':root' ? -1 : b === ':root' ? 1 : 0));
  const out = ['/* Generated by figma-console-mcp-skills convert-tokens — do not edit by hand */', ''];
  for (const sel of sels) { out.push(`${sel} {`, ...sel2lines[sel], '}', ''); }
  return out.join('\n');
}

// ── DTCG (ports formatDtcg) ─────────────────────────────────────────────────────
function dtcgType(type) {
  return ({ color: 'color', dimension: 'dimension', number: 'number', fontWeight: 'fontWeight', fontFamily: 'fontFamily', duration: 'duration', string: 'string', boolean: 'boolean' })[type] || 'string';
}
function dtcgEncode(value, type) {
  if (isAlias(value)) return value.reference; // "{Group.Token}"
  if (type === 'fontWeight' && typeof value === 'string') { const w = WEIGHT_NAMES[value.trim().toLowerCase()]; if (w) return w; }
  return value;
}
function sortKeys(node) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return node;
  const out = {};
  for (const k of Object.keys(node).sort((a, b) => {
    const ad = a.startsWith('$'), bd = b.startsWith('$');
    if (ad && !bd) return -1; if (!ad && bd) return 1; return a.localeCompare(b);
  })) out[k] = sortKeys(node[k]);
  return out;
}
function emitDtcg() {
  const tree = {};
  for (const t of tokens) {
    let cur = tree;
    for (let i = 0; i < t.path.length - 1; i++) {
      const seg = t.path[i];
      if (!cur[seg] || ('$value' in cur[seg])) cur[seg] = cur[seg] && !('$value' in cur[seg]) ? cur[seg] : {};
      cur = cur[seg];
    }
    const leafKey = t.path[t.path.length - 1];
    const primary = pickPrimaryMode(t);
    const leaf = { $type: dtcgType(t.type), $value: dtcgEncode(t.valuesByMode[primary], t.type) };
    if (t.description) leaf.$description = t.description;
    const others = {};
    for (const m of Object.keys(t.valuesByMode)) if (m !== primary) others[m] = dtcgEncode(t.valuesByMode[m], t.type);
    const ext = {};
    if (Object.keys(others).length) ext.modes = others;
    if (t.id) ext.variableId = t.id;
    if (t.key) ext.key = t.key;
    if (Object.keys(ext).length) leaf.$extensions = { 'figma-console-mcp': ext };
    cur[leafKey] = leaf;
  }
  return JSON.stringify(sortKeys(tree), null, 2) + '\n';
}

// ── Tailwind v4 (@theme) ────────────────────────────────────────────────────────
function twVar(t) {
  const ns = (() => {
    if (t.type === 'color') return 'color';
    if (t.type === 'fontFamily') return 'font';
    if (t.type === 'fontWeight') return 'font-weight';
    if (t.type === 'duration') return null; // no standard @theme namespace
    if (t.type === 'dimension') {
      const n = t.name.toLowerCase();
      if (n.includes('radius')) return 'radius';
      if (n.includes('font-size') || n.includes('/text') || n.includes('text-')) return 'text';
      if (n.includes('lead') || n.includes('line-height')) return 'leading';
      if (n.includes('track') || n.includes('letter')) return 'tracking';
      return 'spacing';
    }
    return null;
  })();
  if (!ns) return null;
  // strip a leading path segment that duplicates the namespace category
  let segs = t.path.map(slugify);
  const catWords = { color: ['color', 'colors'], spacing: ['spacing', 'space'], radius: ['radius', 'border-radius', 'corner-radius'], text: ['font-size', 'text', 'size'], font: ['font', 'font-family'], 'font-weight': ['font-weight', 'weight'], leading: ['line-height', 'leading'], tracking: ['letter-spacing', 'tracking'] };
  while (segs.length > 1 && (catWords[ns] || []).includes(segs[0])) segs = segs.slice(1);
  return `--${ns}-${segs.join('-')}`;
}
function emitTailwind() {
  const lines = ['/* Generated by figma-console-mcp-skills convert-tokens (Tailwind v4 @theme). */', '/* Base mode only; theme other modes with CSS (.dark { ... }) — see the css format. */', '@theme {'];
  const skipped = [];
  for (const t of tokens) {
    const primary = pickPrimaryMode(t);
    const val = t.valuesByMode[primary];
    if (val === undefined || val === null) continue;
    const name = twVar(t);
    if (!name) { skipped.push(t.name); continue; }
    if (isAlias(val)) { lines.push(`  ${name}: var(--${PREFIX}${pathToCssName(val.reference.replace(/^\{|\}$/g, '').split('.'))});`); continue; }
    lines.push(`  ${name}: ${cssLiteral(val, t.type)};`);
  }
  lines.push('}', '');
  if (skipped.length) warnings.push(`Tailwind: ${skipped.length} token(s) have no @theme namespace (e.g. durations/booleans) — omitted: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '…' : ''}`);
  return lines.join('\n');
}

// ── SCSS (base mode) ────────────────────────────────────────────────────────────
function emitScss() {
  const out = ['// Generated by figma-console-mcp-skills convert-tokens.', '// SCSS is compile-time: this emits the base mode. Theme other modes via CSS custom properties (see the css format).', ''];
  for (const t of tokens) {
    const primary = pickPrimaryMode(t);
    const val = t.valuesByMode[primary];
    if (val === undefined || val === null) continue;
    const name = `$${PREFIX}${pathToCssName(t.path)}`;
    if (isAlias(val)) { out.push(`${name}: $${PREFIX}${pathToCssName(val.reference.replace(/^\{|\}$/g, '').split('.'))};`); continue; }
    out.push(`${name}: ${cssLiteral(val, t.type)};`);
  }
  out.push('');
  return out.join('\n');
}

// ── nested object (TS / JSON) ───────────────────────────────────────────────────
function buildNested(resolveAliases) {
  const tree = {};
  for (const t of tokens) {
    let cur = tree;
    for (let i = 0; i < t.path.length - 1; i++) { const s = t.path[i]; if (typeof cur[s] !== 'object' || cur[s] === null) cur[s] = {}; cur = cur[s]; }
    const primary = pickPrimaryMode(t);
    let val = t.valuesByMode[primary];
    if (isAlias(val)) val = resolveAliases ? `var(--${PREFIX}${pathToCssName(val.reference.replace(/^\{|\}$/g, '').split('.'))})` : val.reference;
    else if (typeof val === 'number' && t.type === 'dimension') val = `${val}px`;
    else if (t.type === 'fontWeight' && typeof val === 'string') { const w = WEIGHT_NAMES[val.trim().toLowerCase()]; if (w) val = w; }
    cur[t.path[t.path.length - 1]] = val;
  }
  return tree;
}
function emitTs() {
  return '// Generated by figma-console-mcp-skills convert-tokens (base mode).\nexport const tokens = ' + JSON.stringify(buildNested(true), null, 2) + ' as const;\n';
}
function emitJsonNested() { return JSON.stringify(buildNested(false), null, 2) + '\n'; }
function emitJsonFlat() {
  const flat = {};
  for (const t of tokens) {
    const primary = pickPrimaryMode(t);
    let val = t.valuesByMode[primary];
    if (isAlias(val)) val = val.reference;
    else if (typeof val === 'number' && t.type === 'dimension') val = `${val}px`;
    else if (t.type === 'fontWeight' && typeof val === 'string') { const w = WEIGHT_NAMES[val.trim().toLowerCase()]; if (w) val = w; }
    flat[t.path.join('.')] = val;
  }
  return JSON.stringify(flat, null, 2) + '\n';
}

// ── dispatch ────────────────────────────────────────────────────────────────────
const EMITTERS = {
  dtcg: { fn: emitDtcg, file: 'tokens.tokens.json' },
  css: { fn: emitCss, file: 'tokens.css' },
  tailwind: { fn: emitTailwind, file: 'theme.css' },
  scss: { fn: emitScss, file: '_tokens.scss' },
  ts: { fn: emitTs, file: 'tokens.ts' },
  'json-nested': { fn: emitJsonNested, file: 'tokens.json' },
  'json-flat': { fn: emitJsonFlat, file: 'tokens.flat.json' },
};
const emitter = EMITTERS[FORMAT];
if (!emitter) { console.error(`Unknown --format "${FORMAT}". Use: ${Object.keys(EMITTERS).join(', ')}`); process.exit(1); }

const content = emitter.fn();
if (OUT_DIR) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, emitter.file);
  fs.writeFileSync(outPath, content);
  console.error(`Wrote ${outPath}  (${tokens.length} tokens, format=${FORMAT})`);
} else {
  process.stdout.write(content);
}
if (warnings.length) {
  console.error(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.error('  ⚠ ' + w);
}
