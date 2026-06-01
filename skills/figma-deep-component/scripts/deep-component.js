// figma-deep-component — full recursive node tree with resolved tokens, instance refs, reactions.
//
// Run via the native Figma MCP `use_figma` tool (pass skillNames: "figma-deep-component").
// Inputs: NODE_ID (any node, usually a COMPONENT/COMPONENT_SET/INSTANCE) and DEPTH (max recursion).
// See the official figma-use skill for the execution model.

const NODE_ID = "REPLACE_WITH_NODE_ID";
const DEPTH = 10;

const rootNode = await figma.getNodeByIdAsync(NODE_ID);
if (!rootNode) throw new Error("Node not found: " + NODE_ID);

// --- Build a variableId -> token metadata lookup (resolves boundVariables to names on ANY plan) ---
const varNameMap = {};
try {
  const allVars = await figma.variables.getLocalVariablesAsync();
  const allCollections = await figma.variables.getLocalVariableCollectionsAsync();
  const collectionMap = {};
  for (const c of allCollections) collectionMap[c.id] = c.name;
  for (const v of allVars) {
    varNameMap[v.id] = {
      name: v.name,
      resolvedType: v.resolvedType,
      collection: collectionMap[v.variableCollectionId] || null,
      scopes: v.scopes || [],
      codeSyntax: v.codeSyntax || {}
    };
  }
} catch (e) { /* variables may be unavailable */ }

// boundVariables can reference variables that getLocalVariablesAsync() does NOT return
// (ghost/orphaned collections that remain referenceable). Pre-resolve every bound-variable
// target in the subtree directly so the sync resolver below never leaks a raw VariableID.
async function ensureVar(id) {
  if (varNameMap[id]) return;
  try {
    const v = await figma.variables.getVariableByIdAsync(id);
    if (v) varNameMap[id] = { name: v.name, resolvedType: v.resolvedType, collection: null, scopes: v.scopes || [], codeSyntax: v.codeSyntax || {} };
  } catch (e) { /* unreachable target — will fall back to {id} */ }
}
async function preResolveBoundVars(n, depth) {
  const bv = n.boundVariables;
  if (bv) {
    for (const prop of Object.keys(bv)) {
      const b = bv[prop];
      if (Array.isArray(b)) { for (const x of b) if (x && x.id) await ensureVar(x.id); }
      else if (b && b.id) await ensureVar(b.id);
    }
  }
  if (depth > 0 && "children" in n && n.children) { for (const c of n.children) await preResolveBoundVars(c, depth - 1); }
}
await preResolveBoundVars(rootNode, DEPTH);

function resolveBoundVars(bv) {
  if (!bv) return null;
  const resolved = {};
  for (const prop of Object.keys(bv)) {
    const binding = bv[prop];
    if (Array.isArray(binding)) {
      resolved[prop] = binding.filter((b) => b && b.id).map((b) => {
        const info = varNameMap[b.id];
        return info ? { id: b.id, name: info.name, collection: info.collection, resolvedType: info.resolvedType, codeSyntax: info.codeSyntax } : { id: b.id };
      });
    } else if (binding && binding.id) {
      const info = varNameMap[binding.id];
      resolved[prop] = info ? { id: binding.id, name: info.name, collection: info.collection, resolvedType: info.resolvedType, codeSyntax: info.codeSyntax } : { id: binding.id };
    }
  }
  return Object.keys(resolved).length > 0 ? resolved : null;
}

function extractNodeProps(n) {
  const props = {};

  // Layout — these getters THROW on node types that lack them (e.g. TEXT/leaf), so guard the
  // whole block: a leaf simply has no layout props to report.
  try {
    if (n.layoutMode) props.layoutMode = n.layoutMode;
    if (n.primaryAxisSizingMode) props.primaryAxisSizingMode = n.primaryAxisSizingMode;
    if (n.counterAxisSizingMode) props.counterAxisSizingMode = n.counterAxisSizingMode;
    if (n.layoutSizingHorizontal) props.layoutSizingHorizontal = n.layoutSizingHorizontal;
    if (n.layoutSizingVertical) props.layoutSizingVertical = n.layoutSizingVertical;
    if (n.primaryAxisAlignItems) props.primaryAxisAlignItems = n.primaryAxisAlignItems;
    if (n.counterAxisAlignItems) props.counterAxisAlignItems = n.counterAxisAlignItems;
    if (n.paddingLeft) props.paddingLeft = n.paddingLeft;
    if (n.paddingRight) props.paddingRight = n.paddingRight;
    if (n.paddingTop) props.paddingTop = n.paddingTop;
    if (n.paddingBottom) props.paddingBottom = n.paddingBottom;
    if (n.itemSpacing) props.itemSpacing = n.itemSpacing;
    if (n.counterAxisSpacing) props.counterAxisSpacing = n.counterAxisSpacing;
    if (n.layoutWrap && n.layoutWrap !== "NO_WRAP") props.layoutWrap = n.layoutWrap;
    if (n.minWidth !== undefined && n.minWidth !== null) props.minWidth = n.minWidth;
    if (n.maxWidth !== undefined && n.maxWidth !== null) props.maxWidth = n.maxWidth;
    if (n.minHeight !== undefined && n.minHeight !== null) props.minHeight = n.minHeight;
    if (n.maxHeight !== undefined && n.maxHeight !== null) props.maxHeight = n.maxHeight;
    if (n.clipsContent) props.clipsContent = true;
  } catch (e) { /* leaf node without layout props */ }

  // Visual (guard figma.mixed). Each getter THROWS on node types that lack it (e.g. TEXT/leaf),
  // so wrap each access in its own try/catch — a leaf simply contributes nothing.
  try { if (n.fills && n.fills !== figma.mixed && n.fills.length > 0) props.fills = n.fills; } catch (e) {}
  try { if (n.strokes && n.strokes.length > 0) props.strokes = n.strokes; } catch (e) {}
  try { if (n.strokeWeight !== undefined && n.strokeWeight !== 0 && n.strokeWeight !== figma.mixed) props.strokeWeight = n.strokeWeight; } catch (e) {}
  try { if (n.cornerRadius !== undefined && n.cornerRadius !== 0 && n.cornerRadius !== figma.mixed) props.cornerRadius = n.cornerRadius; } catch (e) {}
  try { if (n.effects && n.effects.length > 0) props.effects = n.effects; } catch (e) {}
  try { if (n.opacity !== undefined && n.opacity < 1) props.opacity = n.opacity; } catch (e) {}

  // Typography
  if (n.type === "TEXT") {
    try { props.characters = n.characters; } catch (e) {}
    try { if (n.fontSize !== figma.mixed) props.fontSize = n.fontSize; } catch (e) {}
    try { if (n.fontName !== figma.mixed) { props.fontFamily = n.fontName.family; props.fontStyle = n.fontName.style; } } catch (e) {}
    try { if (n.fontWeight !== figma.mixed) props.fontWeight = n.fontWeight; } catch (e) {}
    try { if (n.lineHeight !== figma.mixed) props.lineHeight = n.lineHeight; } catch (e) {}
    try { if (n.letterSpacing !== figma.mixed) props.letterSpacing = n.letterSpacing; } catch (e) {}
    try { if (n.textAlignHorizontal) props.textAlignHorizontal = n.textAlignHorizontal; } catch (e) {}
    try { if (n.textAlignVertical) props.textAlignVertical = n.textAlignVertical; } catch (e) {}
    try { if (n.textAutoResize && n.textAutoResize !== "NONE") props.textAutoResize = n.textAutoResize; } catch (e) {}
    try { if (n.textTruncation && n.textTruncation !== "DISABLED") props.textTruncation = n.textTruncation; } catch (e) {}
    try { if (n.textCase && n.textCase !== "ORIGINAL") props.textCase = n.textCase; } catch (e) {}
    try { if (n.textDecoration && n.textDecoration !== "NONE") props.textDecoration = n.textDecoration; } catch (e) {}
  }

  // Resolved design tokens
  try { const resolved = resolveBoundVars(n.boundVariables); if (resolved) props.boundVariables = resolved; } catch (e) {}

  // Prototype interactions
  try {
    if (n.reactions && n.reactions.length > 0) {
      props.reactions = n.reactions.map((r) => {
        const reaction = { trigger: r.trigger };
        if (r.action) {
          reaction.action = { type: r.action.type };
          if (r.action.navigation) reaction.action.navigation = r.action.navigation;
          if (r.action.transition) reaction.action.transition = r.action.transition;
          if (r.action.destinationId) reaction.action.destinationId = r.action.destinationId;
        }
        return reaction;
      });
    }
  } catch (e) {}

  // Dev-mode annotations
  try {
    if (n.annotations && n.annotations.length > 0) {
      props.annotations = n.annotations.map((a) => {
        const ann = {};
        if (a.labelMarkdown) ann.labelMarkdown = a.labelMarkdown;
        else if (a.label) ann.label = a.label;
        if (a.properties) ann.properties = a.properties;
        if (a.categoryId) ann.categoryId = a.categoryId;
        return ann;
      });
    }
  } catch (e) {}

  // Instance references
  if (n.type === "INSTANCE") {
    try {
      if (n.mainComponent) {
        props.mainComponent = {
          id: n.mainComponent.id,
          name: n.mainComponent.name,
          key: n.mainComponent.key || null,
          isVariant: !!(n.mainComponent.parent && n.mainComponent.parent.type === "COMPONENT_SET")
        };
        if (props.mainComponent.isVariant && n.mainComponent.parent) {
          props.mainComponent.componentSetName = n.mainComponent.parent.name;
          props.mainComponent.componentSetId = n.mainComponent.parent.id;
        }
      }
    } catch (e) {}
    try { if (n.componentProperties) props.componentProperties = n.componentProperties; } catch (e) {}
  }

  // Component definitions
  if (n.type === "COMPONENT_SET" || n.type === "COMPONENT") {
    try { if (n.componentPropertyDefinitions) props.componentPropertyDefinitions = n.componentPropertyDefinitions; } catch (e) {}
    if (n.type === "COMPONENT" && n.variantProperties) props.variantProperties = n.variantProperties;
  }

  // Dimensions
  try { props.width = Math.round(n.width); props.height = Math.round(n.height); } catch (e) {}

  return props;
}

function walkNode(n, currentDepth) {
  const nodeData = { id: n.id, name: n.name, type: n.type, visible: n.visible };

  // Skip invisible non-component nodes (variants stay visible even when hidden).
  if (!n.visible && n.type !== "COMPONENT") {
    nodeData._hidden = true;
    return nodeData;
  }

  const props = extractNodeProps(n);
  for (const k of Object.keys(props)) nodeData[k] = props[k];

  if ("children" in n && n.children && currentDepth < DEPTH) {
    nodeData.children = [];
    for (const child of n.children) {
      try { nodeData.children.push(walkNode(child, currentDepth + 1)); } catch (e) { /* inaccessible slot sublayer */ }
    }
  } else if ("children" in n && n.children) {
    nodeData.childCount = n.children.length;
    nodeData._depthLimitReached = true;
  }

  return nodeData;
}

const result = walkNode(rootNode, 0);
result._variableMapSize = Object.keys(varNameMap).length;
result._maxDepthUsed = DEPTH;
result.affectedNodeIds = [NODE_ID];
return result;
