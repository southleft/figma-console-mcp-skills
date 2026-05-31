// figma-audit-accessibility — deep a11y scorecard for one component / component set.
//
// Run via the native Figma MCP `use_figma` tool (pass skillNames: "figma-audit-accessibility").
// Plain JS, top-level await, returns JSON. Works on ANY Figma plan (Plugin API only).
// See the official figma-use skill and ../references/audit-categories.md.

// ---- Inputs (edit these) ----
const NODE_ID = null;     // COMPONENT_SET / COMPONENT / INSTANCE id, or null to use the current selection
const TARGET_SIZE = 24;   // WCAG 2.5.8 minimum tap target in px (pass 44 or 48 for mobile)

// ---- Color science ----
function linearize(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function luminance(r, g, b) { return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b); }
function contrastRatio(r1, g1, b1, r2, g2, b2) {
  const l1 = luminance(r1, g1, b1), l2 = luminance(r2, g2, b2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function rgbToHex(r, g, b) { const h = (n) => Math.round(n * 255).toString(16).padStart(2, '0').toUpperCase(); return '#' + h(r) + h(g) + h(b); }

// ---- Color-blind simulation (Brettel/Viénot dichromat matrices) ----
const colorBlindMatrices = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]]
};
function simulateColorBlind(r, g, b, m) {
  const clamp = (v) => Math.max(0, Math.min(1, v));
  return { r: clamp(m[0][0] * r + m[0][1] * g + m[0][2] * b), g: clamp(m[1][0] * r + m[1][1] * g + m[1][2] * b), b: clamp(m[2][0] * r + m[2][1] * g + m[2][2] * b) };
}

// ---- Node inspection ----
function getFillColor(node) {
  try { const f = node.fills; if (f && f.length) for (let i = f.length - 1; i >= 0; i--) if (f[i].type === 'SOLID' && f[i].visible !== false) return { r: f[i].color.r, g: f[i].color.g, b: f[i].color.b }; } catch (e) {}
  return null;
}
function getStrokeColor(node) {
  try { const s = node.strokes; if (s && s.length) for (let i = s.length - 1; i >= 0; i--) if (s[i].type === 'SOLID' && s[i].visible !== false) return { r: s[i].color.r, g: s[i].color.g, b: s[i].color.b }; } catch (e) {}
  return null;
}
function getEffectiveBg(node) {
  let cur = node.parent;
  while (cur) {
    try { if (cur.fills && cur.fills.length) for (let i = cur.fills.length - 1; i >= 0; i--) { const f = cur.fills[i]; if (f.type === 'SOLID' && f.visible !== false) return { r: f.color.r, g: f.color.g, b: f.color.b }; } } catch (e) {}
    cur = cur.parent;
  }
  return { r: 1, g: 1, b: 1 };
}
function hasChildOfType(node, types) {
  try {
    for (const child of (('children' in node && node.children) || [])) {
      try {
        if (types.includes(child.type)) return true;
        for (const gc of (('children' in child && child.children) || [])) if (types.includes(gc.type)) return true;
      } catch (e) {}
    }
  } catch (e) {}
  return false;
}
function collectColorPairs(node, pairs, depth) {
  if (depth > 5) return;
  try {
    if (node.type === 'TEXT') for (const f of (node.fills || [])) if (f.type === 'SOLID' && f.visible !== false) { pairs.push({ fg: { r: f.color.r, g: f.color.g, b: f.color.b }, bg: getEffectiveBg(node), nodeName: node.name, nodeId: node.id }); break; }
    for (const c of (('children' in node && node.children) || [])) collectColorPairs(c, pairs, depth + 1);
  } catch (e) {}
}

// ---- Resolve target → component set / component ----
let targetNode = NODE_ID ? await figma.getNodeByIdAsync(NODE_ID) : null;
if (!targetNode) {
  const sel = figma.currentPage.selection;
  if (sel && sel.length === 1) targetNode = sel[0];
  else throw new Error('No NODE_ID provided and no single node selected. Select a component set or set NODE_ID.');
}
let componentSet = targetNode;
if (targetNode.type === 'COMPONENT' && targetNode.parent && targetNode.parent.type === 'COMPONENT_SET') componentSet = targetNode.parent;
else if (targetNode.type === 'INSTANCE') {
  try { const mc = await targetNode.getMainComponentAsync(); if (mc && mc.parent && mc.parent.type === 'COMPONENT_SET') componentSet = mc.parent; else if (mc && mc.type === 'COMPONENT') componentSet = mc; } catch (e) {}
}
const isComponentSet = componentSet.type === 'COMPONENT_SET';
const isComponent = componentSet.type === 'COMPONENT';
if (!isComponentSet && !isComponent) throw new Error('Node "' + componentSet.name + '" is type ' + componentSet.type + '. Expected COMPONENT_SET or COMPONENT.');

const variants = isComponentSet ? componentSet.children : [componentSet];
const variantCount = variants.length;

// ---- Classify interactive vs presentational ----
const interactiveNames = /^(button|link|input|checkbox|radio|switch|toggle|tab|select|slider|dropdown|menu-item|search|combobox|listbox)/i;
const presentationalNames = /^(alert|badge|card|avatar|divider|skeleton|tooltip|tag|chip|banner|callout|notification|toast|icon|image|separator|progress|spinner|loader|breadcrumb|label|heading|paragraph|caption|stat|meter|indicator)/i;

const variantAxes = {};
let hasStateAxis = false;
for (const v of variants) {
  for (const part of v.name.split(',')) {
    const kv = part.trim().split('=');
    if (kv.length === 2) {
      const axis = kv[0].trim().toLowerCase(), val = kv[1].trim().toLowerCase();
      if (!variantAxes[axis]) variantAxes[axis] = [];
      if (!variantAxes[axis].includes(val)) variantAxes[axis].push(val);
      if (axis === 'state' && /(hover|focus|pressed|disabled|active)/i.test(val)) hasStateAxis = true;
    }
  }
}
const componentName = componentSet.name || '';
let isInteractive = interactiveNames.test(componentName) || hasStateAxis;
let isPresentational = !isInteractive && (presentationalNames.test(componentName) || !hasStateAxis);
if (!isInteractive && !isPresentational) {
  for (const v of variants) if (/(hover|focus|pressed|disabled)/i.test(v.name)) { isInteractive = true; break; }
  if (!isInteractive) isPresentational = true;
}

// ---- 1. Coverage ----
const stateKeywords = {
  default: /(default|rest|idle|normal|base)/i, hover: /(hover|hovered)/i, focus: /(focus|focused)/i,
  disabled: /(disabled|inactive)/i, error: /(error|invalid|danger)/i, active: /(active|pressed|selected)/i, loading: /(loading|spinner)/i
};
let coveredCount = 0, totalStates = 0;
const missingStates = [], statesCovered = {}, statesFound = {};
let variantAxisCoverage = null;
if (isInteractive) {
  for (const sk in stateKeywords) { statesCovered[sk] = false; statesFound[sk] = null; }
  for (const v of variants) for (const sk in stateKeywords) if (stateKeywords[sk].test(v.name)) { statesCovered[sk] = true; if (!statesFound[sk]) statesFound[sk] = v.name; }
  if (variantCount === 1 && !statesCovered.default) { statesCovered.default = true; statesFound.default = variants[0].name; }
  for (const sk in statesCovered) { totalStates++; if (statesCovered[sk]) coveredCount++; else missingStates.push(sk); }
} else {
  let expected = 1;
  for (const ax in variantAxes) expected *= variantAxes[ax].length;
  const ratio = expected > 0 ? Math.min(1, variantCount / expected) : 1;
  coveredCount = variantCount; totalStates = expected;
  variantAxisCoverage = { axes: variantAxes, axisCount: Object.keys(variantAxes).length, expectedCombinations: expected, actualVariants: variantCount, completeness: Math.round(ratio * 100) + '%' };
  if (variantCount < expected) missingStates.push(variantCount + '/' + expected + ' axis combinations present');
}

// default variant for comparison
let defaultVariant = null;
for (let d = 0; d < variants.length; d++) if (/(default|rest|idle|normal|base)/i.test(variants[d].name) || d === 0) { defaultVariant = variants[d]; break; }

// ---- 2. Focus indicator ----
const focusAnalysis = { hasVariant: false, hasVisibleIndicator: false, contrastRatio: null, details: '' };
if (statesCovered.focus && isComponentSet) {
  focusAnalysis.hasVariant = true;
  for (const v of variants) {
    if (/(focus|focused)/i.test(v.name)) {
      const fs = getStrokeColor(v);
      if (fs) { const bg = getEffectiveBg(v); const r = contrastRatio(fs.r, fs.g, fs.b, bg.r, bg.g, bg.b); focusAnalysis.hasVisibleIndicator = true; focusAnalysis.contrastRatio = parseFloat(r.toFixed(1)); focusAnalysis.details = 'Focus ring (stroke) with ' + r.toFixed(1) + ':1 contrast'; break; }
      try { for (const e of (v.effects || [])) if (e.visible !== false && (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW')) { focusAnalysis.hasVisibleIndicator = true; focusAnalysis.details = 'Focus indicator via ' + e.type.toLowerCase().replace('_', ' '); break; } } catch (e) {}
      if (!focusAnalysis.hasVisibleIndicator) focusAnalysis.details = 'Focus variant exists but no visible stroke or shadow detected';
      break;
    }
  }
} else if (!statesCovered.focus) focusAnalysis.details = 'No focus/focused variant found';

// ---- 3. Non-color differentiation ----
const colorDifferentiation = { issues: [], checked: 0 };
if (isComponentSet) {
  for (const stateName of ['error', 'disabled', 'active']) {
    if (statesCovered[stateName]) {
      colorDifferentiation.checked++;
      for (const v of variants) {
        if (stateKeywords[stateName].test(v.name)) {
          const sf = getFillColor(v), df = defaultVariant ? getFillColor(defaultVariant) : null;
          const hasIcon = hasChildOfType(v, ['VECTOR', 'BOOLEAN_OPERATION', 'INSTANCE']);
          const hasStroke = getStrokeColor(v) !== null;
          const colorDiffers = sf && df && (sf.r !== df.r || sf.g !== df.g || sf.b !== df.b);
          if (colorDiffers && !hasIcon && !hasStroke)
            colorDifferentiation.issues.push({ variant: v.name, state: stateName, variantColor: rgbToHex(sf.r, sf.g, sf.b), defaultColor: df ? rgbToHex(df.r, df.g, df.b) : null, suggestion: 'Add icon, border, or text indicator beyond color' });
          break;
        }
      }
    }
  }
}

// ---- 4. Target size ----
const targetSizeAnalysis = { minWidth: Infinity, minHeight: Infinity, variants: [], issues: [] };
for (const v of variants) {
  try {
    const w = v.width, h = v.height;
    if (typeof w === 'number' && typeof h === 'number') {
      targetSizeAnalysis.variants.push({ name: v.name, width: w, height: h });
      if (w < targetSizeAnalysis.minWidth) targetSizeAnalysis.minWidth = w;
      if (h < targetSizeAnalysis.minHeight) targetSizeAnalysis.minHeight = h;
      if (isInteractive && (w < TARGET_SIZE || h < TARGET_SIZE)) targetSizeAnalysis.issues.push({ variant: v.name, width: w, height: h, required: TARGET_SIZE + 'x' + TARGET_SIZE });
    }
  } catch (e) {}
}
if (targetSizeAnalysis.minWidth === Infinity) targetSizeAnalysis.minWidth = null;
if (targetSizeAnalysis.minHeight === Infinity) targetSizeAnalysis.minHeight = null;

// ---- 5. Annotations ----
const annotations = { hasDescription: false, description: '', hasA11yNotes: false, a11yNotes: '' };
try {
  const desc = componentSet.description || '';
  if (desc.trim().length) { annotations.hasDescription = true; annotations.description = desc.substring(0, 200); }
  if (/aria|accessibility|a11y|screen.?reader|keyboard|role|tab.?order/i.test(desc)) {
    annotations.hasA11yNotes = true;
    annotations.a11yNotes = desc.split('\n').filter((l) => /aria|accessibility|a11y|screen.?reader|keyboard|role|tab.?order/i.test(l)).map((l) => l.trim()).join('; ').substring(0, 300);
  }
} catch (e) {}

// ---- 6. Color-blind simulation ----
const colorBlindAnalysis = { simulations: [], issues: [] };
const sampleVariant = defaultVariant || variants[0];
const colorPairs = [];
collectColorPairs(sampleVariant, colorPairs, 0);
const compFill = getFillColor(sampleVariant);
if (compFill) colorPairs.push({ fg: compFill, bg: getEffectiveBg(sampleVariant), nodeName: sampleVariant.name + ' (fill)', nodeId: sampleVariant.id });
for (const cbType of ['protanopia', 'deuteranopia', 'tritanopia']) {
  const m = colorBlindMatrices[cbType], failing = [];
  for (let i = 0; i < Math.min(colorPairs.length, 20); i++) {
    const p = colorPairs[i];
    const sFg = simulateColorBlind(p.fg.r, p.fg.g, p.fg.b, m), sBg = simulateColorBlind(p.bg.r, p.bg.g, p.bg.b, m);
    const orig = contrastRatio(p.fg.r, p.fg.g, p.fg.b, p.bg.r, p.bg.g, p.bg.b);
    const sim = contrastRatio(sFg.r, sFg.g, sFg.b, sBg.r, sBg.g, sBg.b);
    if (orig >= 4.5 && sim < 4.5) failing.push({ nodeName: p.nodeName, originalRatio: parseFloat(orig.toFixed(1)), simulatedRatio: parseFloat(sim.toFixed(1)), originalFg: rgbToHex(p.fg.r, p.fg.g, p.fg.b), simulatedFg: rgbToHex(sFg.r, sFg.g, sFg.b) });
    else if (orig >= 4.5 && sim >= 4.5 && (sim / orig) < 0.7) failing.push({ nodeName: p.nodeName, originalRatio: parseFloat(orig.toFixed(1)), simulatedRatio: parseFloat(sim.toFixed(1)), originalFg: rgbToHex(p.fg.r, p.fg.g, p.fg.b), simulatedFg: rgbToHex(sFg.r, sFg.g, sFg.b), note: 'Significant contrast reduction (>30%)' });
  }
  colorBlindAnalysis.simulations.push({ type: cbType, pairsChecked: Math.min(colorPairs.length, 20), issues: failing.length, details: failing });
  if (failing.length) colorBlindAnalysis.issues.push(cbType + ': ' + failing.length + ' color pair(s) lose sufficient contrast');
}

// ---- Scores ----
const scores = {};
scores.variantCoverage = totalStates > 0 ? Math.round((coveredCount / totalStates) * 100) : 100;
scores.focusIndicator = isPresentational ? 100 : (!focusAnalysis.hasVariant ? 0 : (!focusAnalysis.hasVisibleIndicator ? 50 : 100));
scores.colorDifferentiation = colorDifferentiation.checked === 0 ? 100 : Math.max(0, Math.round(((colorDifferentiation.checked - colorDifferentiation.issues.length) / colorDifferentiation.checked) * 100));
scores.targetSize = isPresentational ? 100 : (targetSizeAnalysis.issues.length === 0 ? 100 : Math.max(0, Math.round(((targetSizeAnalysis.variants.length - targetSizeAnalysis.issues.length) / Math.max(1, targetSizeAnalysis.variants.length)) * 100)));
scores.annotations = annotations.hasA11yNotes ? 100 : (annotations.hasDescription ? 50 : 0);
let cbPass = 0;
for (const s of colorBlindAnalysis.simulations) if (s.issues === 0) cbPass++;
scores.colorBlindSafety = colorBlindAnalysis.simulations.length > 0 ? Math.round((cbPass / colorBlindAnalysis.simulations.length) * 100) : 100;

let overall;
if (isInteractive) overall = Math.round(scores.variantCoverage * 0.20 + scores.focusIndicator * 0.20 + scores.colorDifferentiation * 0.15 + scores.targetSize * 0.15 + scores.annotations * 0.10 + scores.colorBlindSafety * 0.20);
else overall = Math.round(scores.variantCoverage * 0.25 + scores.colorDifferentiation * 0.25 + scores.annotations * 0.15 + scores.colorBlindSafety * 0.25 + scores.targetSize * 0.10);

// ---- Build response ----
const coverageSection = isInteractive
  ? { mode: 'interactive-states', found: statesFound, missing: missingStates, coverage: coveredCount + '/' + totalStates }
  : { mode: 'variant-axes', axes: variantAxisCoverage, coverage: coveredCount + '/' + totalStates };

const result = {
  component: { id: componentSet.id, name: componentSet.name, type: componentSet.type, variantCount, classification: isInteractive ? 'interactive' : 'presentational' },
  overallScore: overall,
  scores,
  variantCoverage: coverageSection,
  focusIndicator: isInteractive ? focusAnalysis : { notApplicable: true, details: 'Focus indicators are not expected for presentational components' },
  colorDifferentiation,
  targetSize: isInteractive
    ? { minimum: TARGET_SIZE + 'x' + TARGET_SIZE, smallest: targetSizeAnalysis.minWidth + 'x' + targetSizeAnalysis.minHeight, issues: targetSizeAnalysis.issues }
    : { notApplicable: true, details: 'Target size checks apply to interactive components (WCAG 2.5.8 is about tap targets)', smallest: targetSizeAnalysis.minWidth + 'x' + targetSizeAnalysis.minHeight },
  annotations,
  colorBlindSimulation: colorBlindAnalysis,
  recommendations: []
};

if (isInteractive) {
  if (!focusAnalysis.hasVariant) result.recommendations.push({ priority: 'high', area: 'focus', message: 'Add a focus/focused variant with a visible focus ring (WCAG 2.4.7)' });
  else if (!focusAnalysis.hasVisibleIndicator) result.recommendations.push({ priority: 'medium', area: 'focus', message: 'Focus variant exists but lacks visible indicator — add a border or shadow' });
}
if (colorDifferentiation.issues.length) result.recommendations.push({ priority: 'high', area: 'color', message: 'Add non-color indicators (icons, borders, text) to ' + colorDifferentiation.issues.length + ' state variant(s) (WCAG 1.4.1)' });
if (targetSizeAnalysis.issues.length) result.recommendations.push({ priority: 'high', area: 'target-size', message: targetSizeAnalysis.issues.length + ' variant(s) below ' + TARGET_SIZE + 'x' + TARGET_SIZE + 'px minimum target size (WCAG 2.5.8)' });
if (!annotations.hasDescription) result.recommendations.push({ priority: 'medium', area: 'documentation', message: 'Add a component description with usage guidelines' });
if (!annotations.hasA11yNotes) result.recommendations.push({ priority: 'medium', area: 'documentation', message: isInteractive ? 'Add accessibility notes (ARIA role, keyboard interactions, screen reader behavior)' : 'Add accessibility notes (ARIA role, live region behavior, semantic usage)' });
if (colorBlindAnalysis.issues.length) result.recommendations.push({ priority: 'medium', area: 'color-blind', message: colorBlindAnalysis.issues.join('; ') });
if (isInteractive) for (const ms of missingStates) if (ms === 'focus' || ms === 'disabled') result.recommendations.push({ priority: 'medium', area: 'states', message: 'Consider adding a "' + ms + '" variant for complete interactive state coverage' });
else if (variantAxisCoverage && variantCount < variantAxisCoverage.expectedCombinations) result.recommendations.push({ priority: 'low', area: 'coverage', message: variantCount + ' of ' + variantAxisCoverage.expectedCombinations + ' axis combinations present — consider adding missing variants for completeness' });

return result;
