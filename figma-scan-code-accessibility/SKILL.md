---
name: figma-scan-code-accessibility
description: "Scan generated/authored HTML for accessibility violations with axe-core (Deque) running over JSDOM — structural and semantic rules: ARIA attributes and roles, accessible names, alt text, form labels, heading order, landmarks, semantic HTML, tabindex, duplicate IDs, lang attribute, and ~50 more. Use on the CODE side of a Figma-to-code workflow: triggers 'scan this HTML for accessibility', 'run axe on my component', 'check the generated code for a11y', 'axe-core scan', 'accessibility lint my markup', 'WCAG check on code', 'is this HTML accessible'. This is a standalone Node script — NO Figma connection required. Visual rules (color-contrast, focus-visible, link-in-text-block, target-size) are DISABLED because JSDOM has no layout — use figma-lint-design for visual a11y on the design side. The two together give full design+code coverage."
disable-model-invocation: false
---

# figma-scan-code-accessibility — axe-core + JSDOM scan of HTML

Run [axe-core](https://github.com/dequelabs/axe-core) (Deque's accessibility engine) against an HTML
string using JSDOM. This is the **code side** of the accessibility story: it checks the markup your
Figma-to-code workflow produced. It pairs with `figma-lint-design` (design side) to cover both ends.

**Not a `use_figma` skill.** This runs in plain Node — no Figma file, no Plugin API. axe-core owns the
rule database; this skill never invents rules.

## Skill boundaries
- **Design-side visual a11y** (contrast, focus rings, target size, color-only) → use
  `figma-lint-design`. Those rules are intentionally disabled here.
- **Per-component design scorecard** → use `figma-audit-accessibility`.
- **Design-vs-code parity** → use `figma-check-design-parity` (feed it the `codeSpec.accessibility`
  this scan can emit).
- This skill does **not** use `use_figma`, so the `figma-use` conventions do not apply.

## Why visual rules are disabled

JSDOM provides a DOM but **no layout engine and no computed visual styles** — there is nothing to
measure pixels or rendered colors against. So axe's visual rules would always be "incomplete" or
wrong. The scan disables them explicitly:

- `color-contrast` and `color-contrast-enhanced` — need rendered colors.
- `link-in-text-block` — needs surrounding text layout.
- `target-size` — needs rendered box dimensions.

Everything structural/semantic (ARIA, roles, names, labels, alt, headings, landmarks, lang, dup IDs,
tabindex, ~50 rules total) runs normally. For the visual half, run `figma-lint-design` on the design.

## Usage

1. **Install deps once** (in this skill's `scripts/` dir):
   ```bash
   cd scripts && npm install
   ```
   Installs `axe-core` and `jsdom`.
2. **Run the scan** against an HTML file or an inline string:
   ```bash
   node scan.mjs path/to/component.html
   node scan.mjs --html '<button>Save</button>'
   ```
   Optional flags:
   - `--tags wcag22aa` — filter to a WCAG tag set (`wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`, `best-practice`). Repeatable / comma-separated.
   - `--context '#my-component'` — scope the scan to a CSS selector.
   - `--include-passing` — include counts of passing / incomplete / inapplicable rules.
   - `--map-to-codespec` — also emit a `codeSpecAccessibility` object (semantic element, role, aria-label, focusVisible, keyboard interactions, disabled/error support) ready to drop into `figma-check-design-parity`'s `codeSpec.accessibility`.
3. **Read the JSON** on stdout: violations grouped by rule with `severity` (critical/warning/info from
   axe `impact`), `wcagTags`, `helpUrl`, and up to 10 offending nodes each, plus a `summary`.

A bare HTML fragment is auto-wrapped in `<!DOCTYPE html><html lang="en">…<body>…` before scanning.

## Output shape

```jsonc
{
  "engine": "axe-core", "version": "4.x", "mode": "jsdom-structural",
  "note": "JSDOM mode: structural/semantic checks only. Visual rules disabled — use figma-lint-design.",
  "categories": [ { "rule": "button-name", "severity": "critical", "count": 1, "description": "...", "wcagTags": ["wcag2a","wcag412"], "helpUrl": "...", "nodes": [ { "html": "...", "target": ["button"], "failureSummary": "..." } ] } ],
  "summary": { "critical": 1, "warning": 0, "info": 0, "total": 1 }
}
```

Severity mapping: axe `critical`/`serious` → `critical`, `moderate` → `warning`, `minor` → `info`.
