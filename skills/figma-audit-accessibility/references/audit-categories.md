# figma-audit-accessibility — scoring categories

[`scripts/audit-accessibility.js`](../scripts/audit-accessibility.js) classifies the component as
**interactive** or **presentational**, scores six categories 0–100, then blends them into
`overallScore` using classification-specific weights.

## Classification

Auto-detected from the component name and variant axes:

- **interactive** — name matches `button|link|input|checkbox|radio|switch|toggle|tab|select|slider|dropdown|menu-item|search|combobox|listbox`, OR a `state=` axis carries `hover/focus/pressed/disabled/active`, OR any variant name mentions an interaction state.
- **presentational** — everything else (badge, card, avatar, alert, tag, icon, progress, etc.).

Classification changes which categories apply: presentational components score `focusIndicator` and
`targetSize` as N/A (100, not penalized), because those WCAG criteria are about interactive tap
targets.

## The six categories

| Category | What it measures | Score logic |
|----------|------------------|-------------|
| `variantCoverage` | Interactive: how many of the 7 states (default/hover/focus/disabled/error/active/loading) exist. Presentational: actual variants ÷ expected axis combinations. | `covered / total × 100` |
| `focusIndicator` | Does the focus variant exist and have a visible stroke or drop/inner shadow? Reports the focus-ring contrast ratio. | 0 = no focus variant, 50 = variant but no visible indicator, 100 = visible indicator. N/A (100) for presentational. |
| `colorDifferentiation` | Do error/disabled/active states differ from default by more than color? (WCAG 1.4.1) Looks for an icon child, a stroke, or accepts color+other. | `(checked − issues) / checked × 100` |
| `targetSize` | Are interactive variants ≥ `TARGET_SIZE` (default 24px, WCAG 2.5.8)? Reports the smallest variant. | `(variants − issues) / variants × 100`. N/A (100) for presentational. |
| `annotations` | Component description present, and does it mention ARIA / keyboard / screen-reader / role / tab order? | 0 = nothing, 50 = description only, 100 = has a11y notes. |
| `colorBlindSafety` | Simulates protanopia, deuteranopia, tritanopia (Brettel/Viénot matrices) over up to 20 text/fill color pairs; flags pairs that drop below 4.5:1 or lose >30% contrast. | `simulations with 0 issues / 3 × 100` |

## Overall weighting

**Interactive:**
`coverage 0.20 + focus 0.20 + colorBlind 0.20 + colorDiff 0.15 + targetSize 0.15 + annotations 0.10`

**Presentational:**
`coverage 0.25 + colorDiff 0.25 + colorBlind 0.25 + annotations 0.15 + targetSize 0.10`
(focus indicator is excluded — N/A for presentational components.)

## Result shape

```jsonc
{
  "component": { "id": "...", "name": "Button", "type": "COMPONENT_SET", "variantCount": 12, "classification": "interactive" },
  "overallScore": 78,
  "scores": { "variantCoverage": 86, "focusIndicator": 100, "colorDifferentiation": 100, "targetSize": 100, "annotations": 50, "colorBlindSafety": 67 },
  "variantCoverage": { "mode": "interactive-states", "found": { "default": "State=Default", ... }, "missing": ["loading"], "coverage": "6/7" },
  "focusIndicator": { "hasVariant": true, "hasVisibleIndicator": true, "contrastRatio": 3.4, "details": "Focus ring (stroke) with 3.4:1 contrast" },
  "colorDifferentiation": { "issues": [], "checked": 2 },
  "targetSize": { "minimum": "24x24", "smallest": "40x40", "issues": [] },
  "annotations": { "hasDescription": true, "description": "...", "hasA11yNotes": false, "a11yNotes": "" },
  "colorBlindSimulation": { "simulations": [ { "type": "protanopia", "pairsChecked": 4, "issues": 1, "details": [...] }, ... ], "issues": ["protanopia: 1 color pair(s) lose sufficient contrast"] },
  "recommendations": [ { "priority": "medium", "area": "documentation", "message": "Add accessibility notes ..." } ]
}
```

## Raising each score

- **coverage** → add the missing interaction-state variants (especially `focus` and `disabled`), or complete the variant-axis matrix for presentational components.
- **focusIndicator** → add a focus/focused variant with a visible stroke (focus ring) or shadow; aim for ≥3:1 ring contrast.
- **colorDifferentiation** → give error/disabled/active states an icon, border, or text label, not just a color swap.
- **targetSize** → enlarge interactive variants to at least `TARGET_SIZE` (24px min; 44/48px for mobile).
- **annotations** → write a component description and include ARIA role, keyboard interactions, and screen-reader behavior.
- **colorBlindSafety** → pick fg/bg pairs that keep ≥4.5:1 under all three dichromat simulations, not just for normal vision.
