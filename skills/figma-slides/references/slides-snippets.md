# Figma Slides operations — copy-paste `use_figma` snippets

Each snippet is a complete `use_figma` script (plain JS, top-level `await`, `return`). Edit the
constants, run, and check the returned IDs. Pass `skillNames: "figma-slides"`.
**Figma Slides files only** — every op throws if `figma.editorType !== 'slides'`.

Quick check before anything: `return { editorType: figma.editorType };`

## List slides

```js
const grid = figma.getSlideGrid();
const slides = [];
for (let r = 0; r < grid.length; r++) {
  const row = grid[r];
  for (let c = 0; c < row.length; c++) {
    const s = row[c];
    slides.push({ id: s.id, name: s.name, row: r, col: c, isSkippedSlide: s.isSkippedSlide, childCount: s.children ? s.children.length : 0 });
  }
}
return { slides, totalSlides: slides.length, totalRows: grid.length };
```

## Create a slide

```js
const ROW = null, COL = null;   // both numbers = place at grid position; both null = append

let slide;
if (typeof ROW === 'number' && typeof COL === 'number') slide = figma.createSlide({ row: ROW, col: COL });
else slide = figma.createSlide();
return { id: slide.id, name: slide.name };
```

## Duplicate a slide

```js
const SLIDE_ID = '10:2';
const src = await figma.getNodeByIdAsync(SLIDE_ID);
if (!src || src.type !== 'SLIDE') throw new Error('Node ' + SLIDE_ID + ' is not a SLIDE');
const clone = src.clone();
return { originalId: SLIDE_ID, newId: clone.id, name: clone.name };
```

## Delete a slide

```js
const SLIDE_ID = '10:2';
const slide = await figma.getNodeByIdAsync(SLIDE_ID);
if (!slide || slide.type !== 'SLIDE') throw new Error('Node ' + SLIDE_ID + ' is not a SLIDE');
const name = slide.name;
slide.remove();
return { deleted: SLIDE_ID, name };
```

## Reorder slides (2D grid of slide IDs)

```js
const NEW_GRID = [          // rows × columns of existing slide IDs
  ['10:2', '10:5'],
  ['10:8'],
];

const current = figma.getSlideGrid();
const slideMap = {};
for (const row of current) for (const s of row) slideMap[s.id] = s;

const rows = NEW_GRID.map((rowIds) => rowIds.map((id) => {
  const ref = slideMap[id];
  if (!ref) throw new Error('Slide not found in current grid: ' + id);
  return ref;
}));
figma.setSlideGrid(rows);
return { success: true, rows: rows.length };
```

## Add text to a slide

```js
const SLIDE_ID = '10:2';
const TEXT = 'Quarterly Review';
const X = 100, Y = 100;
const FONT_FAMILY = 'Inter', FONT_STYLE = 'Regular';
const FONT_SIZE = 48;
const COLOR_HEX = '#111111';   // optional
const TEXT_ALIGN = null;       // optional: 'LEFT' | 'CENTER' | 'RIGHT'
const WIDTH = null;            // optional fixed width (enables height auto-resize)
const LINE_HEIGHT = null;      // optional line height in pixels
const LETTER_SPACING = null;   // optional letter spacing in pixels
const TEXT_CASE = null;        // optional: 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE'

const slide = await figma.getNodeByIdAsync(SLIDE_ID);
if (!slide || slide.type !== 'SLIDE') throw new Error('Node ' + SLIDE_ID + ' is not a SLIDE');

const t = figma.createText();
await figma.loadFontAsync({ family: FONT_FAMILY, style: FONT_STYLE });
t.fontName = { family: FONT_FAMILY, style: FONT_STYLE };
t.characters = TEXT;
t.fontSize = FONT_SIZE;
t.x = X; t.y = Y;
if (COLOR_HEX) { const h = COLOR_HEX.replace('#',''); t.fills = [{ type: 'SOLID', color: { r: parseInt(h.substring(0,2),16)/255, g: parseInt(h.substring(2,4),16)/255, b: parseInt(h.substring(4,6),16)/255 } }]; }
if (TEXT_ALIGN) t.textAlignHorizontal = TEXT_ALIGN;
if (typeof WIDTH === 'number') { t.resize(WIDTH, t.height); t.textAutoResize = 'HEIGHT'; }
if (typeof LINE_HEIGHT === 'number') t.lineHeight = { value: LINE_HEIGHT, unit: 'PIXELS' };
if (typeof LETTER_SPACING === 'number') t.letterSpacing = { value: LETTER_SPACING, unit: 'PIXELS' };
if (TEXT_CASE) t.textCase = TEXT_CASE;
slide.appendChild(t);
return { id: t.id, text: t.characters };
```

## Add a shape to a slide

```js
const SLIDE_ID = '10:2';
const SHAPE_TYPE = 'RECTANGLE';  // 'RECTANGLE' | 'ELLIPSE'
const X = 100, Y = 100, WIDTH = 200, HEIGHT = 200;
const COLOR_HEX = '#2D6BE0';     // optional 6-digit hex

const slide = await figma.getNodeByIdAsync(SLIDE_ID);
if (!slide || slide.type !== 'SLIDE') throw new Error('Node ' + SLIDE_ID + ' is not a SLIDE');

const shape = SHAPE_TYPE === 'ELLIPSE' ? figma.createEllipse() : figma.createRectangle();
shape.x = X; shape.y = Y;
shape.resize(WIDTH, HEIGHT);
if (COLOR_HEX && /^#?[0-9a-fA-F]{6}$/.test(COLOR_HEX)) {
  const h = COLOR_HEX.replace('#','');
  shape.fills = [{ type: 'SOLID', color: { r: parseInt(h.substring(0,2),16)/255, g: parseInt(h.substring(2,4),16)/255, b: parseInt(h.substring(4,6),16)/255 } }];
}
slide.appendChild(shape);
return { id: shape.id, type: shape.type };
```

## Set slide background color

```js
const SLIDE_ID = '10:2';
const COLOR_HEX = '#0E1726';

const slide = await figma.getNodeByIdAsync(SLIDE_ID);
if (!slide || slide.type !== 'SLIDE') throw new Error('Node ' + SLIDE_ID + ' is not a SLIDE');

const h = COLOR_HEX.replace('#','');
const color = { r: parseInt(h.substring(0,2),16)/255, g: parseInt(h.substring(2,4),16)/255, b: parseInt(h.substring(4,6),16)/255 };

// Reuse an existing full-bleed Background rect if present, else create one at index 0
let bg = null;
for (const child of slide.children) {
  if (child.type === 'RECTANGLE' && child.name === 'Background' && child.width === 1920 && child.height === 1080) { bg = child; break; }
}
if (bg) {
  bg.fills = [{ type: 'SOLID', color }];
} else {
  bg = figma.createRectangle();
  bg.name = 'Background';
  bg.resize(1920, 1080);
  bg.x = 0; bg.y = 0;
  bg.fills = [{ type: 'SOLID', color }];
  slide.appendChild(bg);
  slide.insertChild(0, bg);
}
return { slideId: slide.id, color: COLOR_HEX, updated: !!bg };
```

## Set a slide transition

```js
const SLIDE_ID = '10:2';
const STYLE = 'DISSOLVE';   // NONE | DISSOLVE | SLIDE_FROM_LEFT/RIGHT/TOP/BOTTOM | PUSH_FROM_LEFT/RIGHT/TOP/BOTTOM | SMART_ANIMATE
const DURATION = 0.3;       // seconds
const CURVE = 'EASE_OUT';   // EASE_IN | EASE_OUT | EASE_IN_AND_OUT | LINEAR | GENTLE | QUICK | BOUNCY | SLOW
const TIMING = { type: 'ON_CLICK' };   // or { type: 'AFTER_DELAY', delay: 2 }

const slide = await figma.getNodeByIdAsync(SLIDE_ID);
if (!slide || slide.type !== 'SLIDE') throw new Error('Node ' + SLIDE_ID + ' is not a SLIDE');
slide.setSlideTransition({ style: STYLE, duration: DURATION, curve: CURVE, timing: TIMING });
return { id: slide.id, transition: slide.getSlideTransition() };
```

## Read a slide's transition

```js
const SLIDE_ID = '10:2';
const slide = await figma.getNodeByIdAsync(SLIDE_ID);
if (!slide || slide.type !== 'SLIDE') throw new Error('Node ' + SLIDE_ID + ' is not a SLIDE');
return { id: slide.id, transition: slide.getSlideTransition() };
```

## Read slide content (node tree)

```js
const SLIDE_ID = '10:2';
const slide = await figma.getNodeByIdAsync(SLIDE_ID);
if (!slide || slide.type !== 'SLIDE') throw new Error('Node ' + SLIDE_ID + ' is not a SLIDE');

function serialize(n) {
  const out = { id: n.id, type: n.type, name: n.name, x: n.x, y: n.y, width: n.width, height: n.height };
  if (n.type === 'TEXT') { out.characters = n.characters; out.fontSize = n.fontSize; }
  if (n.children && n.children.length > 0) out.children = n.children.map(serialize);
  return out;
}
return serialize(slide);
```

## Focus a slide (single-slide view)

```js
const SLIDE_ID = '10:2';
const target = await figma.getNodeByIdAsync(SLIDE_ID);
if (!target || target.type !== 'SLIDE') throw new Error('Node ' + SLIDE_ID + ' is not a SLIDE');
figma.viewport.slidesView = 'single-slide';
figma.currentPage.focusedSlide = target;
return { focused: target.id, name: target.name };
```

## Set view mode (grid / single-slide)

Toggle the viewport between the grid overview and single-slide view — e.g. a presenter
returning from a focused slide back to the grid.

```js
const MODE = 'grid';   // 'grid' | 'single-slide'
figma.viewport.slidesView = MODE;
return { mode: figma.viewport.slidesView };
```

## Get focused slide

```js
const focused = figma.currentPage.focusedSlide;
return focused ? { id: focused.id, name: focused.name } : { focused: null };
```

## Skip / unskip a slide

```js
const SLIDE_ID = '10:2';
const SKIP = true;   // true = skip in presentation, false = include
const slide = await figma.getNodeByIdAsync(SLIDE_ID);
if (!slide || slide.type !== 'SLIDE') throw new Error('Node ' + SLIDE_ID + ' is not a SLIDE');
slide.isSkippedSlide = !!SKIP;
return { id: slide.id, isSkippedSlide: slide.isSkippedSlide };
```
