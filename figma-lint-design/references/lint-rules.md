# figma-lint-design — rule catalog

Every rule the [`scripts/lint-design.js`](../scripts/lint-design.js) walk can emit. Set `RULES` to
`['all']`, a group name, or a list of specific rule ids. Each finding carries `severity`
(`critical` / `warning` / `info`) and `wcagLevel` (`a` / `aa` / `aaa` / `best-practice` /
`design-system`).

> **WCAG honesty note:** several "wcag-*" rule ids are labelled `best-practice` rather than a literal
> Success Criterion failure, because the underlying SC (e.g. 1.4.4, 1.4.12) is about *supporting user
> overrides*, not mandating a specific design value. The id keeps the WCAG association for discovery;
> the `wcagLevel` tells the truth about conformance.

## Rule groups

| Group | Rule ids |
|-------|----------|
| `wcag` | the 14 `wcag-*` rules below |
| `design-system` | `hardcoded-color`, `no-text-style`, `default-name`, `detached-component`, `token-misuse` |
| `layout` | `no-autolayout`, `empty-container` |
| `all` | everything |

## WCAG 2.2 rules (14)

| Rule id | WCAG SC | Level | Severity | What it flags |
|---------|---------|-------|----------|---------------|
| `wcag-contrast` | 1.4.3 Contrast (Minimum) | AA | critical | TEXT fill vs inferred background below 4.5:1 (normal) / 3:1 (large ≥24px or ≥18.66px bold). Semi-transparent → `approximate:true`. |
| `wcag-non-text-contrast` | 1.4.11 Non-text Contrast | AA | critical | Interactive component fill or stroke/border below 3:1 against adjacent background. |
| `wcag-color-only` | 1.4.1 Use of Color | A | critical | State variant (error/warning/success/etc.) differs from default by color alone — no icon, border, or text indicator. |
| `wcag-focus-indicator` | 2.4.7 Focus Visible | AA | critical | Interactive COMPONENT_SET missing a focus/focused variant, or the focus variant has no visible stroke/shadow. |
| `wcag-target-size` | 2.5.8 Target Size (Minimum) | AA | critical | Interactive element smaller than 24x24px. |
| `wcag-image-alt` | 1.1.1 Non-text Content | A | warning | Node with an IMAGE fill and no `description`; name it "decorative" to suppress. |
| `wcag-heading-hierarchy` | 1.3.1 Info & Relationships | A | warning | Heading levels skip (e.g. H1 → H3). Levels inferred from name (`H2`, `heading-2`) or font size. |
| `wcag-reflow` | 1.4.10 Reflow | AA | warning | Fixed-position FRAME/COMPONENT (no auto-layout) with 3+ absolutely placed children that spread on both axes. |
| `wcag-reading-order` | 1.3.2 Meaningful Sequence | A | warning | Non-auto-layout frame where >30% (and ≥2) of children's layer order mismatches visual top-to-bottom / left-to-right order. |
| `wcag-disabled-no-context` | 4.1.2 Name, Role, Value | AA | warning | Disabled variant with no tooltip/helper/hint child and no disabled annotation in the set description. |
| `wcag-text-size` | (best practice) | best-practice | warning | TEXT below 12px. Not a literal 1.4.4 failure — that SC is about 200% text zoom. |
| `wcag-line-height` | 1.4.12 Text Spacing | best-practice | info | Effective line height below 1.5x font size. |
| `wcag-letter-spacing` | 1.4.12 Text Spacing | best-practice | warning | Negative letter spacing (px or %). |
| `wcag-paragraph-spacing` | 1.4.12 Text Spacing | best-practice | info | Paragraph spacing below 2x font size. |

## Design-system rules (5)

| Rule id | Level | Severity | What it flags |
|---------|-------|----------|---------------|
| `hardcoded-color` | design-system | warning | Solid fill not bound to a variable and not using a fill style. One finding per node. |
| `no-text-style` | design-system | warning | TEXT node without a `textStyleId`. |
| `default-name` | design-system | warning | Default Figma names: `Frame 3`, `Rectangle`, `Group 1`, etc. |
| `detached-component` | design-system | warning | FRAME whose name contains `/` (component naming) but is not a component/instance. |
| `token-misuse` | design-system | warning | A `bg/`-prefixed variable bound as a text fill, or a `text/`-prefixed variable bound as a container background. |

## Layout rules (2)

| Rule id | Level | Severity | What it flags |
|---------|-------|----------|---------------|
| `no-autolayout` | design-system | warning | FRAME/COMPONENT/COMPONENT_SET with 2+ children and `layoutMode` NONE. |
| `empty-container` | design-system | info | FRAME with zero children. |

## Finding shape

```jsonc
{
  "rule": "wcag-contrast",
  "severity": "critical",
  "wcagLevel": "aa",
  "count": 3,
  "description": "Text below WCAG AA contrast...",
  "nodes": [
    { "id": "12:34", "name": "Caption", "ratio": "3.1:1", "required": "4.5:1", "fg": "#888888", "bg": "#FFFFFF" }
  ]
}
```

Top-level result: `{ rootNodeId, rootNodeName, nodesScanned, categories: [...], summary: { critical, warning, info, total } }`.
A `warning` field appears when `MAX_FINDINGS` truncated the walk.

## Contrast math

The script linearizes each sRGB channel (`c ≤ 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4`), computes
relative luminance (`0.2126R + 0.7152G + 0.0722B`), and the ratio `(Llight+0.05)/(Ldark+0.05)`.
Background is the nearest ancestor solid fill (white if none). Colors are 0–1 floats throughout.
