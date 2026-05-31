// figma-component-properties — instantiate a component and set its instance properties.
//
// Run via the native Figma MCP `use_figma` tool (pass skillNames: "figma-component-properties").
// Pass COMPONENT_KEY (published library) and/or COMPONENT_ID (local). Provide both when you have them.
// See the official figma-use skill for the execution model.

const COMPONENT_KEY = null;                 // published library component key, or null
const COMPONENT_ID = "REPLACE_WITH_COMPONENT_OR_SET_ID"; // local COMPONENT / COMPONENT_SET id, or null
const VARIANT = null;                       // e.g. { Size: "md", State: "default" } — picks a variant + sets variant props
const OVERRIDES = null;                     // e.g. { Label: "Save", "Show icon": true } — TEXT/BOOLEAN/INSTANCE_SWAP
const POSITION = null;                      // e.g. { x: 100, y: 200 }
const PARENT_ID = null;                     // frame/section id to append the instance into, or null

// --- Resolve a COMPONENT to instantiate ---
let component = null;

if (COMPONENT_KEY) {
  // Try a published COMPONENT first, then a published COMPONENT_SET (use its default variant).
  try {
    component = await figma.importComponentByKeyAsync(COMPONENT_KEY);
  } catch (e) { /* not a component key, try set */ }
  if (!component) {
    try {
      const set = await figma.importComponentSetByKeyAsync(COMPONENT_KEY);
      if (set && set.type === "COMPONENT_SET") component = set.defaultVariant || set.children[0];
    } catch (e) { /* fall back to local */ }
  }
}

if (!component && COMPONENT_ID && COMPONENT_ID.indexOf("REPLACE") === -1) {
  const node = await figma.getNodeByIdAsync(COMPONENT_ID);
  if (node) {
    if (node.type === "COMPONENT") {
      component = node;
    } else if (node.type === "COMPONENT_SET" && node.children.length > 0) {
      // Match a variant by VARIANT props (exact, then partial), else use the first variant.
      if (VARIANT) {
        const target = Object.keys(VARIANT).map((k) => k + "=" + VARIANT[k]).join(", ");
        component = node.children.find((c) => c.type === "COMPONENT" && c.name === target) || null;
        if (!component) {
          component = node.children.find((c) =>
            c.type === "COMPONENT" && Object.keys(VARIANT).every((k) => c.name.indexOf(k + "=" + VARIANT[k]) !== -1)
          ) || null;
        }
      }
      if (!component) component = node.children[0];
    }
  }
}

if (!component) {
  throw new Error(
    "Component not found. componentKey only resolves PUBLISHED components; for local ones pass COMPONENT_ID. " +
    "Identifiers are session-specific — re-search if stale."
  );
}

// --- Create the instance ---
const instance = component.createInstance();
if (POSITION) { instance.x = POSITION.x || 0; instance.y = POSITION.y || 0; }
if (PARENT_ID) {
  const parent = await figma.getNodeByIdAsync(PARENT_ID);
  if (parent && "appendChild" in parent) parent.appendChild(instance);
}

// --- Apply properties. Instance keys carry "#nodeId" suffixes for TEXT/BOOLEAN/INSTANCE_SWAP;
//     VARIANT props use the bare name. Resolve both so callers can pass the human name. ---
function applyProps(updates) {
  if (!updates) return [];
  const current = instance.componentProperties;
  const toSet = {};
  for (const name of Object.keys(updates)) {
    if (current[name] !== undefined) {
      toSet[name] = updates[name];
    } else {
      const suffixed = Object.keys(current).find((k) => k.startsWith(name + "#"));
      if (suffixed) toSet[suffixed] = updates[name];
    }
  }
  if (Object.keys(toSet).length > 0) instance.setProperties(toSet);
  return Object.keys(toSet);
}

const setKeys = [];
if (VARIANT) { try { instance.setProperties(VARIANT); setKeys.push(...Object.keys(VARIANT)); } catch (e) {} }
setKeys.push(...applyProps(OVERRIDES));

const updated = instance.componentProperties;

return {
  instanceId: instance.id,
  instanceName: instance.name,
  mainComponentId: component.id,
  propertiesSet: setKeys,
  currentProperties: Object.keys(updated).reduce((acc, k) => {
    acc[k] = { type: updated[k].type, value: updated[k].value };
    return acc;
  }, {}),
  affectedNodeIds: [instance.id]
};

// --- To set properties on an EXISTING instance instead of creating one, replace the top with:
//   const INSTANCE_ID = "...";
//   const instance = await figma.getNodeByIdAsync(INSTANCE_ID);
//   if (!instance || instance.type !== "INSTANCE") throw new Error("Node must be an INSTANCE");
//   await instance.getMainComponentAsync(); // required under documentAccess: dynamic-page
//   ...then call applyProps(OVERRIDES) / instance.setProperties(VARIANT) as above.
