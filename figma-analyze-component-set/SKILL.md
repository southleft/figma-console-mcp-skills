---
name: figma-analyze-component-set
description: "Analyze a Figma COMPONENT_SET as a state machine for code generation — extract variant axes (state/size/etc.), map state variants to CSS pseudo-classes (hover→:hover, focus→:focus-visible, disabled→:disabled, error→[aria-invalid]), and compute per-variant visual diffs (only what changes per state). Use when generating an interactive component from a Figma variant set — triggers: 'analyze this component set', 'turn these variants into CSS states', 'generate a button/input/checkbox from Figma variants', 'what changes between the hover and default state', 'map Figma variants to component props', 'extract the state machine for this component'. Resolves bound variables to token names. NOT covered by the native MCP's get_design_context/get_metadata, which don't give you a variant-axis→CSS-state machine."
disable-model-invocation: false
---

# figma-analyze-component-set — variant state machine → CSS

Take a Figma `COMPONENT_SET` (the purple dashed container holding all the variants of one
component) and turn it into a code-generation blueprint: which property axes are *state* vs *size*,
how each state maps to a CSS pseudo-class or ARIA attribute, and the minimal visual delta each state
applies on top of the default variant. This is the bridge between "Figma has 12 button variants" and
"emit one `.btn` rule + `:hover`/`:disabled` overrides."

## Skill boundaries
- **`use_figma` rules** — load the official **`figma-use`** skill first; it is the full Figma Plugin API reference. Essentials these scripts rely on: plain JS with top-level `await` + `return` (no IIFE, no `figma.closePlugin()`; `console.log` is not returned), inputs inlined as `const` at the top of each script, colors in 0–1 range, load fonts before any text op, `await figma.getNodeByIdAsync(...)`, and **atomic errors** (a failed script applies nothing — read the error, fix, retry).
- **Full recursive tree** (unlimited depth, reactions, instance refs) → use `figma-deep-component`.
- **Reorganizing variants into a labeled grid** → use `figma-arrange-component-set`.
- **Adding/removing the properties themselves** → use `figma-component-properties`.
- This is a **design-system code-gen capability** that the native MCP's `get_design_context` /
  `get_metadata` do **not** provide — they return raw structure, not a variant→CSS state machine.

## Workflow

1. **Get the COMPONENT_SET id.** From the user's selection (`figma_get_selection`), a search, or a
   node id they paste. It must be the *set*, not an individual variant — the script validates type.
2. **Run** [`scripts/analyze-component-set.js`](scripts/analyze-component-set.js) via `use_figma`
   (`skillNames: "figma-analyze-component-set"`). Set `const COMPONENT_SET_ID` at the top first.
3. **Read the result.** It returns `variantAxes` (each axis + its options), `componentProps`
   (non-variant TEXT/BOOLEAN/INSTANCE_SWAP props → code props), a `stateMachine` with `cssMapping`
   (state name → CSS selector) and `defaultSignature`, and per-variant `diffFromDefault`.
4. **Generate code.** Implement the default variant from `defaultSignature`, then add one rule per
   `cssMapping` entry applying only that variant's `diffFromDefault`. Map `componentProps` to
   framework props: `BOOLEAN`→boolean, `TEXT`→string, `INSTANCE_SWAP`→ReactNode/slot, `VARIANT`→union.
5. **Validate.** Cross-check that every state in `stateMachine.states` got a CSS rule, and that
   token names in the diff (e.g. `Color/Brand/Primary`) resolve to your exported tokens.

## How states map to CSS

The script normalizes the *state* axis value (case-insensitive) to a selector:

| Variant value | CSS / ARIA selector |
| --- | --- |
| `default` | (base rule, no selector) |
| `hover` | `:hover` |
| `focus` / `focused` / `focus-visible` | `:focus-visible` |
| `active` / `pressed` | `:active` |
| `disabled` | `:disabled, [aria-disabled="true"]` |
| `error` / `invalid` | `[aria-invalid="true"]` |
| `selected` | `[aria-selected="true"]` |
| `checked` | `:checked` |
| `loading` | `[aria-busy="true"]` |
| `open` / `closed` | `[aria-expanded="true"|"false"]` |
| `filled` | `.has-value` |

## Notes
- **Diffs are computed against the default variant**, so a state's `diffFromDefault` lists *only* the
  properties that change (fill token, stroke, text color, opacity, effects, child visibility). Emit
  exactly those as overrides — don't re-specify unchanged properties.
- The script resolves `boundVariables` (fills/strokes) to **token names** when available, falling
  back to raw hex. Prefer the token name in generated code.
- Axis detection is heuristic: an axis named `state`/`status`/`interaction` is the state axis;
  `size`/`scale` is the size axis. If your set names axes differently, the `cssMapping` may be empty —
  read `variantAxes` and map states yourself.
