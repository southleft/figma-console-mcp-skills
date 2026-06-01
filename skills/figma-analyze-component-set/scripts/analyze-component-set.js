// figma-analyze-component-set — variant state machine + CSS pseudo-class mapping + per-variant diffs.
//
// Run via the native Figma MCP `use_figma` tool (pass skillNames: "figma-analyze-component-set").
// Input: set COMPONENT_SET_ID to the id of the COMPONENT_SET (purple dashed container), NOT a variant.
// See the official figma-use skill for the execution model.

const COMPONENT_SET_ID = "REPLACE_WITH_COMPONENT_SET_ID";

const node = await figma.getNodeByIdAsync(COMPONENT_SET_ID);
if (!node) throw new Error("Node not found: " + COMPONENT_SET_ID);
if (node.type !== "COMPONENT_SET") {
  throw new Error("Node is not a COMPONENT_SET (got " + node.type + "). Pass the parent set, not an individual variant.");
}

// --- Build a variableId -> {name,collection,type} lookup so bound vars resolve to token names ---
const varNameMap = {};
try {
  const allVars = await figma.variables.getLocalVariablesAsync();
  const allColls = await figma.variables.getLocalVariableCollectionsAsync();
  const collMap = {};
  for (const c of allColls) collMap[c.id] = c.name;
  for (const v of allVars) {
    varNameMap[v.id] = { name: v.name, collection: collMap[v.variableCollectionId] || null, type: v.resolvedType };
  }
} catch (e) { /* variables may be unavailable; fall back to hex */ }

// boundVariables can reference variables that getLocalVariablesAsync() does NOT return
// (ghost/orphaned collections that remain referenceable). Pre-resolve every bound-variable
// target in the set's subtree directly so resolveVarId never leaks a raw VariableID.
async function ensureVar(id) {
  if (varNameMap[id]) return;
  try {
    const v = await figma.variables.getVariableByIdAsync(id);
    if (v) varNameMap[id] = { name: v.name, collection: null, type: v.resolvedType };
  } catch (e) { /* unreachable target — falls back to raw id */ }
}
async function preResolveBoundVars(n) {
  const bv = n.boundVariables;
  if (bv) {
    for (const prop of Object.keys(bv)) {
      const b = bv[prop];
      if (Array.isArray(b)) { for (const x of b) if (x && x.id) await ensureVar(x.id); }
      else if (b && b.id) await ensureVar(b.id);
    }
  }
  if ("children" in n && n.children) { for (const c of n.children) await preResolveBoundVars(c); }
}
await preResolveBoundVars(node);

function resolveVarId(id) {
  return varNameMap[id] ? varNameMap[id].name : id;
}

// boundVariables for fills/strokes can be an array or an object — normalize to a token name.
function resolveBoundColor(bv) {
  if (!bv) return null;
  if (Array.isArray(bv)) return bv.length > 0 && bv[0].id ? resolveVarId(bv[0].id) : null;
  if (bv.id) return resolveVarId(bv.id);
  if (bv.color && bv.color.id) return resolveVarId(bv.color.id);
  return null;
}

function toHex(c) {
  const h = (n) => Math.round((n || 0) * 255).toString(16).padStart(2, "0");
  return "#" + h(c.r) + h(c.g) + h(c.b);
}

// Extract the visual "signature" of a variant: the properties that distinguish states.
function extractSignature(variant) {
  const sig = {};

  // Pick the main interactive element: prefer a non-text child WITH strokes (input/border), then
  // the first visible FRAME child.
  let mainChild = null;
  const kids = variant.children || [];
  for (const child of kids) {
    try {
      if (child.visible !== false && child.type !== "TEXT" && child.strokes && child.strokes.length > 0) {
        mainChild = child;
        break;
      }
    } catch (e) {}
  }
  if (!mainChild) {
    for (const c2 of kids) {
      try { if (c2.visible !== false && c2.type === "FRAME") { mainChild = c2; break; } } catch (e) {}
    }
  }

  if (mainChild) {
    const child = mainChild;
    try {
      const bv = child.boundVariables || {};
      sig.fillToken = resolveBoundColor(bv.fills);
      sig.strokeToken = resolveBoundColor(bv.strokes);
      sig.strokeWeight = child.strokeWeight;
      if (!sig.fillToken && child.fills && child.fills.length > 0 && child.fills[0].color) sig.fillHex = toHex(child.fills[0].color);
      if (!sig.strokeToken && child.strokes && child.strokes.length > 0 && child.strokes[0].color) sig.strokeHex = toHex(child.strokes[0].color);
      sig.effects = child.effects && child.effects.length > 0 ? child.effects : null;
      sig.opacity = child.opacity < 1 ? child.opacity : null;
    } catch (e) {}

    // First text child's color often changes per state too.
    if ("children" in child && child.children) {
      for (const textChild of child.children) {
        if (textChild.type === "TEXT") {
          try {
            const tbv = textChild.boundVariables || {};
            sig.textToken = resolveBoundColor(tbv.fills);
            if (!sig.textToken && textChild.fills && textChild.fills.length > 0 && textChild.fills[0].color) sig.textHex = toHex(textChild.fills[0].color);
          } catch (e) {}
          break;
        }
      }
    }
  }

  // Track which named children are hidden in this variant (e.g. an error icon shown only in error).
  sig.visibilityChanges = {};
  for (const ch of kids) {
    try { if (!ch.visible) sig.visibilityChanges[ch.name] = false; } catch (e) {}
  }
  return sig;
}

// --- Parse property definitions: separate VARIANT axes from code-facing props ---
const propDefs = node.componentPropertyDefinitions || {};
const variantAxes = {};
const componentProps = {};
for (const propKey of Object.keys(propDefs)) {
  const def = propDefs[propKey];
  if (def.type === "VARIANT") {
    variantAxes[propKey] = def.variantOptions || [];
  } else {
    componentProps[propKey] = { type: def.type, defaultValue: def.defaultValue };
  }
}

// CSS pseudo-class / ARIA mapping for state-variant values (lowercased).
const stateMapping = {
  "default": null,
  "hover": ":hover",
  "focus": ":focus-visible",
  "focus-visible": ":focus-visible",
  "focused": ":focus-visible",
  "active": ":active",
  "pressed": ":active",
  "disabled": ':disabled, [aria-disabled="true"]',
  "error": '[aria-invalid="true"]',
  "invalid": '[aria-invalid="true"]',
  "filled": ".has-value",
  "selected": '[aria-selected="true"]',
  "checked": ":checked",
  "loading": '[aria-busy="true"]',
  "readonly": "[readonly]",
  "open": '[aria-expanded="true"]',
  "closed": '[aria-expanded="false"]'
};

// Detect which axis is the state axis and which is the size axis.
let stateAxis = null;
let sizeAxis = null;
for (const key of Object.keys(variantAxes)) {
  const lower = key.toLowerCase();
  if (lower === "state" || lower === "status" || lower === "interaction") stateAxis = key;
  else if (lower === "size" || lower === "scale") sizeAxis = key;
}

const variants = node.children || [];

// Find the default variant (state=default, prefer the largest size if a size axis exists).
let defaultVariant = null;
for (const v of variants) {
  if (v.name.indexOf("state=default") !== -1 && (sizeAxis ? v.name.indexOf(sizeAxis + "=") !== -1 : true)) {
    if (!defaultVariant || v.name.indexOf("large") !== -1) defaultVariant = v;
  }
}
const defaultSig = defaultVariant ? extractSignature(defaultVariant) : null;

// Process each variant: parse axis values, map state→CSS, diff against default.
const stateMachine = { states: {}, defaultState: null, cssMapping: {}, defaultSignature: null };
const variantDiffs = [];

for (const variant of variants) {
  const sig = extractSignature(variant);

  const axisValues = {};
  for (const part of variant.name.split(", ")) {
    const kv = part.split("=");
    if (kv.length === 2) axisValues[kv[0].trim()] = kv[1].trim();
  }

  const stateValue = stateAxis ? (axisValues[stateAxis] || "default") : "default";
  const cssSelector = stateMapping[stateValue.toLowerCase()] || null;

  // Diff: only properties that differ from the default variant.
  const diff = {};
  if (defaultSig && variant.id !== (defaultVariant ? defaultVariant.id : null)) {
    if (sig.fillToken !== defaultSig.fillToken) diff.fillToken = sig.fillToken || sig.fillHex;
    if (sig.strokeToken !== defaultSig.strokeToken) diff.strokeToken = sig.strokeToken || sig.strokeHex;
    if (sig.strokeWeight !== defaultSig.strokeWeight) diff.strokeWeight = sig.strokeWeight;
    if (sig.textToken !== defaultSig.textToken) diff.textToken = sig.textToken || sig.textHex;
    if (sig.opacity !== defaultSig.opacity) diff.opacity = sig.opacity;
    if (JSON.stringify(sig.effects) !== JSON.stringify(defaultSig.effects)) diff.effects = sig.effects;
    for (const k of Object.keys(sig.visibilityChanges)) {
      if (!defaultSig.visibilityChanges[k]) {
        if (!diff.visibilityChanges) diff.visibilityChanges = {};
        diff.visibilityChanges[k] = sig.visibilityChanges[k];
      }
    }
  }

  variantDiffs.push({
    name: variant.name,
    id: variant.id,
    axes: axisValues,
    state: stateValue,
    cssSelector: cssSelector,
    diffFromDefault: Object.keys(diff).length > 0 ? diff : null,
    signature: sig
  });

  if (cssSelector) stateMachine.cssMapping[stateValue] = cssSelector;
  if (!stateMachine.states[stateValue]) stateMachine.states[stateValue] = [];
  stateMachine.states[stateValue].push(variant.id);
}

if (defaultVariant) {
  stateMachine.defaultState = "default";
  stateMachine.defaultSignature = defaultSig;
}

return {
  nodeId: node.id,
  nodeName: node.name,
  variantCount: variants.length,
  variantAxes: variantAxes,
  componentProps: componentProps,
  stateAxis: stateAxis,
  sizeAxis: sizeAxis,
  stateMachine: stateMachine,
  variants: variantDiffs,
  affectedNodeIds: [node.id],
  ai_instruction:
    "Implement the default variant from stateMachine.defaultSignature, then add one CSS rule per " +
    "cssMapping entry applying only that variant's diffFromDefault. Map componentProps to framework " +
    "props: BOOLEAN→boolean, TEXT→string, INSTANCE_SWAP→ReactNode/slot, VARIANT→union type."
};
