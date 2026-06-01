---
name: figma-arrange-component-set
description: "Organize a Figma COMPONENT_SET's variants into a clean, labeled grid — rows and columns derived from the variant properties, with row labels on the left, column headers on top, and a titled white container. Use when a variant set is a messy pile and you want a presentable, documentation-ready layout — triggers: 'arrange my variants in a grid', 'organize this component set', 'lay out the variants with labels', 'make a variant matrix', 'clean up my component set layout', 'add row/column headers to my variants'. Picks the last property (usually State) as columns and the rest as rows by default. NOT something the native MCP's read-only tools do — this writes a new organized layout to the canvas."
disable-model-invocation: false
---

# figma-arrange-component-set — labeled variant grid

Reorganize the variants inside a `COMPONENT_SET` into a tidy matrix: it parses each variant's
properties (`Size=md, State=hover`), uses one property for columns and the rest for rows, centers
each variant in a grid cell, and wraps everything in a white container frame with a title, left-edge
row labels, and top column headers. The result is the kind of variant sheet you'd show in design-system
docs.

## Skill boundaries
- **`use_figma` rules** — load the official **`figma-use`** skill first; it is the full Figma Plugin API reference. Essentials these scripts rely on: plain JS with top-level `await` + `return` (no IIFE, no `figma.closePlugin()`; `console.log` is not returned), inputs inlined as `const` at the top of each script, colors in 0–1 range, load fonts before any text op, `await figma.getNodeByIdAsync(...)`, and **atomic errors** (a failed script applies nothing — read the error, fix, retry).
- **Understanding what the variants mean** (state machine, CSS) → use `figma-analyze-component-set`.
- This **writes a new layout** to the canvas — it is a design-system authoring capability the native
  MCP's `get_design_context` / `get_metadata` (read-only) do not cover.

## Workflow

1. **Identify the set.** Get the `COMPONENT_SET_ID` from selection, search, or a pasted id. (You can
   also leave the constant blank and select the set on the canvas — the script falls back to the
   current selection.)
2. **Pick the column axis (optional).** By default the *last* variant property becomes columns
   (usually `State`); everything else becomes rows. Override with `const COLUMN_PROPERTY`.
3. **Run** [`scripts/arrange-component-set.js`](scripts/arrange-component-set.js) via `use_figma`
   (`skillNames: "figma-arrange-component-set"`). Adjust `GAP` / `CELL_PADDING` constants if needed.
4. **Verify visually.** Take a screenshot. The script returns `containerId`, the (re-created)
   `componentSetId`, and the grid shape (rows/columns, labels). Variants are centered per cell.

## How it works
- **Re-creates the set with `figma.combineAsVariants()`** so it gets Figma's native purple dashed
  frame (`#9747FF`, dashed `[10,5]`, inside stroke). Old labels/containers from a previous run are
  removed first, so re-running is idempotent.
- **Grid math**: cell size = max variant size + padding; the set is resized to fit
  `cols × (cell+gap)`. Variants are positioned by matching their parsed property values to the
  row/column index.
- **Labels are auto-layout frames** built *outside* the component set (component sets don't nest
  well in auto-layout) and aligned to each row's vertical center / each column's horizontal center.

## Notes
- **Fonts**: the script loads `Inter Regular` + `Inter Semi Bold` for labels — if Inter isn't
  available in the file, swap the family in the `loadFontAsync` calls.
- **Destructive-ish**: it deletes the original set and rebuilds it via clones. The variants and their
  properties are preserved, but the node id of the set changes (returned as `componentSetId`).
- **One property → columns**: if your set has a single property axis, all variants land in one row.
  Multi-axis sets generate every row combination (cartesian product of the non-column properties).
