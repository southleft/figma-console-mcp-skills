// figma-arrange-component-set — organize variants into a labeled grid with a titled container.
//
// Run via the native Figma MCP `use_figma` tool (pass skillNames: "figma-arrange-component-set").
// Inputs (edit the constants):
//   COMPONENT_SET_ID — id of the COMPONENT_SET, or "" to use the current selection.
//   COLUMN_PROPERTY  — property to use for columns, or null to auto-pick the last property.
//   GAP / CELL_PADDING — spacing tuning.
// See the official figma-use skill for the execution model.

const COMPONENT_SET_ID = "REPLACE_WITH_COMPONENT_SET_ID"; // or ""
const COMPONENT_SET_NAME = ""; // resolve by name when no id/selection, e.g. "Button"
const COLUMN_PROPERTY = null; // e.g. "State"; null = auto (last property)
const GAP = 24;
const CELL_PADDING = 20;

// Layout constants
const LABEL_FONT_SIZE = 12;
const LABEL_COLOR = { r: 0.4, g: 0.4, b: 0.4 };
const TITLE_FONT_SIZE = 24;
const TITLE_COLOR = { r: 0.1, g: 0.1, b: 0.1 };
const CONTAINER_PADDING = 40;
const LABEL_GAP = 16;
const COLUMN_HEADER_HEIGHT = 32;
const EDGE_PADDING = 24; // padding inside the component set

// --- Resolve the component set ---
let componentSet = null;
if (COMPONENT_SET_ID && COMPONENT_SET_ID.indexOf("REPLACE") === -1) {
  componentSet = await figma.getNodeByIdAsync(COMPONENT_SET_ID);
} else {
  componentSet = figma.currentPage.selection.find((n) => n.type === "COMPONENT_SET");
}
// Resolve by name when no id/selection (Console figma_arrange_component_set fallback).
if (!componentSet && COMPONENT_SET_NAME) {
  componentSet = figma.currentPage.findAll((n) => n.type === "COMPONENT_SET" && n.name === COMPONENT_SET_NAME)[0] || null;
}
if (!componentSet || componentSet.type !== "COMPONENT_SET") {
  throw new Error("Component set not found. Set COMPONENT_SET_ID, COMPONENT_SET_NAME, or select a COMPONENT_SET on the canvas.");
}

const page = figma.currentPage;
const csOriginalX = componentSet.x;
const csOriginalY = componentSet.y;
const csOriginalName = componentSet.name;

const variants = componentSet.children.filter((n) => n.type === "COMPONENT");
if (variants.length === 0) throw new Error("No variants found in component set");

const parseVariantName = (name) => {
  const props = {};
  for (const part of name.split(", ")) {
    const [key, value] = part.split("=");
    if (key && value) props[key.trim()] = value.trim();
  }
  return props;
};

// Collect properties + unique values (preserving encounter order).
const propertyValues = {};
const propertyOrder = [];
for (const variant of variants) {
  const props = parseVariantName(variant.name);
  for (const [key, value] of Object.entries(props)) {
    if (!propertyValues[key]) { propertyValues[key] = new Set(); propertyOrder.push(key); }
    propertyValues[key].add(value);
  }
}
for (const key of Object.keys(propertyValues)) propertyValues[key] = Array.from(propertyValues[key]);

const columnProp = COLUMN_PROPERTY || propertyOrder[propertyOrder.length - 1];
const columnValues = propertyValues[columnProp] || [];
const rowProps = propertyOrder.filter((p) => p !== columnProp);

// Cartesian product of the non-column properties → one row per combination.
const generateRowCombinations = (props, values) => {
  if (props.length === 0) return [{}];
  if (props.length === 1) return values[props[0]].map((v) => ({ [props[0]]: v }));
  const result = [];
  const [firstProp, ...restProps] = props;
  const restCombos = generateRowCombinations(restProps, values);
  for (const value of values[firstProp]) for (const combo of restCombos) result.push({ [firstProp]: value, ...combo });
  return result;
};
const rowCombinations = generateRowCombinations(rowProps, propertyValues);

const totalCols = columnValues.length;
const totalRows = rowCombinations.length;

let maxVariantWidth = 0, maxVariantHeight = 0;
for (const v of variants) {
  if (v.width > maxVariantWidth) maxVariantWidth = v.width;
  if (v.height > maxVariantHeight) maxVariantHeight = v.height;
}
const cellWidth = Math.ceil(maxVariantWidth + CELL_PADDING);
const cellHeight = Math.ceil(maxVariantHeight + CELL_PADDING);
const csWidth = totalCols * cellWidth + (totalCols - 1) * GAP + EDGE_PADDING * 2;
const csHeight = totalRows * cellHeight + (totalRows - 1) * GAP + EDGE_PADDING * 2;

// STEP 1: Remove old labels/containers from a previous run (idempotent re-runs).
const oldElements = page.children.filter((n) =>
  (n.type === "TEXT" && (n.name.startsWith("Row: ") || n.name.startsWith("Col: "))) ||
  (n.type === "FRAME" && (n.name === "Component Container" || n.name === "Row Labels" || n.name === "Column Headers"))
);
for (const el of oldElements) el.remove();

// STEP 2: Clone variants, delete old set, recreate via combineAsVariants for native styling.
const clonedVariants = [];
for (const variant of variants) { const clone = variant.clone(); page.appendChild(clone); clonedVariants.push(clone); }
componentSet.remove();

const newComponentSet = figma.combineAsVariants(clonedVariants, page);
newComponentSet.name = csOriginalName;
newComponentSet.strokes = [{ type: "SOLID", color: { r: 151 / 255, g: 71 / 255, b: 255 / 255 } }]; // #9747FF
newComponentSet.dashPattern = [10, 5];
newComponentSet.strokeWeight = 1;
newComponentSet.strokeAlign = "INSIDE";

// STEP 3: Position each variant in its grid cell, centered.
const newVariants = newComponentSet.children.filter((n) => n.type === "COMPONENT");
for (const variant of newVariants) {
  const props = parseVariantName(variant.name);
  const colIdx = columnValues.indexOf(props[columnProp]);
  let rowIdx = -1;
  for (let i = 0; i < rowCombinations.length; i++) {
    let match = true;
    for (const [key, value] of Object.entries(rowCombinations[i])) if (props[key] !== value) { match = false; break; }
    if (match) { rowIdx = i; break; }
  }
  if (colIdx >= 0 && rowIdx >= 0) {
    const cellX = EDGE_PADDING + colIdx * (cellWidth + GAP);
    const cellY = EDGE_PADDING + rowIdx * (cellHeight + GAP);
    variant.x = Math.round(cellX + (cellWidth - variant.width) / 2);
    variant.y = Math.round(cellY + (cellHeight - variant.height) / 2);
  }
}
newComponentSet.resize(csWidth, csHeight);

// STEP 4: Build the white container (title + content row).
await figma.loadFontAsync({ family: "Inter", style: "Regular" });
await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });

const containerFrame = figma.createFrame();
containerFrame.name = "Component Container";
containerFrame.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
containerFrame.cornerRadius = 8;
containerFrame.layoutMode = "VERTICAL";
containerFrame.primaryAxisSizingMode = "AUTO";
containerFrame.counterAxisSizingMode = "AUTO";
containerFrame.paddingTop = CONTAINER_PADDING;
containerFrame.paddingRight = CONTAINER_PADDING;
containerFrame.paddingBottom = CONTAINER_PADDING;
containerFrame.paddingLeft = CONTAINER_PADDING;
containerFrame.itemSpacing = 24;

const titleText = figma.createText();
titleText.name = "Title";
titleText.characters = csOriginalName;
titleText.fontSize = TITLE_FONT_SIZE;
titleText.fontName = { family: "Inter", style: "Semi Bold" };
titleText.fills = [{ type: "SOLID", color: TITLE_COLOR }];
containerFrame.appendChild(titleText); // append BEFORE setting layoutSizing
titleText.layoutSizingHorizontal = "HUG";
titleText.layoutSizingVertical = "HUG";

const contentRow = figma.createFrame();
contentRow.name = "Content Row";
contentRow.fills = [];
contentRow.layoutMode = "HORIZONTAL";
contentRow.primaryAxisSizingMode = "AUTO";
contentRow.counterAxisSizingMode = "AUTO";
contentRow.itemSpacing = LABEL_GAP;
contentRow.counterAxisAlignItems = "MIN";
containerFrame.appendChild(contentRow);

// STEP 5: Row labels (left column), vertically centered on each row.
const rowLabelsFrame = figma.createFrame();
rowLabelsFrame.name = "Row Labels";
rowLabelsFrame.fills = [];
rowLabelsFrame.layoutMode = "VERTICAL";
rowLabelsFrame.primaryAxisSizingMode = "AUTO";
rowLabelsFrame.counterAxisSizingMode = "AUTO";
rowLabelsFrame.counterAxisAlignItems = "MAX";
rowLabelsFrame.itemSpacing = 0;

const rowLabelSpacer = figma.createFrame();
rowLabelSpacer.name = "Spacer";
rowLabelSpacer.fills = [];
rowLabelSpacer.resize(10, COLUMN_HEADER_HEIGHT + GAP + EDGE_PADDING);
rowLabelsFrame.appendChild(rowLabelSpacer);
rowLabelSpacer.layoutSizingVertical = "FIXED";

for (let i = 0; i < rowCombinations.length; i++) {
  const combo = rowCombinations[i];
  const labelText = rowProps.map((p) => combo[p]).join(" / ");
  const isLastRow = i === rowCombinations.length - 1;

  const rowLabelContainer = figma.createFrame();
  rowLabelContainer.name = "Row: " + labelText;
  rowLabelContainer.fills = [];
  rowLabelContainer.layoutMode = "VERTICAL";
  rowLabelContainer.primaryAxisSizingMode = "FIXED";
  rowLabelContainer.primaryAxisAlignItems = "CENTER";
  rowLabelContainer.counterAxisAlignItems = "MAX";
  rowLabelContainer.resize(10, cellHeight);

  const label = figma.createText();
  label.characters = labelText;
  label.fontSize = LABEL_FONT_SIZE;
  label.fontName = { family: "Inter", style: "Regular" };
  label.fills = [{ type: "SOLID", color: LABEL_COLOR }];
  label.textAlignHorizontal = "RIGHT";
  rowLabelContainer.appendChild(label);

  rowLabelsFrame.appendChild(rowLabelContainer);
  rowLabelContainer.layoutSizingHorizontal = "HUG";
  rowLabelContainer.layoutSizingVertical = "FIXED";

  if (!isLastRow) {
    const gapSpacer = figma.createFrame();
    gapSpacer.name = "Row Gap";
    gapSpacer.fills = [];
    gapSpacer.resize(1, GAP);
    rowLabelsFrame.appendChild(gapSpacer);
    gapSpacer.layoutSizingHorizontal = "FIXED";
    gapSpacer.layoutSizingVertical = "FIXED";
  }
}
contentRow.appendChild(rowLabelsFrame);

// STEP 6: Grid column = column headers + the component set in a wrapper.
const gridColumn = figma.createFrame();
gridColumn.name = "Grid Column";
gridColumn.fills = [];
gridColumn.layoutMode = "VERTICAL";
gridColumn.primaryAxisSizingMode = "AUTO";
gridColumn.counterAxisSizingMode = "AUTO";
gridColumn.itemSpacing = GAP;

const columnHeadersRow = figma.createFrame();
columnHeadersRow.name = "Column Headers";
columnHeadersRow.fills = [];
columnHeadersRow.layoutMode = "HORIZONTAL";
columnHeadersRow.resize(csWidth, COLUMN_HEADER_HEIGHT);
columnHeadersRow.itemSpacing = 0;
columnHeadersRow.paddingLeft = EDGE_PADDING;
columnHeadersRow.paddingRight = EDGE_PADDING;

for (let i = 0; i < columnValues.length; i++) {
  const colValue = columnValues[i];
  const isLastCol = i === columnValues.length - 1;

  const colHeaderContainer = figma.createFrame();
  colHeaderContainer.name = "Col: " + colValue;
  colHeaderContainer.fills = [];
  colHeaderContainer.layoutMode = "HORIZONTAL";
  colHeaderContainer.primaryAxisAlignItems = "CENTER";
  colHeaderContainer.counterAxisAlignItems = "MAX";
  const colW = isLastCol ? cellWidth : cellWidth + GAP;
  colHeaderContainer.resize(colW, COLUMN_HEADER_HEIGHT);
  if (!isLastCol) colHeaderContainer.paddingRight = GAP;

  const label = figma.createText();
  label.characters = colValue;
  label.fontSize = LABEL_FONT_SIZE;
  label.fontName = { family: "Inter", style: "Regular" };
  label.fills = [{ type: "SOLID", color: LABEL_COLOR }];
  label.textAlignHorizontal = "CENTER";
  colHeaderContainer.appendChild(label);

  columnHeadersRow.appendChild(colHeaderContainer);
  colHeaderContainer.layoutSizingHorizontal = "FIXED";
  colHeaderContainer.layoutSizingVertical = "FILL";
}
gridColumn.appendChild(columnHeadersRow);
columnHeadersRow.layoutSizingHorizontal = "FIXED";
columnHeadersRow.layoutSizingVertical = "FIXED";

const componentSetWrapper = figma.createFrame();
componentSetWrapper.name = "Component Set Wrapper";
componentSetWrapper.fills = [];
componentSetWrapper.resize(csWidth, csHeight);
componentSetWrapper.appendChild(newComponentSet);
newComponentSet.x = 0;
newComponentSet.y = 0;

gridColumn.appendChild(componentSetWrapper);
componentSetWrapper.layoutSizingHorizontal = "FIXED";
componentSetWrapper.layoutSizingVertical = "FIXED";
contentRow.appendChild(gridColumn);

containerFrame.x = csOriginalX - CONTAINER_PADDING - 120;
containerFrame.y = csOriginalY - CONTAINER_PADDING - TITLE_FONT_SIZE - 24 - COLUMN_HEADER_HEIGHT - GAP;

figma.currentPage.selection = [containerFrame];
figma.viewport.scrollAndZoomIntoView([containerFrame]);

return {
  success: true,
  containerId: containerFrame.id,
  componentSetId: newComponentSet.id,
  componentSetName: newComponentSet.name,
  affectedNodeIds: [containerFrame.id, newComponentSet.id],
  grid: {
    rows: totalRows,
    columns: totalCols,
    cellWidth: cellWidth,
    cellHeight: cellHeight,
    gap: GAP,
    columnProperty: columnProp,
    columnValues: columnValues,
    rowProperties: rowProps,
    rowLabels: rowCombinations.map((combo) => rowProps.map((p) => combo[p]).join(" / "))
  },
  componentSetSize: { width: csWidth, height: csHeight },
  variantCount: newVariants.length
};
