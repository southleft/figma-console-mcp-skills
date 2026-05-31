---
name: figma-import-tokens
description: "Push design tokens from code INTO Figma as variables — DTCG / tokens.json / a token object → Figma variable collections, modes, and values. Use when the user wants to sync tokens code→Figma: triggers 'import tokens into Figma', 'create Figma variables from my tokens.json / DTCG / Tailwind config', 'sync design tokens to Figma', 'push tokens to Figma'. Non-destructively matches existing variables (by saved id/key/name) so re-imports update instead of duplicating. Works on ANY Figma plan. For the reverse (Figma → code) use figma-export-tokens."
disable-model-invocation: false
---

# figma-import-tokens — design tokens → Figma variables

Create and update Figma variables from a token source (DTCG `tokens.json`, a Tailwind/SCSS export, or
a plain token object). Aliases and multi-mode values are supported. Re-running is safe: variables are
matched by saved Figma id → key → exact name, so an update edits in place rather than duplicating.

## Skill boundaries
- **`use_figma` rules** — load the official **`figma-use`** skill first; it is the full Figma Plugin API reference. Essentials these scripts rely on: plain JS with top-level `await` + `return` (no IIFE, no `figma.closePlugin()`; `console.log` is not returned), inputs inlined as `const` at the top of each script, colors in 0–1 range, load fonts before any text op, `await figma.getNodeByIdAsync(...)`, and **atomic errors** (a failed script applies nothing — read the error, fix, retry).
- Reverse direction (Figma → code) → `figma-export-tokens`.

## Workflow

1. **Parse the source into the canonical token list — deterministically.** For **DTCG** input (incl.
   anything `figma-export-tokens` produced), run the bundled parser instead of flattening by hand:
   ```bash
   node scripts/parse-tokens.mjs tokens.tokens.json --default-mode Light --collection Brand
   ```
   It prints the exact `COLLECTION_NAME` / `MODES` / `TOKENS` constants to paste into the apply script
   — handling `$type`→Figma type, `{ref}` aliases, multi-mode (`$extensions…modes`), `dimension` unit
   stripping, and `variableId` round-trip. For non-DTCG sources (a Tailwind/SCSS export), export to
   DTCG first or hand-build the `TOKENS` array:
   `{ name: "Color/Brand/Primary", type: "COLOR"|"FLOAT"|"STRING"|"BOOLEAN", values: { <mode>: literal | { reference: "{Color.Brand.500}" } }, figmaVariableId? }`.
2. **Decide conflict policy.** Default: code wins on values, but never delete Figma-only variables
   without asking. Confirm the target collection name and the mode list (first = default).
3. **Apply.** Put the parsed data into the constants at the top of
   [`scripts/apply-tokens.js`](scripts/apply-tokens.js) and run it via `use_figma`
   (`skillNames: "figma-import-tokens"`). It runs two passes — literals first, then aliases — and
   returns `{ created, updated, errors, variableIds }`.
4. **Report & validate.** Surface created/updated counts and any `errors`. Run a read-back (the
   `figma-export-tokens` read script or `get_variable_defs`) to confirm values landed.

## Notes & gotchas
- **Two-pass is required** — alias targets must exist before `createVariableAlias`. The script
  handles this; don't collapse it into one pass.
- **Colors** accept hex strings (3/6/8 digit) and are converted to `{r,g,b,a}` 0–1 automatically.
- **Scopes**: new variables default to `ALL_SCOPES`, which pollutes every picker. After import,
  consider setting `variable.scopes` (see `figma-manage-variables`) to the right surfaces.
- **Round-trip**: importing a file previously produced by `figma-export-tokens` is the happy path —
  the stashed `variableId` makes matching exact.
