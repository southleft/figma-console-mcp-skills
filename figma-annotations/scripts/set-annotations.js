// Write annotations to a Figma node. Run via use_figma with skillNames: "figma-annotations".
// Edit the constants, then run. Undoable in Figma (Cmd+Z).
//
// To list valid categoryId values first, run this one-liner instead:
//   return (await figma.annotations.getAnnotationCategoriesAsync()).map(c => ({ id: c.id, label: c.label, color: c.color }));

const NODE_ID = '695:313';
const MODE = 'replace';   // 'replace' overwrites all annotations | 'append' keeps existing ones

// Each annotation: { label?, labelMarkdown?, properties?: [{ type }], categoryId? }
// Property `type` values must come from references/annotation-properties.md (e.g. 'fills', 'fontSize').
// Pass [] with MODE 'replace' to clear all annotations on the node.
const ANNOTATIONS = [
  {
    labelMarkdown: 'Hover: background lightens 8%, **200ms ease-out**. Focus ring uses `--focus-ring`.',
    properties: [{ type: 'fills' }, { type: 'cornerRadius' }],
    // categoryId: 'optional-category-id-from-categories-list',
  },
];

const node = await figma.getNodeByIdAsync(NODE_ID);
if (!node) throw new Error('Node not found: ' + NODE_ID);
if (!('annotations' in node)) throw new Error('Node type ' + node.type + ' does not support annotations');

// Build the new annotations from input
let newAnnotations = ANNOTATIONS.map((input) => {
  const ann = {};
  if (input.label) ann.label = input.label;
  if (input.labelMarkdown) ann.labelMarkdown = input.labelMarkdown;
  if (input.properties && input.properties.length > 0) {
    ann.properties = input.properties.map((p) => ({ type: p.type }));
  }
  if (input.categoryId) ann.categoryId = input.categoryId;
  return ann;
});

// Append mode: prepend a normalized copy of existing annotations.
// Figma auto-populates both label and labelMarkdown on read but rejects writing both —
// prefer labelMarkdown when present.
if (MODE === 'append') {
  const existing = (node.annotations || []).map((ex) => {
    const copy = {};
    if (ex.labelMarkdown) copy.labelMarkdown = ex.labelMarkdown;
    else if (ex.label) copy.label = ex.label;
    if (ex.properties) copy.properties = ex.properties.map((p) => ({ type: p.type }));
    if (ex.categoryId) copy.categoryId = ex.categoryId;
    return copy;
  });
  newAnnotations = existing.concat(newAnnotations);
}

node.annotations = newAnnotations;

return {
  nodeId: node.id,
  nodeName: node.name,
  annotationCount: newAnnotations.length,
  mode: MODE,
  note: 'Annotations set. Undoable in Figma (Cmd+Z).',
};
