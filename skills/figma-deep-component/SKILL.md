---
name: figma-deep-component
description: "Extract a single Figma component (or any node) as a full recursive tree to N levels deep — every child's layout, fills/strokes/effects, typography, resolved bound variables (token names + code syntax), INSTANCE mainComponent references, prototype reactions, and annotations. Use when you need maximum-fidelity data to generate production code for ONE component — triggers: 'get the full component tree', 'deep extract this component', 'give me everything about this node for code gen', 'resolve all the tokens in this component', 'what instances does this component nest', 'extract reactions/prototype links', 'high-fidelity component spec'. Resolves bound variables to token names on ANY plan. Far deeper than the native MCP's get_design_context / get_metadata."
disable-model-invocation: false
---

# figma-deep-component — unlimited-depth tree with resolved tokens

Walk one node (usually a `COMPONENT` / `COMPONENT_SET` / `INSTANCE`, but any node works) recursively
to a depth you choose, capturing at *every* level: layout (auto-layout, padding, spacing, sizing),
visual properties (fills, strokes, stroke weight, corner radius, effects, opacity), typography for
text nodes, `boundVariables` **resolved to token names + code syntax**, `INSTANCE` main-component
references (including whether the main is a variant and its set), prototype `reactions`, and dev-mode
`annotations`. This is the richest single-component read for high-fidelity code generation.

## Skill boundaries
- **`use_figma` rules** — load the official **`figma-use`** skill first; it is the full Figma Plugin API reference. Essentials these scripts rely on: plain JS with top-level `await` + `return` (no IIFE, no `figma.closePlugin()`; `console.log` is not returned), inputs inlined as `const` at the top of each script, colors in 0–1 range, load fonts before any text op, `await figma.getNodeByIdAsync(...)`, and **atomic errors** (a failed script applies nothing — read the error, fix, retry).
- **Whole-file inventory** (all tokens/components/styles at once) → use `figma-design-system-inventory`.
- **Variant set as a CSS state machine** (per-state diffs, pseudo-class mapping) →
  use `figma-analyze-component-set`.
- This depth of tree + resolved tokens + reactions is **not** what the native MCP's
  `get_design_context` (rendered single-selection summary) or `get_metadata` (flat structure)
  return — it is a design-system code-gen capability layered on top.

## Workflow

1. **Get the node id.** From selection (`figma_get_selection`), search, or a pasted id.
2. **Choose a depth.** Set `const DEPTH` (default 10). Deep design components rarely exceed ~6
   levels; use a smaller number first to keep the payload manageable, then go deeper if needed.
3. **Run** [`scripts/deep-component.js`](scripts/deep-component.js) via `use_figma`
   (`skillNames: "figma-deep-component"`). Set `const NODE_ID` and `const DEPTH` at the top.
4. **Generate code.** The returned tree mirrors the DOM you should build. Prefer `boundVariables`
   token names (and their `codeSyntax`) over raw hex; use `mainComponent` refs to reuse imported
   components; use `reactions` to wire up interaction/navigation.
5. **If the payload is too big**, lower `DEPTH` (nodes past the limit are summarized with a
   `childCount` + `_depthLimitReached` marker) or target a smaller sub-node id.

## What each node carries
- **Identity**: `id`, `name`, `type`, `visible`. Hidden non-component nodes are marked `_hidden` and
  not recursed.
- **Layout**: `layoutMode`, axis sizing/align, `padding*`, `itemSpacing`, `counterAxisSpacing`,
  `layoutWrap`, min/max width/height, `clipsContent`.
- **Visual**: `fills`, `strokes`, `strokeWeight`, `cornerRadius`, `effects`, `opacity`
  (only when non-default; `figma.mixed` values are skipped safely).
- **Typography** (TEXT): `characters`, `fontSize`, `fontFamily`/`fontStyle`, `fontWeight`,
  `lineHeight`, `letterSpacing`, alignment, truncation, case, decoration.
- **Tokens**: `boundVariables` resolved to `{ id, name, collection, resolvedType, codeSyntax }` per
  bound property.
- **Instances**: `mainComponent` (`id`, `name`, `key`, `isVariant`, set name/id) + `componentProperties`.
- **Definitions** (COMPONENT/COMPONENT_SET): `componentPropertyDefinitions`, `variantProperties`.
- **Prototype**: `reactions` (trigger + action: navigation/transition/destination).
- **Dev**: `annotations` (label markdown + categorized properties).

## Notes
- **Resolved tokens work on ANY plan** — the variable lookup is built via the Plugin API, so even
  non-Enterprise files get token names instead of opaque `VariableID:` aliases.
- The root node echoes `_variableMapSize` and `_maxDepthUsed` for sanity-checking.
- Returns `affectedNodeIds: [NODE_ID]` even though this is a read — keeps the convention uniform.
