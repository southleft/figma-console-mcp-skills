// figma-design-system-inventory — unified tokens + components + styles in one call.
//
// Run via the native Figma MCP `use_figma` tool (pass skillNames: "figma-design-system-inventory").
// Reads variables via the Plugin API → works on ANY Figma plan (no Enterprise REST requirement).
// See ../../references/use-figma-conventions.md and references/visual-spec.md.

const INCLUDE = ["tokens", "components", "styles"]; // any subset
const VERBOSITY = "full";              // "full" | "summary" | "inventory"
const COMPONENT_NAME_FILTER = null;    // substring filter, e.g. "Button", or null for all

function has(section) { return INCLUDE.indexOf(section) !== -1; }

function toHex(c) {
  if (!c) return null;
  const h = (n) => Math.round((n || 0) * 255).toString(16).padStart(2, "0");
  return ("#" + h(c.r) + h(c.g) + h(c.b)).toUpperCase();
}

// --- Compact visual spec from a node (mirrors the bundled extractVisualSpec) ---
function extractVisualSpec(node) {
  if (!node) return undefined;
  const spec = {};
  let hasData = false;

  try {
    if (node.fills && Array.isArray(node.fills) && node.fills.length > 0) {
      spec.fills = node.fills.filter((f) => f.visible !== false).map((f) => {
        const fill = { type: f.type };
        if (f.color) fill.color = toHex(f.color);
        if (f.opacity !== undefined) fill.opacity = f.opacity;
        return fill;
      });
      if (spec.fills.length > 0) hasData = true;
    }
  } catch (e) {}

  try {
    if (node.strokes && Array.isArray(node.strokes) && node.strokes.length > 0) {
      spec.strokes = node.strokes.filter((s) => s.visible !== false).map((s) => {
        const st = { type: s.type };
        if (s.color) st.color = toHex(s.color);
        if (node.strokeWeight !== undefined && node.strokeWeight !== figma.mixed) st.weight = node.strokeWeight;
        if (node.strokeAlign) st.align = node.strokeAlign;
        return st;
      });
      if (spec.strokes.length > 0) hasData = true;
    }
  } catch (e) {}

  try {
    if (node.effects && node.effects.length > 0) {
      spec.effects = node.effects.filter((e) => e.visible !== false).map((e) => {
        const ef = { type: e.type };
        if (e.color) ef.color = toHex(e.color);
        if (e.offset) ef.offset = e.offset;
        if (e.radius !== undefined) ef.radius = e.radius;
        if (e.spread !== undefined) ef.spread = e.spread;
        return ef;
      });
      if (spec.effects.length > 0) hasData = true;
    }
  } catch (e) {}

  if (node.cornerRadius !== undefined && node.cornerRadius !== figma.mixed && node.cornerRadius > 0) { spec.cornerRadius = node.cornerRadius; hasData = true; }
  if (node.opacity !== undefined && node.opacity < 1) { spec.opacity = node.opacity; hasData = true; }

  if (node.layoutMode && node.layoutMode !== "NONE") {
    spec.layout = { mode: node.layoutMode };
    if (node.paddingTop !== undefined) spec.layout.paddingTop = node.paddingTop;
    if (node.paddingRight !== undefined) spec.layout.paddingRight = node.paddingRight;
    if (node.paddingBottom !== undefined) spec.layout.paddingBottom = node.paddingBottom;
    if (node.paddingLeft !== undefined) spec.layout.paddingLeft = node.paddingLeft;
    if (node.itemSpacing !== undefined) spec.layout.itemSpacing = node.itemSpacing;
    if (node.primaryAxisAlignItems) spec.layout.primaryAxisAlign = node.primaryAxisAlignItems;
    if (node.counterAxisAlignItems) spec.layout.counterAxisAlign = node.counterAxisAlignItems;
    hasData = true;
  }

  if (node.type === "TEXT") {
    const t = {};
    try { if (node.fontName !== figma.mixed) { t.fontFamily = node.fontName.family; t.fontStyle = node.fontName.style; } } catch (e) {}
    try { if (node.fontSize !== figma.mixed) t.fontSize = node.fontSize; } catch (e) {}
    try { if (node.fontWeight !== figma.mixed) t.fontWeight = node.fontWeight; } catch (e) {}
    try { if (node.lineHeight !== figma.mixed) t.lineHeight = node.lineHeight; } catch (e) {}
    try { if (node.letterSpacing !== figma.mixed) t.letterSpacing = node.letterSpacing; } catch (e) {}
    try { if (node.textAlignHorizontal) t.textAlignHorizontal = node.textAlignHorizontal; } catch (e) {}
    if (Object.keys(t).length > 0) { spec.typography = t; hasData = true; }
  }

  return hasData ? spec : undefined;
}

const result = {
  fileName: figma.root.name,
  generatedAt: new Date().toISOString(),
  verbosity: VERBOSITY,
  include: INCLUDE,
  affectedNodeIds: []
};

// ============================== TOKENS ==============================
if (has("tokens")) {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const varCache = {};
  const idToName = {};
  async function getVar(id) {
    if (id in varCache) return varCache[id];
    const v = await figma.variables.getVariableByIdAsync(id);
    varCache[id] = v || null;
    if (v) idToName[id] = v.name;
    return v;
  }
  for (const col of collections) {
    for (const vid of col.variableIds) await getVar(vid);
  }
  // Alias targets can live in collections NOT returned by getLocalVariableCollectionsAsync()
  // (and absent from getLocalVariablesAsync()) yet still be referenceable. Resolve them
  // directly so references never leak a raw VariableID.
  for (const id of Object.keys(idToName)) {
    const v = varCache[id];
    if (!v) continue;
    for (const modeId in v.valuesByMode) {
      const raw = v.valuesByMode[modeId];
      if (raw && typeof raw === "object" && raw.type === "VARIABLE_ALIAS") await getVar(raw.id);
    }
  }
  function encodeValue(raw, type) {
    if (raw && typeof raw === "object" && raw.type === "VARIABLE_ALIAS") {
      const name = idToName[raw.id];
      return name ? { reference: "{" + name.split("/").join(".") + "}" } : { unresolvedAlias: raw.id };
    }
    if (type === "COLOR" && raw && typeof raw === "object") return toHex(raw);
    return raw;
  }
  const out = [];
  const byType = {};
  let varCount = 0;
  for (const col of collections) {
    const variables = [];
    for (const vid of col.variableIds) {
      const v = varCache[vid];
      if (!v) continue;
      varCount++;
      byType[v.resolvedType] = (byType[v.resolvedType] || 0) + 1;
      const entry = { id: v.id, key: v.key || null, name: v.name, type: v.resolvedType };
      if (VERBOSITY !== "inventory") {
        entry.description = v.description || "";
        entry.scopes = v.scopes;
        entry.valuesByMode = {};
        for (const m of col.modes) entry.valuesByMode[m.name] = encodeValue(v.valuesByMode[m.modeId], v.resolvedType);
      }
      variables.push(entry);
    }
    out.push({ id: col.id, name: col.name, modes: col.modes.map((m) => ({ modeId: m.modeId, name: m.name })), variables });
  }
  result.tokens = { collections: out, summary: { totalCollections: out.length, totalVariables: varCount, variablesByType: byType } };
}

// ============================== COMPONENTS ==============================
if (has("components")) {
  // NOTE: figma.loadAllPagesAsync() is NOT supported in the use_figma runtime, and
  // figma.root.findAllWithCriteria() requires all pages loaded. So load pages incrementally
  // with setCurrentPageAsync and scan each page, then restore the original page.
  const _origPage = figma.currentPage;
  const sets = [];
  const allComponents = [];
  for (const page of figma.root.children) {
    await figma.setCurrentPageAsync(page);
    sets.push(...page.findAllWithCriteria({ types: ["COMPONENT_SET"] }));
    allComponents.push(...page.findAllWithCriteria({ types: ["COMPONENT"] }));
  }
  await figma.setCurrentPageAsync(_origPage);
  // Standalone components = those NOT inside a component set (sets cover their variants).
  const standalone = allComponents.filter((c) => !(c.parent && c.parent.type === "COMPONENT_SET"));

  function nameMatches(n) { return !COMPONENT_NAME_FILTER || n.indexOf(COMPONENT_NAME_FILTER) !== -1; }

  const items = [];

  for (const set of sets) {
    if (!nameMatches(set.name)) continue;
    const item = { id: set.id, name: set.name, kind: "COMPONENT_SET", description: set.description || "" };
    if (VERBOSITY !== "inventory") item.componentProps = set.componentPropertyDefinitions || {};
    if (VERBOSITY === "full") {
      item.variants = set.children.filter((c) => c.type === "COMPONENT").map((variant) => {
        const v = { name: variant.name, id: variant.id };
        const vs = extractVisualSpec(variant);
        if (vs) v.visualSpec = vs;
        return v;
      });
    } else {
      item.variantCount = set.children.filter((c) => c.type === "COMPONENT").length;
    }
    items.push(item);
  }

  for (const comp of standalone) {
    if (!nameMatches(comp.name)) continue;
    const item = { id: comp.id, name: comp.name, kind: "COMPONENT", description: comp.description || "" };
    if (VERBOSITY !== "inventory") item.componentProps = comp.componentPropertyDefinitions || {};
    if (VERBOSITY === "full") { const vs = extractVisualSpec(comp); if (vs) item.visualSpec = vs; }
    items.push(item);
  }

  result.components = { items, summary: { totalComponents: standalone.length, totalComponentSets: sets.length } };
}

// ============================== STYLES ==============================
if (has("styles")) {
  const paint = await figma.getLocalPaintStylesAsync();
  const text = await figma.getLocalTextStylesAsync();
  const effect = await figma.getLocalEffectStylesAsync();
  const byType = { PAINT: paint.length, TEXT: text.length, EFFECT: effect.length };

  const items = [];
  for (const s of paint) {
    const entry = { key: s.key, name: s.name, styleType: "PAINT", description: s.description || "" };
    if (VERBOSITY === "full" && s.paints && s.paints[0] && s.paints[0].color) entry.resolvedValue = toHex(s.paints[0].color);
    items.push(entry);
  }
  for (const s of text) {
    const entry = { key: s.key, name: s.name, styleType: "TEXT", description: s.description || "" };
    if (VERBOSITY === "full") {
      entry.resolvedValue = {
        fontFamily: s.fontName ? s.fontName.family : null,
        fontStyle: s.fontName ? s.fontName.style : null,
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        letterSpacing: s.letterSpacing
      };
    }
    items.push(entry);
  }
  for (const s of effect) {
    const entry = { key: s.key, name: s.name, styleType: "EFFECT", description: s.description || "" };
    if (VERBOSITY === "full") entry.resolvedValue = s.effects;
    items.push(entry);
  }
  result.styles = { items, summary: { totalStyles: items.length, stylesByType: byType } };
}

result.ai_instruction =
  "Use tokens for color/spacing/typography values, components[].componentProps for the component API, " +
  "components[].variants[].visualSpec for per-state appearance, and styles for non-variable values. " +
  "Drop VERBOSITY to 'summary' or 'inventory' (or narrow INCLUDE / COMPONENT_NAME_FILTER) if the response is large.";

return result;
