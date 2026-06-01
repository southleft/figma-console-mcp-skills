---
name: figma-annotations
description: "Read and write designer annotations on Figma nodes — node-level design specs that pin properties (fills, width, fontSize, etc.) and carry plain or markdown notes. Use when the user wants to document or inspect interaction specs, animation timings, easing, accessibility requirements, or implementation notes attached directly to a node. Triggers: 'add an annotation', 'annotate this node/component', 'read the annotations on…', 'what specs are pinned to this element', 'list annotation categories', 'document the focus behavior on this button in Figma'. Annotations are distinct from comments (they pin to design properties) and from the description field. Requires the Figma Desktop app (Plugin API)."
disable-model-invocation: false
---

# figma-annotations — read & write node annotations

Annotations are designer-authored specs attached to a node. Each can carry a **note** (plain `label`
or rich `labelMarkdown`), a set of **pinned properties** (`fills`, `width`, `fontSize`, …) that link
the note to specific design attributes, and an optional **category** (interactions, accessibility,
dev notes, …). They live on the node, survive edits, and are undoable (`Cmd+Z`). They are the right
place for animation timings, easing curves, interaction behavior, and a11y requirements that don't
belong in the component description.

## Skill boundaries
- **`use_figma` rules** — load the official **`figma-use`** skill first; it is the full Figma Plugin API reference. Essentials these scripts rely on: plain JS with top-level `await` + `return` (no IIFE, no `figma.closePlugin()`; `console.log` is not returned), inputs inlined as `const` at the top of each script, colors in 0–1 range, load fonts before any text op, `await figma.getNodeByIdAsync(...)`, and **atomic errors** (a failed script applies nothing — read the error, fix, retry).
- **Valid property types + shapes** → [references/annotation-properties.md](references/annotation-properties.md).
- **Comments** (file-level discussion threads, not node specs) → use the `figma-comments` skill instead.

## Workflow

1. **Get the node ID.** Use the current selection or a node ID the user gives you. Annotations only
   apply to nodes whose type supports them (frames, components, instances, shapes, text — not pages).
2. **List categories first when writing categorized annotations.** Run the categories snippet so you
   can pass a real `categoryId` (category names are per-file and not guessable). See the script.
3. **Read** with [`scripts/get-annotations.js`](scripts/get-annotations.js) — set `INCLUDE_CHILDREN`
   to walk a component tree for full-component documentation.
4. **Write** with [`scripts/set-annotations.js`](scripts/set-annotations.js). Choose `MODE`:
   `'replace'` (default — overwrites all annotations on the node) or `'append'` (keeps existing).
   Pass `ANNOTATIONS = []` with `'replace'` to clear all annotations.
5. **Validate.** Re-run the read script and confirm the annotation count and labels match what you set.

## Notes
- **Note any text op needs a font load.** Annotations themselves don't render text you author, but
  if a workflow also writes text nodes, `await figma.loadFontAsync(...)` first (see conventions).
- Figma auto-populates BOTH `label` and `labelMarkdown` on read, but **rejects writing both** — when
  appending, prefer `labelMarkdown` if present, else `label`. The append script already does this.
- `properties` only pins *which* attributes the note is about; it does not set their values. Use the
  exact strings from [references/annotation-properties.md](references/annotation-properties.md).
- These tools require the **Figma Desktop** app (the Plugin API isn't available in the browser).
