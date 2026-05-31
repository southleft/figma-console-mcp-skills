---
name: figma-manage-variables
description: "Create, update, rename, delete, and organize Figma variables, collections, and modes — including fast batch create/update, setting scopes, code syntax, and adding theme modes. Use for incremental variable work: triggers 'create a variable', 'batch update variables', 'add a dark mode to my collection', 'rename this variable', 'set variable scopes', 'delete a variable/collection', 'add a mode'. Works on ANY Figma plan. For a from-scratch system use figma-setup-design-tokens; for code↔Figma sync use figma-import-tokens / figma-export-tokens."
disable-model-invocation: false
---

# figma-manage-variables — variable / collection / mode CRUD

Incremental, surgical edits to a Figma variable system: create one or many, update values in bulk,
rename, set scopes and code syntax, add/rename modes, and delete. All via `use_figma`, on any plan.

## Skill boundaries
- **`use_figma` rules** — load the official **`figma-use`** skill first; it is the full Figma Plugin API reference. Essentials these scripts rely on: plain JS with top-level `await` + `return` (no IIFE, no `figma.closePlugin()`; `console.log` is not returned), inputs inlined as `const` at the top of each script, colors in 0–1 range, load fonts before any text op, `await figma.getNodeByIdAsync(...)`, and **atomic errors** (a failed script applies nothing — read the error, fix, retry).
- From-scratch bootstrap → `figma-setup-design-tokens`. Code sync → `figma-import-tokens` /
  `figma-export-tokens`.

## Workflow

1. **Identify targets.** Most ops need IDs. Get `variableId`/`modeId`/`collectionId` from the
   `figma-export-tokens` read script or `get_variable_defs`. Collections can also be looked up by
   name inside the script.
2. **Pick the operation** from [references/variable-ops.md](references/variable-ops.md) — it has a
   complete, copy-paste `use_figma` snippet for each: create collection, create variable, batch
   create, batch update, rename, set scopes, add/rename mode, delete.
3. **Run** via `use_figma` (`skillNames: "figma-manage-variables"`). For large value updates use
   [`scripts/batch-update-variables.js`](scripts/batch-update-variables.js) (10–50× faster than
   one-call-per-value).
4. **Confirm.** Every snippet returns the affected IDs/names. Read back with `get_variable_defs` to
   verify. For deletes, **confirm with the user first** — removing a collection deletes all its
   variables and unbinds anything referencing them.

## Key rules
- **Colors are 0–1 range.** Use `hexToRgb` for hex input.
- **Always set `scopes`** on new variables — the default `ALL_SCOPES` pollutes every picker.
- **Set code syntax** (`setVariableCodeSyntax('WEB', '--token-name')`) so design↔code naming lines up.
- **Renames are safe** — they preserve values and existing bindings. Deletes are destructive.
- **Aliases**: bind one variable to another with
  `v.setValueForMode(modeId, figma.variables.createVariableAlias(targetVar))`.
