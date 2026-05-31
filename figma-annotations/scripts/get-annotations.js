// Read annotations from a Figma node (and optionally its children).
// Run via use_figma with skillNames: "figma-annotations".
// Edit the constants, then run. Returns the node's annotations + available categories.

const NODE_ID = '695:313';        // node to read annotations from
const INCLUDE_CHILDREN = false;   // also read annotations from descendant nodes
const MAX_DEPTH = 1;              // how many levels deep to walk when INCLUDE_CHILDREN (1–10)

const node = await figma.getNodeByIdAsync(NODE_ID);
if (!node) throw new Error('Node not found: ' + NODE_ID);

// Resolve category IDs → names for readable output
let categories = [];
try {
  categories = await figma.annotations.getAnnotationCategoriesAsync();
} catch (e) {
  // Categories may be unavailable on some files — continue without names
}
const categoryMap = {};
for (const c of categories) categoryMap[c.id] = c.label; // AnnotationCategory exposes .label, not .name

function extractAnnotations(n) {
  const anns = n.annotations || [];
  return anns.map((ann) => ({
    label: ann.label || null,
    labelMarkdown: ann.labelMarkdown || null,
    properties: ann.properties ? ann.properties.map((p) => ({ type: p.type })) : null,
    categoryId: ann.categoryId || null,
    categoryName: ann.categoryId && categoryMap[ann.categoryId] ? categoryMap[ann.categoryId] : null,
  }));
}

const nodeAnnotations = extractAnnotations(node);
const childAnnotations = [];

if (INCLUDE_CHILDREN && 'children' in node && node.children) {
  const walk = (parent, depth) => {
    if (depth > MAX_DEPTH) return;
    if (!('children' in parent) || !parent.children) return;
    for (const child of parent.children) {
      try {
        const anns = extractAnnotations(child);
        if (anns.length > 0) {
          childAnnotations.push({ nodeId: child.id, nodeName: child.name, nodeType: child.type, annotations: anns });
        }
        if ('children' in child && child.children) walk(child, depth + 1);
      } catch (e) {
        // Skip inaccessible children (slot sublayers, etc.)
      }
    }
  };
  walk(node, 1);
}

return {
  nodeId: node.id,
  nodeName: node.name,
  nodeType: node.type,
  annotations: nodeAnnotations,
  annotationCount: nodeAnnotations.length,
  children: INCLUDE_CHILDREN ? childAnnotations : undefined,
  childAnnotationCount: INCLUDE_CHILDREN
    ? childAnnotations.reduce((sum, c) => sum + c.annotations.length, 0)
    : undefined,
  availableCategories: categories.map((c) => ({ id: c.id, label: c.label })),
};
