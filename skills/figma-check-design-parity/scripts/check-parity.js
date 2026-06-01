// figma-check-design-parity — diff a Figma node's specs against a code spec.
//
// Run via the native Figma MCP `use_figma` tool (pass skillNames: "figma-check-design-parity").
// Plain JS, top-level await, returns JSON. Works on ANY Figma plan (Plugin API only).
// See the official figma-use skill and ../references/parity-scoring.md.

// ---- Inputs (edit these) ----
const NODE_ID = "REPLACE_WITH_NODE_ID";   // the Figma node to validate against

// What your code actually renders. Fill only the sections you want compared; omit the rest.
const CODE_SPEC = {
  // filePath: "src/components/Button.tsx",
  visual: {
    // backgroundColor: "#3B6BFF",
    // borderColor: "#1F2937",
    // borderWidth: 1,
    // borderRadius: 8,
    // opacity: 1,
  },
  spacing: {
    // paddingTop: 12, paddingRight: 16, paddingBottom: 12, paddingLeft: 16, gap: 8,
    // width: 120, height: 40,
  },
  typography: {
    // fontFamily: "Inter",
    // fontSize: 16,
    // fontWeight: 600,
    // lineHeight: 24,
    // letterSpacing: 0,
  },
  accessibility: {
    // role: "button", ariaLabel: "Save", focusVisible: true,
    // supportsDisabled: true, semanticElement: "button",
  },
  // metadata: { name: "Button" },
};

// ---- Helpers ----
function rgbaToHex(c) {
  const h = (n) => Math.round((n || 0) * 255).toString(16).padStart(2, '0');
  const base = '#' + h(c.r) + h(c.g) + h(c.b);
  const a = c.a === undefined ? 1 : c.a;
  return (a >= 1 ? base : base + h(a)).toUpperCase();
}
function normalizeColor(hex) {
  if (typeof hex !== 'string') return hex;
  let s = hex.trim().toUpperCase().replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  if (s.length === 8 && s.slice(6) === 'FF') s = s.slice(0, 6); // drop opaque alpha
  return '#' + s;
}
function numericClose(a, b, eps) { return Math.abs(a - b) <= (eps === undefined ? 1 : eps); }
function firstFillColor(fills) {
  if (!Array.isArray(fills)) return null;
  const f = fills.find((x) => x.type === 'SOLID' && x.visible !== false);
  if (!f || !f.color) return null;
  return rgbaToHex({ r: f.color.r, g: f.color.g, b: f.color.b, a: f.opacity === undefined ? 1 : f.opacity });
}
function firstStrokeColor(strokes) {
  if (!Array.isArray(strokes)) return null;
  const s = strokes.find((x) => x.type === 'SOLID' && x.visible !== false);
  if (!s || !s.color) return null;
  return rgbaToHex({ r: s.color.r, g: s.color.g, b: s.color.b, a: s.opacity === undefined ? 1 : s.opacity });
}
function extractSpacing(node) {
  const out = {};
  try { if (typeof node.paddingTop === 'number') out.paddingTop = node.paddingTop; } catch (e) {}
  try { if (typeof node.paddingRight === 'number') out.paddingRight = node.paddingRight; } catch (e) {}
  try { if (typeof node.paddingBottom === 'number') out.paddingBottom = node.paddingBottom; } catch (e) {}
  try { if (typeof node.paddingLeft === 'number') out.paddingLeft = node.paddingLeft; } catch (e) {}
  try { if (typeof node.itemSpacing === 'number') out.gap = node.itemSpacing; } catch (e) {}
  try { if (typeof node.width === 'number') out.width = node.width; } catch (e) {}
  try { if (typeof node.height === 'number') out.height = node.height; } catch (e) {}
  return out;
}
function extractText(node) {
  const out = {};
  let textNode = node;
  if (node.type !== 'TEXT' && typeof node.findOne === 'function') {
    try { const t = node.findOne((n) => n.type === 'TEXT'); if (t) textNode = t; } catch (e) {}
  }
  if (textNode.type !== 'TEXT') return out;
  try { const f = textNode.fontName; if (f && typeof f === 'object') out.fontFamily = f.family; } catch (e) {}
  try { if (typeof textNode.fontSize === 'number') out.fontSize = textNode.fontSize; } catch (e) {}
  try { if (textNode.fontWeight && typeof textNode.fontWeight === 'number') out.fontWeight = textNode.fontWeight; } catch (e) {}
  try { const lh = textNode.lineHeight; if (lh && typeof lh === 'object' && typeof lh.value === 'number') out.lineHeight = lh.unit === 'PIXELS' ? lh.value : (typeof out.fontSize === 'number' ? out.fontSize * lh.value / 100 : undefined); } catch (e) {}
  try { const ls = textNode.letterSpacing; if (ls && typeof ls === 'object' && typeof ls.value === 'number') out.letterSpacing = ls.value; } catch (e) {}
  return out;
}

// Resolve a node property's bound variable → { name, mode } so a color/value mismatch points at
// the Figma TOKEN (and which mode resolved), not just a literal. On a properly tokenized design the
// literal fill already equals the resolved token value, but the token name is what's actionable.
async function boundTokenInfo(node, prop) {
  try {
    const bv = node.boundVariables && node.boundVariables[prop];
    if (!bv) return null;
    const b = Array.isArray(bv) ? bv[0] : bv;
    const v = await figma.variables.getVariableByIdAsync(b.id);
    if (!v) return null;
    let mode = null;
    try {
      const coll = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
      const mid = node.resolvedVariableModes ? node.resolvedVariableModes[coll.id] : null;
      const mm = mid && coll.modes.find((m) => m.modeId === mid);
      mode = mm ? mm.name : null;
    } catch (e) {}
    return { name: v.name, mode };
  } catch (e) { return null; }
}

// ---- Resolve node ----
const node = await figma.getNodeByIdAsync(NODE_ID);
if (!node) throw new Error('Node not found: ' + NODE_ID);

const discrepancies = [];
function add(category, property, severity, designValue, codeValue, message, suggestion, extra) {
  discrepancies.push(Object.assign({ category, property, severity, designValue, codeValue, message, suggestion }, extra || {}));
}

// ---- Compare: visual ----
const cv = CODE_SPEC.visual;
if (cv) {
  let nodeFills; try { nodeFills = node.fills; } catch (e) {} // .fills getter throws on node types that lack it
  const fill = firstFillColor(nodeFills);
  if (fill && cv.backgroundColor && normalizeColor(fill) !== normalizeColor(cv.backgroundColor)) {
    const tok = await boundTokenInfo(node, 'fills');
    const tokStr = tok ? ' (Figma token ' + tok.name + (tok.mode ? ', ' + tok.mode + ' mode' : '') + ')' : '';
    add('visual', 'backgroundColor', 'major', fill, cv.backgroundColor, 'Background color mismatch: design=' + fill + tokStr + ', code=' + cv.backgroundColor, tok ? 'Reconcile Figma token ' + tok.name + ' with the code value.' : 'Update to match ' + fill, tok ? { designToken: tok.name, designMode: tok.mode } : undefined);
  }
  let nodeStrokes; try { nodeStrokes = node.strokes; } catch (e) {} // .strokes getter throws on node types that lack it
  const stroke = firstStrokeColor(nodeStrokes);
  if (stroke && cv.borderColor && normalizeColor(stroke) !== normalizeColor(cv.borderColor)) {
    const tok = await boundTokenInfo(node, 'strokes');
    const tokStr = tok ? ' (Figma token ' + tok.name + (tok.mode ? ', ' + tok.mode + ' mode' : '') + ')' : '';
    add('visual', 'borderColor', 'major', stroke, cv.borderColor, 'Border color mismatch: design=' + stroke + tokStr + ', code=' + cv.borderColor, tok ? 'Reconcile Figma token ' + tok.name + ' with the code value.' : 'Update to match ' + stroke, tok ? { designToken: tok.name, designMode: tok.mode } : undefined);
  }
  let sw; try { sw = node.strokeWeight; } catch (e) {}
  if (typeof sw === 'number' && cv.borderWidth !== undefined && !numericClose(sw, cv.borderWidth))
    add('visual', 'borderWidth', 'minor', sw, cv.borderWidth, 'Border width mismatch: design=' + sw + 'px, code=' + cv.borderWidth + 'px');
  let cr; try { cr = node.cornerRadius; } catch (e) {}
  if (typeof cr === 'number' && cv.borderRadius !== undefined) {
    const codeR = typeof cv.borderRadius === 'string' ? parseFloat(cv.borderRadius) : cv.borderRadius;
    if (!isNaN(codeR) && !numericClose(cr, codeR)) add('visual', 'borderRadius', 'minor', cr, cv.borderRadius, 'Border radius mismatch: design=' + cr + 'px, code=' + cv.borderRadius);
  }
  let op; try { op = node.opacity; } catch (e) {}
  if (typeof op === 'number' && cv.opacity !== undefined && !numericClose(op, cv.opacity, 0.01))
    add('visual', 'opacity', 'minor', op, cv.opacity, 'Opacity mismatch: design=' + op + ', code=' + cv.opacity);
}

// ---- Compare: spacing ----
const cs = CODE_SPEC.spacing;
if (cs) {
  const ds = extractSpacing(node);
  for (const key of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'gap']) {
    const d = ds[key], c = cs[key];
    if (d !== undefined && c !== undefined) {
      const cNum = typeof c === 'string' ? parseFloat(c) : c;
      if (!isNaN(cNum) && !numericClose(d, cNum)) add('spacing', key, 'major', d, c, 'Spacing mismatch on ' + key + ': design=' + d + 'px, code=' + c);
    }
  }
  for (const key of ['width', 'height']) {
    const d = ds[key], c = cs[key];
    if (d !== undefined && c !== undefined) {
      const cNum = typeof c === 'string' ? parseFloat(c) : c;
      if (!isNaN(cNum) && !numericClose(d, cNum, 2)) add('spacing', key, 'minor', d, c, key + ' mismatch: design=' + d + 'px, code=' + c);
    }
  }
}

// ---- Compare: typography ----
const ct = CODE_SPEC.typography;
if (ct) {
  const dt = extractText(node);
  if (dt.fontFamily && ct.fontFamily && dt.fontFamily.toLowerCase() !== String(ct.fontFamily).toLowerCase())
    add('typography', 'fontFamily', 'major', dt.fontFamily, ct.fontFamily, 'Font family mismatch: design=' + dt.fontFamily + ', code=' + ct.fontFamily);
  if (dt.fontSize !== undefined && ct.fontSize !== undefined && !numericClose(dt.fontSize, ct.fontSize))
    add('typography', 'fontSize', 'major', dt.fontSize, ct.fontSize, 'Font size mismatch: design=' + dt.fontSize + 'px, code=' + ct.fontSize + 'px');
  if (dt.fontWeight !== undefined && ct.fontWeight !== undefined) {
    const cw = typeof ct.fontWeight === 'string' ? parseFloat(ct.fontWeight) : ct.fontWeight;
    if (!isNaN(cw) && !numericClose(dt.fontWeight, cw, 1)) add('typography', 'fontWeight', 'minor', dt.fontWeight, ct.fontWeight, 'Font weight mismatch: design=' + dt.fontWeight + ', code=' + ct.fontWeight);
  }
  if (dt.lineHeight !== undefined && ct.lineHeight !== undefined) {
    const cl = typeof ct.lineHeight === 'string' ? parseFloat(ct.lineHeight) : ct.lineHeight;
    if (!isNaN(cl) && !numericClose(dt.lineHeight, cl, 1)) add('typography', 'lineHeight', 'minor', dt.lineHeight, ct.lineHeight, 'Line height mismatch: design=' + dt.lineHeight + ', code=' + ct.lineHeight);
  }
  if (dt.letterSpacing !== undefined && ct.letterSpacing !== undefined && !numericClose(dt.letterSpacing, ct.letterSpacing, 0.1))
    add('typography', 'letterSpacing', 'minor', dt.letterSpacing, ct.letterSpacing, 'Letter spacing mismatch: design=' + dt.letterSpacing + ', code=' + ct.letterSpacing);
}

// ---- Compare: accessibility (positive-evidence only; absence != failure) ----
const ca = CODE_SPEC.accessibility;
if (ca) {
  // Disabled state: if code supports it, the design should have a disabled variant or annotation.
  if (ca.supportsDisabled === true) {
    let hasDisabled = false;
    try {
      if (node.type === 'COMPONENT_SET') for (const v of (node.children || [])) if (/disabled|inactive/i.test(v.name)) { hasDisabled = true; break; }
      if (!hasDisabled && /disabled|aria-disabled/i.test(node.description || '')) hasDisabled = true;
    } catch (e) {}
    if (!hasDisabled) add('accessibility', 'supportsDisabled', 'minor', 'no disabled variant/annotation found', true, 'Code supports a disabled state but the design has no disabled variant or annotation.', 'Add a disabled variant or note it in the component description.');
  }
  // Error state.
  if (ca.supportsError === true) {
    let hasError = false;
    try {
      if (node.type === 'COMPONENT_SET') for (const v of (node.children || [])) if (/error|invalid|danger/i.test(v.name)) { hasError = true; break; }
      if (!hasError && /error|invalid|aria-invalid/i.test(node.description || '')) hasError = true;
    } catch (e) {}
    if (!hasError) add('accessibility', 'supportsError', 'minor', 'no error variant/annotation found', true, 'Code supports an error state but the design has no error variant or annotation.', 'Add an error variant or note it in the component description.');
  }
  // Documented role / aria in the design description.
  if ((ca.role || ca.ariaLabel) && node.type === 'COMPONENT_SET') {
    const desc = node.description || '';
    if (!/aria|role|accessibility|a11y/i.test(desc)) add('accessibility', 'annotation', 'info', 'no a11y annotation', ca.role || ca.ariaLabel, 'Code declares role/aria-label but the design description has no accessibility notes.', 'Document the ARIA role and accessible name in the component description.');
  }
}

// ---- Score ----
let critical = 0, major = 0, minor = 0, info = 0;
const byCategory = {};
for (const d of discrepancies) {
  if (d.severity === 'critical') critical++; else if (d.severity === 'major') major++; else if (d.severity === 'minor') minor++; else info++;
  byCategory[d.category] = (byCategory[d.category] || 0) + 1;
}
const parityScore = Math.max(0, 100 - (critical * 15 + major * 8 + minor * 3 + info * 1));

return {
  node: { id: node.id, name: node.name, type: node.type },
  summary: { totalDiscrepancies: discrepancies.length, parityScore, byCritical: critical, byMajor: major, byMinor: minor, byInfo: info, categories: byCategory },
  discrepancies,
  ai_instruction: parityScore === 100
    ? 'Design and code are in parity for the compared sections.'
    : 'Review each discrepancy: update code to match designValue, or push the design to match an intentional code change, then re-run.'
};
