// Collect everything needed to document a Figma component (or component set).
// Run via use_figma with skillNames: "figma-generate-component-doc".
// Returns: anatomy tree, per-variant colors (with bound token names), typography,
// spacing tokens, component property definitions, description, and annotations.
// The AGENT assembles Markdown from this — see references/doc-template.md.

const NODE_ID = '695:313';   // COMPONENT or COMPONENT_SET node ID
const MAX_DEPTH = 5;        // how deep to walk the node tree

const node = await figma.getNodeByIdAsync(NODE_ID);
if (!node) throw new Error('Node not found: ' + NODE_ID);

// ---- Build a variableId -> variable name map for token resolution ----
const allVars = await figma.variables.getLocalVariablesAsync();
const varNameMap = {};
for (const v of allVars) varNameMap[v.id] = v.name;

function figmaRGBAToHex(c) {
  const to2 = (n) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0');
  const hex = '#' + to2(c.r) + to2(c.g) + to2(c.b);
  return (c.a !== undefined && c.a < 1) ? hex + to2(c.a) : hex;
}

// ---- Anatomy: ASCII layer tree of the (deepest) variant ----
function countDepth(n) {
  if (!('children' in n) || !n.children || n.children.length === 0) return 0;
  return 1 + Math.max(...n.children.map(countDepth));
}
function anatomyLines(n, lines, prefix, isLast, depth) {
  if (depth > MAX_DEPTH) return;
  const connector = depth === 0 ? '' : (isLast ? '└── ' : '├── ');
  const childPrefix = depth === 0 ? '' : (isLast ? '    ' : '│   ');
  const typeHint = ['TEXT', 'INSTANCE', 'COMPONENT', 'VECTOR', 'RECTANGLE'].indexOf(n.type) !== -1 ? ' (' + n.type + ')' : '';
  let layout = '';
  // layoutMode/itemSpacing getters THROW on node types that lack them (e.g. TEXT) — guard with `in`.
  if ('layoutMode' in n && n.layoutMode) {
    layout = ' — ' + (n.layoutMode === 'HORIZONTAL' ? 'horizontal' : 'vertical') + ' auto-layout';
    if ('itemSpacing' in n && n.itemSpacing !== undefined) layout += ', gap: ' + n.itemSpacing + 'px';
  }
  lines.push(prefix + connector + (n.name || n.type) + typeHint + layout);
  if ('children' in n && n.children) {
    const visible = n.children.filter((c) => c.visible !== false);
    visible.forEach((c, i) => anatomyLines(c, lines, prefix + childPrefix, i === visible.length - 1, depth + 1));
  }
}
let anatomyTarget = node;
if (node.type === 'COMPONENT_SET' && node.children && node.children.length > 0) {
  anatomyTarget = node.children.reduce((best, c) => (countDepth(c) > countDepth(best) ? c : best), node.children[0]);
}
const anatomyTreeLines = [];
anatomyLines(anatomyTarget, anatomyTreeLines, '', true, 0);

// ---- Per-variant color data ----
function walkColors(n, data, depth) {
  if (depth > MAX_DEPTH) return;
  const isText = n.type === 'TEXT';
  if (n.type === 'INSTANCE' && n.name && /icon/i.test(n.name)) {
    data.icons.push({ name: n.name.replace(/^icon\s*\/?\s*/i, '').trim() || n.name });
  }
  for (const fill of (('fills' in n && n.fills && Array.isArray(n.fills)) ? n.fills : [])) {
    if (fill.type === 'SOLID' && fill.color && fill.visible !== false) {
      const varId = fill.boundVariables && fill.boundVariables.color && fill.boundVariables.color.id;
      const entry = { hex: figmaRGBAToHex(Object.assign({}, fill.color, { a: fill.opacity })), nodeName: n.name || '', variableId: varId || undefined, variableName: varId ? varNameMap[varId] : undefined };
      (isText ? data.textColors : data.fills).push(entry);
    }
  }
  for (const stroke of (('strokes' in n && n.strokes && Array.isArray(n.strokes)) ? n.strokes : [])) {
    if (stroke.type === 'SOLID' && stroke.color && stroke.visible !== false) {
      const varId = stroke.boundVariables && stroke.boundVariables.color && stroke.boundVariables.color.id;
      data.strokes.push({ hex: figmaRGBAToHex(Object.assign({}, stroke.color, { a: stroke.opacity })), nodeName: n.name || '', variableId: varId || undefined, variableName: varId ? varNameMap[varId] : undefined });
    }
  }
  if ('children' in n && n.children) for (const c of n.children) walkColors(c, data, depth + 1);
}
const variantNodes = (node.type === 'COMPONENT_SET' && node.children && node.children.length > 0) ? node.children : [node];
const variantData = variantNodes.map((variant) => {
  const data = { variantName: variant.name || 'Default', fills: [], strokes: [], textColors: [], icons: [] };
  walkColors(variant, data, 0);
  return data;
});

// ---- Typography (from the default variant) ----
const typography = [];
// Map Figma fontName.style strings to numeric weights + canonical names (matches the source generator's weightNames table).
const weightByStyle = { thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, regular: 400, normal: 400, book: 400, medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900 };
const weightNames = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };
function styleToWeight(style) {
  const key = String(style || '').toLowerCase().replace(/\s+/g, '').replace(/italic|oblique/g, '');
  return weightByStyle[key] || 400;
}
function walkType(n, depth) {
  if (depth > MAX_DEPTH) return;
  if (n.type === 'TEXT') {
    const fs = n.fontSize, fn = n.fontName || {};
    const lh = n.lineHeight;
    const ls = n.letterSpacing;
    const weight = styleToWeight(fn.style);
    // letterSpacing is a {value, unit} object; only PIXELS converts cleanly to px.
    let letterSpacing = 0;
    if (ls && typeof ls.value === 'number') letterSpacing = ls.unit === 'PERCENT' ? ls.value : ls.value;
    typography.push({
      nodeName: n.name || 'Text',
      fontFamily: fn.family || 'Unknown',
      fontStyle: fn.style || 'Regular',
      fontWeight: weight,
      fontWeightName: weightNames[weight] || String(weight),
      fontSize: typeof fs === 'number' ? fs : undefined,
      lineHeight: lh && lh.unit !== 'AUTO' ? lh.value : undefined,
      letterSpacing: letterSpacing,
    });
  }
  if ('children' in n && n.children) for (const c of n.children) walkType(c, depth + 1);
}
walkType(node.type === 'COMPONENT_SET' && node.children && node.children[0] ? node.children[0] : node, 0);

// ---- Spacing tokens (auto-layout values + bound variable names) ----
const spacingNode = node.type === 'COMPONENT_SET' && node.children && node.children[0] ? node.children[0] : node;
const boundVars = spacingNode.boundVariables || {};
const spacingTokens = [];
const spacingProps = [
  ['paddingTop', 'Padding top'], ['paddingRight', 'Padding right'], ['paddingBottom', 'Padding bottom'],
  ['paddingLeft', 'Padding left'], ['itemSpacing', 'Gap'], ['cornerRadius', 'Border radius'], ['strokeWeight', 'Border width'],
];
for (const [key, label] of spacingProps) {
  let value;
  try { value = spacingNode[key]; } catch (e) { continue; } // getter throws if node lacks the prop
  if (value !== undefined && value !== null && typeof value === 'number') {
    const binding = boundVars[key];
    const varId = binding && binding.id;
    spacingTokens.push({ property: label, value, variableId: varId || undefined, variableName: varId ? varNameMap[varId] : undefined });
  }
}

// ---- Component property definitions (variants / booleans / text props) ----
const propsRaw = node.componentPropertyDefinitions || (node.type === 'COMPONENT' && node.parent && node.parent.componentPropertyDefinitions) || {};
const variants = [], booleans = [], textProps = [];
for (const rawName of Object.keys(propsRaw)) {
  const def = propsRaw[rawName];
  const name = rawName.replace(/#\d+:\d+$/, '').trim();
  if (def.type === 'VARIANT') variants.push({ name, values: def.variantOptions || [], defaultValue: def.defaultValue || '' });
  else if (def.type === 'BOOLEAN') booleans.push({ name, defaultValue: def.defaultValue });
  else if (def.type === 'TEXT') textProps.push({ name, defaultValue: def.defaultValue || '' });
}

// ---- Annotation category name resolution (categoryId -> human label) ----
const annCategoryMap = {};
try {
  const cats = await figma.annotations.getAnnotationCategoriesAsync();
  for (const c of (cats || [])) annCategoryMap[c.id] = c.label || c.id;
} catch (e) { /* categories API unavailable on this node/file — leave map empty */ }

// ---- Annotations on the node and immediate children ----
function extractAnns(n) {
  return (n.annotations || []).map((a) => ({
    label: a.label || null,
    labelMarkdown: a.labelMarkdown || null,
    categoryId: a.categoryId || null,
    categoryName: a.categoryId ? (annCategoryMap[a.categoryId] || null) : null,
    properties: a.properties ? a.properties.map((p) => ({ type: p.type })) : null,
  }));
}
const nodeAnnotations = extractAnns(node);
const childAnnotations = [];
if ('children' in node && node.children) {
  for (const child of node.children) {
    const anns = extractAnns(child);
    if (anns.length > 0) childAnnotations.push({ nodeName: child.name, nodeType: child.type, annotations: anns });
  }
}

return {
  nodeId: node.id,
  name: node.name,
  type: node.type,
  description: node.description || '',
  descriptionMarkdown: node.descriptionMarkdown || '',
  anatomyTree: anatomyTreeLines.join('\n'),
  variantData,
  typography,
  spacingTokens,
  componentProperties: { variants, booleans, textProps },
  annotations: { node: nodeAnnotations, children: childAnnotations },
};
