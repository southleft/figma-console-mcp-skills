# figma-check-design-parity — scoring & codeSpec shape

## The parity score

```
parityScore = max(0, 100 − (critical×15 + major×8 + minor×3 + info×1))
```

A perfect match is 100. Each discrepancy subtracts points by its severity. The score floors at 0 — a
heavily drifted component cannot go negative.

## Severity per property

The comparator in [`scripts/check-parity.js`](../scripts/check-parity.js) assigns severity by how
visible the drift is to a user:

| Category | Property | Severity | Weight |
|----------|----------|----------|--------|
| visual | `backgroundColor`, `borderColor` | major | −8 |
| visual | `borderWidth`, `borderRadius`, `opacity` | minor | −3 |
| spacing | `paddingTop/Right/Bottom/Left`, `gap` | major | −8 |
| spacing | `width`, `height` | minor | −3 |
| typography | `fontFamily`, `fontSize` | major | −8 |
| typography | `fontWeight`, `lineHeight`, `letterSpacing` | minor | −3 |
| accessibility | `supportsDisabled`, `supportsError` | minor | −3 |
| accessibility | `annotation` (role/aria not documented) | info | −1 |

`critical` (−15) is reserved by the parity model for the most severe mismatches; the standard
comparators here emit major/minor/info. The score formula still honors any `critical` discrepancy you
choose to record.

## Numeric tolerance

Comparisons use a small epsilon so sub-pixel rounding doesn't register as drift:

- padding / gap / font size / border width / radius: ±1px
- width / height: ±2px
- opacity: ±0.01
- font weight: ±1
- line height: ±1
- letter spacing: ±0.1

Colors are normalized (Figma 0–1 → hex, opaque alpha dropped, uppercased) before string comparison.

## codeSpec shape

Provide only the sections you want compared. Omitted sections (or omitted fields) are skipped — no
false positives for data you didn't supply.

```jsonc
{
  "filePath": "src/components/Button.tsx",          // optional, for reference
  "visual": {
    "backgroundColor": "#3B6BFF",
    "borderColor": "#1F2937",
    "borderWidth": 1,
    "borderRadius": 8,                                 // number or px string
    "opacity": 1
  },
  "spacing": {
    "paddingTop": 12, "paddingRight": 16, "paddingBottom": 12, "paddingLeft": 16,
    "gap": 8,
    "width": 120, "height": 40                         // number or px string
  },
  "typography": {
    "fontFamily": "Inter",
    "fontSize": 16,
    "fontWeight": 600,                                 // number or string
    "lineHeight": 24,                                  // px
    "letterSpacing": 0
  },
  "accessibility": {
    "role": "button",
    "ariaLabel": "Save",
    "focusVisible": true,
    "supportsDisabled": true,
    "supportsError": false,
    "semanticElement": "button",
    "keyboardInteractions": ["Enter", "Space"]
  },
  "metadata": { "name": "Button" }
}
```

**Auto-build `accessibility`:** run `figma-scan-code-accessibility` with `--map-to-codespec` over your
component HTML — its `codeSpecAccessibility` output drops straight into `codeSpec.accessibility`.

## Result shape

```jsonc
{
  "node": { "id": "12:34", "name": "Button", "type": "COMPONENT_SET" },
  "summary": {
    "totalDiscrepancies": 2,
    "parityScore": 89,
    "byCritical": 0, "byMajor": 1, "byMinor": 1, "byInfo": 0,
    "categories": { "visual": 1, "spacing": 1 }
  },
  "discrepancies": [
    { "category": "visual", "property": "backgroundColor", "severity": "major",
      "designValue": "#3B6BFF", "codeValue": "#2F5BEE",
      "message": "Background color mismatch: design=#3B6BFF, code=#2F5BEE",
      "suggestion": "Update to match #3B6BFF" }
  ],
  "ai_instruction": "Review each discrepancy: update code to match designValue, or push the design to match an intentional code change, then re-run."
}
```

> **Parity with the Console tool.** The Console MCP `figma_check_design_parity` returns three
> additional fields that this skill intentionally omits: `actionItems[]` (pre-computed fix
> suggestions), `designData` (the extracted design spec), and `codeData` (the parsed code spec).
> Here the skill returns only `discrepancies[]` + `parityScore` (plus `node`, `summary`, and
> `ai_instruction`), and the agent reads the discrepancies and **proposes the fixes itself** rather
> than relying on a generated `actionItems` list. If you need the raw design/code specs, fetch them
> separately (e.g. via `get_design_context` / your code spec) — they are not part of this output.

## Relationship to native tooling

`get_design_context` reads a design to **generate** code. This skill does the opposite: it
**validates** that already-written code still matches the design, catching drift after either side
changes. Use it in review/QA, not in the initial generation pass.
