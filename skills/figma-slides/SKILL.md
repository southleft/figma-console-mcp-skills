---
name: figma-slides
description: "Author Figma Slides presentations — list/create/duplicate/reorder/delete slides, read the slide grid, add text and shapes to a slide, set slide background color, set or read slide transitions (dissolve, slide-from, push-from, smart-animate), focus a slide, and toggle skip. Use when the user wants to build or edit a Figma Slides deck. Triggers: 'create a slide', 'add a slide to the deck', 'reorder slides', 'set the slide background', 'add a transition between slides', 'add text/shape to slide 3', 'read what's on this slide', 'skip this slide in the presentation'. Figma Slides files only (figma.editorType === 'slides'). Requires the Figma Desktop app (Plugin API)."
disable-model-invocation: false
---

# figma-slides — author Figma Slides decks

Build and edit Figma Slides presentations: manage the slide grid (list / create / duplicate / reorder
/ delete / focus / skip), add content (text, shapes, background color), and control transitions. Each
slide is a `SLIDE` node; the deck is a 2D grid (`figma.getSlideGrid()` → rows of slides).

## Skill boundaries
- **`use_figma` rules** — load the official **`figma-use`** skill first; it is the full Figma Plugin API reference. Essentials these scripts rely on: plain JS with top-level `await` + `return` (no IIFE, no `figma.closePlugin()`; `console.log` is not returned), inputs inlined as `const` at the top of each script, colors in 0–1 range, load fonts before any text op, `await figma.getNodeByIdAsync(...)`, and **atomic errors** (a failed script applies nothing — read the error, fix, retry).
- **One complete snippet per operation** → [references/slides-snippets.md](references/slides-snippets.md).

## Workflow

1. **Confirm it's a Slides file.** Every op throws outside Slides. Check first:
   `return { editorType: figma.editorType };` — it must be `'slides'`.
2. **List slides** to get IDs and grid positions (`scripts`/snippet `List slides`). Slide IDs are what
   every other op references.
3. **Pick the operation** from [references/slides-snippets.md](references/slides-snippets.md): create /
   duplicate / delete / reorder slides; add text / shape; set background; set / get transition; focus;
   skip; read slide content.
4. **Run the snippet** via `use_figma` (`skillNames: "figma-slides"`), editing the inlined constants.
5. **Return created/changed slide IDs** and re-list or read-content to confirm.

## Notes
- **Adding text loads a font first.** `add text to slide` calls `await figma.loadFontAsync({ family,
  style })` before setting `.characters` — never skip it. Default is Inter / Regular.
- Create at a grid position with `figma.createSlide({ row, col })`, or `figma.createSlide()` to append.
- Transition `style` values: `NONE`, `DISSOLVE`, `SLIDE_FROM_LEFT`, `SLIDE_FROM_RIGHT`,
  `SLIDE_FROM_BOTTOM`, `SLIDE_FROM_TOP`, `PUSH_FROM_LEFT`, `PUSH_FROM_RIGHT`, `PUSH_FROM_BOTTOM`,
  `PUSH_FROM_TOP`, `SMART_ANIMATE`. Timing defaults to `{ type: 'ON_CLICK' }`.
- Background is implemented as a full-bleed (1920×1080) `Background` rectangle inserted at index 0;
  re-running updates the existing one instead of stacking.
- `reorder` takes a 2D array of slide IDs (rows × columns) and rebuilds the grid via
  `figma.setSlideGrid`. Every ID must exist in the current grid or it throws.
- Skip toggles `slide.isSkippedSlide` (note: the property is `isSkippedSlide`, not `skipped`).
- These tools require the **Figma Desktop** app (the Plugin API isn't available in the browser).
