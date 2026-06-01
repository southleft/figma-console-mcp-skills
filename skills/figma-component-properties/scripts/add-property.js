// figma-component-properties — add / edit / delete a component property.
//
// Run via the native Figma MCP `use_figma` tool (pass skillNames: "figma-component-properties").
// Properties live on the parent COMPONENT_SET (or a standalone COMPONENT) — NOT on a variant.
// See the official figma-use skill for the execution model.

const NODE_ID = "REPLACE_WITH_COMPONENT_OR_SET_ID";
const PROPERTY_NAME = "Label";              // human-readable property name
const PROPERTY_TYPE = "TEXT";               // TEXT | BOOLEAN | INSTANCE_SWAP | VARIANT
const DEFAULT_VALUE = "Button";             // TEXT: string, BOOLEAN: true/false,
                                            // INSTANCE_SWAP: a component KEY, VARIANT: an option string
// For INSTANCE_SWAP, optionally seed the swap picker with component keys:
const PREFERRED_VALUES = null;              // e.g. [{ type: "COMPONENT", key: "abc123..." }]

const node = await figma.getNodeByIdAsync(NODE_ID);
if (!node) throw new Error("Node not found: " + NODE_ID);
if (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") {
  throw new Error("Node must be a COMPONENT or COMPONENT_SET. Got: " + node.type);
}
// Variants can't own properties — they belong to the parent set.
if (node.type === "COMPONENT" && node.parent && node.parent.type === "COMPONENT_SET") {
  throw new Error("Cannot add properties to a variant. Add to the parent COMPONENT_SET (id " + node.parent.id + ") instead.");
}

const options = PREFERRED_VALUES ? { preferredValues: PREFERRED_VALUES } : undefined;

// addComponentProperty returns the property name WITH a #id suffix (for non-variant props) —
// keep it for later edits/deletes and for binding the property in the Figma UI.
const propertyNameWithId = node.addComponentProperty(PROPERTY_NAME, PROPERTY_TYPE, DEFAULT_VALUE, options);

// --- To EDIT an existing property, comment out the add above and use this instead ---
// const propertyNameWithId = node.editComponentProperty(PROPERTY_NAME /* or the suffixed name */, {
//   name: "NewName",          // optional rename
//   defaultValue: "New default",
//   // preferredValues: [...]  // INSTANCE_SWAP only
// });

// --- To DELETE a property ---
// node.deleteComponentProperty(PROPERTY_NAME /* or the suffixed name */);

return {
  nodeId: node.id,
  nodeName: node.name,
  propertyName: propertyNameWithId,
  affectedNodeIds: [node.id],
  // Echo the full current definitions so the caller can verify.
  componentPropertyDefinitions: node.componentPropertyDefinitions || {}
};
