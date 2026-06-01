---
name: figma-setup-design-tokens
description: "Bootstrap a complete design-token system in Figma in one atomic step — create a variable collection, its modes (e.g. Light/Dark), and every variable with per-mode values together. Use when starting a token system from scratch: triggers 'set up design tokens in Figma', 'create a token collection with light and dark modes', 'scaffold variables', 'bootstrap a Figma theme'. Works on ANY Figma plan. For incremental edits to an existing system use figma-manage-variables; for syncing from a code tokens file use figma-import-tokens."
disable-model-invocation: false
---

# figma-setup-design-tokens — atomic token-system bootstrap

Create a variable collection + modes + all variables in a single `use_figma` call. This is the
fastest way to stand up a new token system (or a new collection within one). Because it runs as one
atomic script, either everything is created or nothing is (failed scripts apply no changes).

## Skill boundaries
- **`use_figma` rules** — load the official **`figma-use`** skill first; it is the full Figma Plugin API reference. Essentials these scripts rely on: plain JS with top-level `await` + `return` (no IIFE, no `figma.closePlugin()`; `console.log` is not returned), inputs inlined as `const` at the top of each script, colors in 0–1 range, load fonts before any text op, `await figma.getNodeByIdAsync(...)`, and **atomic errors** (a failed script applies nothing — read the error, fix, retry).
- Incremental CRUD / batch edits to an existing system → `figma-manage-variables`.
- Sync from a code token file → `figma-import-tokens`.

## Workflow

1. **Agree the v1 scope.** List the collection name, the modes (first one is the default), and the
   full token set with per-mode values. Lock this before writing — it's much cheaper than editing
   afterward.
2. **Fill the constants** in [`scripts/setup-tokens.js`](scripts/setup-tokens.js): `COLLECTION_NAME`,
   `MODES`, `TOKENS` (values keyed by mode name), and optional per-variable `SCOPES`.
3. **Run** via `use_figma` (`skillNames: "figma-setup-design-tokens"`). It returns
   `{ collectionId, modes, created, errors }`.
4. **Validate** with `get_variable_defs` or the `figma-export-tokens` read script, then screenshot if
   you also created swatches.

## Notes
- **Two-tier systems**: create *primitives* (raw values) with this skill, then create *semantic*
   tokens that alias them using `figma-import-tokens` (which has the alias pass) or
   `figma-manage-variables`. Keep primitives single-mode and put theming on the semantic layer.
- **Set scopes**: the default `ALL_SCOPES` clutters every property picker. Pass `SCOPES` for the
   surfaces each token belongs to (`FRAME_FILL`/`SHAPE_FILL` for backgrounds, `TEXT_FILL` for text,
   `GAP` for spacing, `CORNER_RADIUS` for radii, `WIDTH_HEIGHT` for sizing).
- Keep one bootstrap per collection. Multiple collections = multiple runs.
