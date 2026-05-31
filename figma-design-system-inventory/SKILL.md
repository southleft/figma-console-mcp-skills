---
name: figma-design-system-inventory
description: "One call to inventory an entire Figma design system — variables/tokens (grouped by collection + mode), components and component sets (with property definitions and per-variant visual specs), and styles (color/text/effect with resolved values). Use when you need the whole design-system picture before generating code or auditing coverage — triggers: 'inventory my design system', 'extract all tokens and components', 'what's in this design system', 'dump the design system kit', 'give me every variable, component, and style', 'build a design-system manifest', 'audit my Figma library'. Has a verbosity/scope guard so big files don't blow the response budget. Goes well beyond the native MCP's get_design_context (single-selection) / get_metadata."
disable-model-invocation: false
---

# figma-design-system-inventory — unified tokens + components + styles extraction

A single `use_figma` call that walks the whole file and returns a structured kit:
**tokens** (every local variable, grouped by collection and mode), **components** (standalone
components + component sets, with property definitions and a compact `visualSpec` per variant), and
**styles** (paint/text/effect styles with their resolved values). It is the "read everything once"
front door for code generation and library audits.

## Skill boundaries
- **Plugin API rules** (return pattern, async getters) → load the official
  [`figma-use`](https://www.figma.com/community/skills) skill first.
- **Shared idiom + helpers** → [../references/use-figma-conventions.md](../references/use-figma-conventions.md).
- **The exact shape of each `visualSpec`** → [references/visual-spec.md](references/visual-spec.md).
- **One component in unlimited depth** (full tree, reactions, instance refs) →
  use `figma-deep-component`. **One variant set as a CSS state machine** →
  use `figma-analyze-component-set`. **Token files on disk** → use `figma-export-tokens`.
- This is a **whole-system design capability** the native MCP does not have: `get_design_context`
  works on a single selection and `get_metadata` returns flat structure, neither gives a unified
  tokens+components+styles kit on ANY plan.

## Workflow

1. **Pick scope & verbosity** to control response size on big files. Edit the constants in
   [`scripts/inventory.js`](scripts/inventory.js):
   - `INCLUDE` — any of `"tokens"`, `"components"`, `"styles"` (default: all three).
   - `VERBOSITY` — `"full"` (per-variant visual specs), `"summary"` (component metadata + props, no
     per-variant specs), or `"inventory"` (names/ids/counts only — for huge files).
   - `COMPONENT_NAME_FILTER` — substring to limit components (e.g. `"Button"`).
2. **Run** via `use_figma` (`skillNames: "figma-design-system-inventory"`). Reads variables through
   the **Plugin API**, so it works on every Figma plan (no Enterprise REST requirement).
3. **Consume.** Use `tokens` for color/spacing/typography values, `components[].componentProps` for
   the component API, `components[].variants[].visualSpec` for per-state appearance, and `styles` for
   any style-based (non-variable) values.
4. **If the result is still large**, drop to a lower `VERBOSITY` or narrow `INCLUDE` /
   `COMPONENT_NAME_FILTER` and re-run — don't try to page a giant `full` dump.

## Notes
- **Colors are emitted as hex** (Figma stores 0–1 RGBA internally); spacing/size values are px.
- **Variables resolve aliases to token names** (`{Color.Brand.Primary}`-style) where possible.
- **Per-variant visual specs** come from each variant component node — see
  [references/visual-spec.md](references/visual-spec.md) for the fields (fills, strokes, effects,
  cornerRadius, opacity, layout/padding/spacing, typography).
- This script is the open-coded equivalent of the bundled `figma_get_design_system_kit` tool, written
  in the native `use_figma` idiom so it runs without the Desktop Bridge.
