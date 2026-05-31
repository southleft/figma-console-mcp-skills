---
name: figjam-create-content
description: "Author FigJam boards with granular control — sticky notes (single + batch), connectors between nodes, shapes-with-text, sections, tables, code blocks, and auto-arrange — plus read back board contents and the connection graph. Use when the user wants to build or edit a FigJam board element-by-element. Triggers: 'add stickies to FigJam', 'create a flowchart/diagram in FigJam', 'connect these nodes', 'make a section/table/code block in FigJam', 'auto-arrange the board', 'read what's on the FigJam board', 'map the connections'. More granular than the native generate_diagram (which produces a whole diagram in one shot). FigJam files only (figma.editorType === 'figjam'). Requires the Figma Desktop app (Plugin API)."
disable-model-invocation: false
---

# figjam-create-content — author & read FigJam boards

Build FigJam boards one element at a time and read them back. Covers stickies (single + batch),
connectors, shapes-with-text, sections, tables, code blocks, auto-arrange, plus `get board contents`
and `get connections`. This gives you fine-grained control when the native one-shot
`generate_diagram` is too coarse (e.g. you want specific colors, positions, magnets, or to extend an
existing board).

## Skill boundaries
- **Plugin API rules** (return pattern, async getters, page reset, atomic errors) → load the official
  [`figma-use`](https://www.figma.com/community/skills) skill first; this skill assumes it.
- **Shared `use_figma` idiom + helpers** → [../references/use-figma-conventions.md](../references/use-figma-conventions.md).
- **One complete snippet per operation** → [references/figjam-snippets.md](references/figjam-snippets.md).
- **Whole-diagram generation in one call** → use the native `generate_diagram` tool instead.

## Workflow

1. **Confirm it's a FigJam file.** Every op throws outside FigJam. Check first:
   `return { editorType: figma.editorType };` — it must be `'figjam'`.
2. **Pick the operation** from [references/figjam-snippets.md](references/figjam-snippets.md): create
   sticky / stickies / connector / shape-with-text / section / table / code block, auto-arrange, or
   read board contents / connections.
3. **Run the snippet** via `use_figma` (`skillNames: "figjam-create-content"`), editing the inlined
   constants (text, position, color, node IDs).
4. **Connectors need real node IDs.** Create the nodes first, capture their returned IDs, then create
   connectors referencing those IDs (start/end + magnets).
5. **Return created IDs** and, after a batch, read the board back (`get board contents`) to confirm.

## Notes
- **Fonts must be loaded before text.** Stickies, shapes-with-text, table cells, and connector labels
  all write text — each snippet `await figma.loadFontAsync(...)` before setting `.characters`, with an
  Inter fallback where the default font may be unavailable.
- Sticky colors use a named palette (`YELLOW`, `BLUE`, `GREEN`, `PINK`, `ORANGE`, `PURPLE`, `RED`,
  `LIGHT_GRAY`, `GRAY`); other colors fall back to the default sticky fill.
- Shape `shapeType` values: `SQUARE`, `ROUNDED_RECTANGLE`, `ELLIPSE`, `DIAMOND`, `TRIANGLE_UP`,
  `TRIANGLE_DOWN`, `PARALLELOGRAM_RIGHT`, `PARALLELOGRAM_LEFT`, etc.
- Connector magnets: `AUTO`, `TOP`, `BOTTOM`, `LEFT`, `RIGHT`.
- These tools require the **Figma Desktop** app (the Plugin API isn't available in the browser).
