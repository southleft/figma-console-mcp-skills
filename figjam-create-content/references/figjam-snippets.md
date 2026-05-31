# FigJam operations — copy-paste `use_figma` snippets

Each snippet is a complete `use_figma` script (plain JS, top-level `await`, `return`). Edit the
constants, run, and check the returned IDs. Pass `skillNames: "figjam-create-content"`.
**FigJam files only** — every op throws if `figma.editorType !== 'figjam'`.

Quick check before anything: `return { editorType: figma.editorType };`

Sticky color palette (use the names, case-insensitive): `YELLOW`, `BLUE`, `GREEN`, `PINK`, `ORANGE`,
`PURPLE`, `RED`, `LIGHT_GRAY`, `GRAY`.

## Create a sticky note

```js
const TEXT = 'Idea: dark mode';
const X = 0, Y = 0;
const COLOR = 'YELLOW';   // palette name, or omit for default

const sticky = figma.createSticky();
await figma.loadFontAsync(sticky.text.fontName);
sticky.text.characters = TEXT;
sticky.x = X; sticky.y = Y;
const palette = { YELLOW:{r:1,g:0.85,b:0.4}, BLUE:{r:0.53,g:0.78,b:1}, GREEN:{r:0.55,g:0.87,b:0.53}, PINK:{r:1,g:0.6,b:0.78}, ORANGE:{r:1,g:0.71,b:0.42}, PURPLE:{r:0.78,g:0.65,b:1}, RED:{r:1,g:0.55,b:0.55}, LIGHT_GRAY:{r:0.9,g:0.9,b:0.9}, GRAY:{r:0.7,g:0.7,b:0.7} };
if (COLOR && palette[COLOR.toUpperCase()]) sticky.fills = [{ type: 'SOLID', color: palette[COLOR.toUpperCase()] }];
return { id: sticky.id, type: sticky.type, x: sticky.x, y: sticky.y };
```

## Batch create stickies

```js
const STICKIES = [
  { text: 'Discover', x: 0,   y: 0, color: 'BLUE' },
  { text: 'Define',   x: 220, y: 0, color: 'GREEN' },
  { text: 'Deliver',  x: 440, y: 0, color: 'PURPLE' },
];

const palette = { YELLOW:{r:1,g:0.85,b:0.4}, BLUE:{r:0.53,g:0.78,b:1}, GREEN:{r:0.55,g:0.87,b:0.53}, PINK:{r:1,g:0.6,b:0.78}, ORANGE:{r:1,g:0.71,b:0.42}, PURPLE:{r:0.78,g:0.65,b:1}, RED:{r:1,g:0.55,b:0.55}, LIGHT_GRAY:{r:0.9,g:0.9,b:0.9}, GRAY:{r:0.7,g:0.7,b:0.7} };
const created = [];
let fontLoaded = false;
for (const spec of STICKIES) {
  const s = figma.createSticky();
  if (!fontLoaded) { await figma.loadFontAsync(s.text.fontName); fontLoaded = true; }
  s.text.characters = spec.text || '';
  if (typeof spec.x === 'number') s.x = spec.x;
  if (typeof spec.y === 'number') s.y = spec.y;
  if (spec.color && palette[spec.color.toUpperCase()]) s.fills = [{ type: 'SOLID', color: palette[spec.color.toUpperCase()] }];
  created.push({ id: s.id, x: s.x, y: s.y });
}
return { created: created.length, results: created };
```

## Create a connector between two nodes

Create the endpoints first (e.g. with the sticky/shape snippets), then pass their IDs here.

```js
const START_NODE_ID = '1:23';
const END_NODE_ID = '1:24';
const START_MAGNET = 'AUTO';  // AUTO | TOP | BOTTOM | LEFT | RIGHT
const END_MAGNET = 'AUTO';
const LABEL = 'then';         // optional

const start = await figma.getNodeByIdAsync(START_NODE_ID);
const end = await figma.getNodeByIdAsync(END_NODE_ID);
if (!start) throw new Error('Start node not found: ' + START_NODE_ID);
if (!end) throw new Error('End node not found: ' + END_NODE_ID);

const connector = figma.createConnector();
connector.connectorStart = { endpointNodeId: START_NODE_ID, magnet: START_MAGNET };
connector.connectorEnd = { endpointNodeId: END_NODE_ID, magnet: END_MAGNET };
if (LABEL) {
  try { await figma.loadFontAsync(connector.text.fontName); }
  catch (e) { await figma.loadFontAsync({ family: 'Inter', style: 'Medium' }); connector.text.fontName = { family: 'Inter', style: 'Medium' }; }
  connector.text.characters = LABEL;
}
return { id: connector.id, type: connector.type };
```

## Create a shape with text

```js
const TEXT = 'Start';
// ROUNDED_RECTANGLE | ELLIPSE | DIAMOND | TRIANGLE_UP | TRIANGLE_DOWN | PARALLELOGRAM_RIGHT | PARALLELOGRAM_LEFT
// engineering shapes: ENG_DATABASE | ENG_QUEUE | ENG_FILE | ENG_FOLDER
const SHAPE_TYPE = 'ROUNDED_RECTANGLE';
const X = 0, Y = 0, WIDTH = 200, HEIGHT = 100;
const FILL_HEX = '#CFE8FF';        // optional
const FONT_SIZE = 16;              // optional
const STROKE_HEX = null;           // optional stroke/border color, e.g. '#1E40AF'
const STROKE_DASH_PATTERN = null;  // optional dash pattern, comma-separated, e.g. '10,5'

function hexToRgb(hex){hex=String(hex).replace('#','');return{r:parseInt(hex.substring(0,2),16)/255,g:parseInt(hex.substring(2,4),16)/255,b:parseInt(hex.substring(4,6),16)/255};}
const shape = figma.createShapeWithText();
if (SHAPE_TYPE) shape.shapeType = SHAPE_TYPE;
shape.x = X; shape.y = Y;
shape.resize(WIDTH, HEIGHT);          // resize before setting text so text reflows
if (FILL_HEX) shape.fills = [{ type: 'SOLID', color: hexToRgb(FILL_HEX) }];
if (STROKE_HEX) { shape.strokes = [{ type: 'SOLID', color: hexToRgb(STROKE_HEX) }]; shape.strokeWeight = 1; }
if (STROKE_DASH_PATTERN) shape.dashPattern = STROKE_DASH_PATTERN.split(',').map(function(p){return parseFloat(p.trim());});
if (TEXT) {
  try { await figma.loadFontAsync(shape.text.fontName); }
  catch (e) { await figma.loadFontAsync({ family: 'Inter', style: 'Medium' }); shape.text.fontName = { family: 'Inter', style: 'Medium' }; }
  shape.text.characters = TEXT;
  if (typeof FONT_SIZE === 'number') shape.text.fontSize = FONT_SIZE;
}
return { id: shape.id, type: shape.type, x: shape.x, y: shape.y, width: shape.width, height: shape.height };
```

## Create a section

```js
const NAME = 'Brainstorm';
const X = 0, Y = 0, WIDTH = 800, HEIGHT = 600;
const FILL_HEX = '#F5F5F5';   // optional

const section = figma.createSection();
if (NAME) section.name = NAME;
section.x = X; section.y = Y;
if (typeof WIDTH === 'number' && typeof HEIGHT === 'number') section.resizeWithoutConstraints(WIDTH, HEIGHT);
if (FILL_HEX) {
  const h = FILL_HEX.replace('#','');
  section.fills = [{ type: 'SOLID', color: { r: parseInt(h.substring(0,2),16)/255, g: parseInt(h.substring(2,4),16)/255, b: parseInt(h.substring(4,6),16)/255 } }];
}
return { id: section.id, name: section.name, x: section.x, y: section.y, width: section.width, height: section.height };
```

## Create a table

```js
const ROWS = 3, COLS = 2;
const X = 0, Y = 0;
const DATA = [               // optional; row-major, clipped to ROWS x COLS
  ['Feature', 'Status'],
  ['Login', 'Done'],
  ['Export', 'In progress'],
];

const table = figma.createTable(ROWS, COLS);
table.x = X; table.y = Y;
if (Array.isArray(DATA)) {
  for (let r = 0; r < DATA.length && r < ROWS; r++) {
    for (let c = 0; c < DATA[r].length && c < COLS; c++) {
      const cell = table.cellAt(r, c);
      if (cell && DATA[r][c] != null) {
        await figma.loadFontAsync(cell.text.fontName);
        cell.text.characters = String(DATA[r][c]);
      }
    }
  }
}
return { id: table.id, type: table.type, rows: ROWS, columns: COLS };
```

## Create a code block

```js
const CODE = "const x = 1;\nconsole.log(x);";
const LANGUAGE = 'JAVASCRIPT';   // e.g. JAVASCRIPT, TYPESCRIPT, PYTHON, JSON, HTML, CSS, BASH
const X = 0, Y = 0;

const codeBlock = figma.createCodeBlock();
try { await figma.loadFontAsync({ family: 'Source Code Pro', style: 'Medium' }); }
catch (e) { await figma.loadFontAsync({ family: 'Inter', style: 'Medium' }); }
if (CODE) codeBlock.code = CODE;
if (LANGUAGE) codeBlock.codeLanguage = LANGUAGE;
codeBlock.x = X; codeBlock.y = Y;
return { id: codeBlock.id, type: codeBlock.type, x: codeBlock.x, y: codeBlock.y };
```

## Auto-arrange selected (or given) nodes

```js
const LAYOUT = 'grid';      // 'grid' | 'horizontal' | 'vertical'
const GAP = 40;
const NODE_IDS = null;       // null = use current selection; or pass an array of IDs

let nodes = [];
if (NODE_IDS && NODE_IDS.length) {
  for (const id of NODE_IDS) { const n = await figma.getNodeByIdAsync(id); if (n) nodes.push(n); }
} else {
  nodes = figma.currentPage.selection.slice();
}
if (nodes.length === 0) throw new Error('No nodes to arrange (select some or pass NODE_IDS)');

const cols = LAYOUT === 'horizontal' ? nodes.length : (LAYOUT === 'vertical' ? 1 : Math.ceil(Math.sqrt(nodes.length)));
const baseX = Math.min(...nodes.map((n) => n.x));
const baseY = Math.min(...nodes.map((n) => n.y));
const colW = Math.max(...nodes.map((n) => n.width)) + GAP;
const rowH = Math.max(...nodes.map((n) => n.height)) + GAP;
nodes.forEach((n, i) => { n.x = baseX + (i % cols) * colW; n.y = baseY + Math.floor(i / cols) * rowH; });
return { arranged: nodes.length, layout: LAYOUT };
```

## Read board contents

```js
const MAX_NODES = 500;
const FILTER_TYPES = null;   // null = all FigJam types; or e.g. ['STICKY','CONNECTOR']

const figjamTypes = ['STICKY','SHAPE_WITH_TEXT','CONNECTOR','TABLE','CODE_BLOCK','SECTION','FRAME','TEXT'];
const results = [];
for (const node of figma.currentPage.children) {
  if (results.length >= MAX_NODES) break;
  if (FILTER_TYPES && FILTER_TYPES.indexOf(node.type) === -1) continue;
  if (!FILTER_TYPES && figjamTypes.indexOf(node.type) === -1) continue;
  const e = { id: node.id, type: node.type, name: node.name, x: node.x, y: node.y, width: node.width, height: node.height };
  if (node.type === 'STICKY') e.text = node.text ? node.text.characters : '';
  else if (node.type === 'SHAPE_WITH_TEXT') { e.text = node.text ? node.text.characters : ''; e.shapeType = node.shapeType; }
  else if (node.type === 'CONNECTOR') { e.text = node.text ? node.text.characters : ''; e.connectorStart = node.connectorStart || null; e.connectorEnd = node.connectorEnd || null; }
  else if (node.type === 'CODE_BLOCK') { e.code = node.code || ''; e.codeLanguage = node.codeLanguage || ''; }
  else if (node.type === 'TABLE') { e.numRows = node.numRows; e.numColumns = node.numColumns; }
  else if (node.type === 'SECTION') e.childCount = node.children ? node.children.length : 0;
  else if (node.type === 'TEXT') e.text = node.characters || '';
  results.push(e);
}
return { nodes: results, totalFound: results.length, page: figma.currentPage.name };
```

## Read the connection graph

```js
const connectors = figma.currentPage.findAll((n) => n.type === 'CONNECTOR');
const edges = [];
const nodeMap = {};
for (const conn of connectors) {
  const startId = conn.connectorStart ? conn.connectorStart.endpointNodeId : null;
  const endId = conn.connectorEnd ? conn.connectorEnd.endpointNodeId : null;
  edges.push({ connectorId: conn.id, startNodeId: startId, endNodeId: endId, label: conn.text ? conn.text.characters : '' });
  for (const id of [startId, endId]) {
    if (id && !nodeMap[id]) {
      const n = await figma.getNodeByIdAsync(id);
      if (n) nodeMap[id] = { id, type: n.type, name: n.name, text: n.text ? n.text.characters : (n.characters || '') };
    }
  }
}
return { edges, connectedNodes: nodeMap, totalConnectors: connectors.length, totalConnectedNodes: Object.keys(nodeMap).length };
```
