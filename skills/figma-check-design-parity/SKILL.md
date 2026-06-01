---
name: figma-check-design-parity
description: "Compare a Figma node's actual specs against a code spec (the values your component renders) and get a 0–100 parity score, a list of discrepancies, and fix suggestions. Use to detect design-to-code DRIFT: triggers 'check design parity', 'does my code match the Figma', 'compare this component to the design', 'is my implementation faithful', 'find differences between design and code', 'verify the build matches Figma', 'design QA against code', 'parity score'. Reads the node's visual / typography / spacing / token / accessibility specs via use_figma (any plan) and diffs them against a codeSpec you provide. Complements the native get_design_context: instead of GENERATING code, it VALIDATES that existing code stayed in sync with the design."
disable-model-invocation: false
---

# figma-check-design-parity — design vs code drift checker

Pull a Figma node's real specs and diff them against a **codeSpec** (what your implementation
actually renders). Returns a weighted parity score, per-property discrepancies with severity, and
suggested fixes. This is the inverse of code generation: `get_design_context` turns a design into
code; this skill confirms the code didn't drift away from the design.

All design reads go through `use_figma`, so it works on **any Figma plan**.

## Skill boundaries
- **`use_figma` rules** — load the official **`figma-use`** skill first; it is the full Figma Plugin API reference. Essentials these scripts rely on: plain JS with top-level `await` + `return` (no IIFE, no `figma.closePlugin()`; `console.log` is not returned), inputs inlined as `const` at the top of each script, colors in 0–1 range, load fonts before any text op, `await figma.getNodeByIdAsync(...)`, and **atomic errors** (a failed script applies nothing — read the error, fix, retry).
- **Generating code from a design** → that's the native `get_design_context`; this skill validates, not generates.
- **CODE-side a11y to feed `codeSpec.accessibility`** → use `figma-scan-code-accessibility`
  (`--map-to-codespec` emits exactly that object).
- **Design-side WCAG lint** → use `figma-lint-design`.

## Workflow

1. **Assemble the codeSpec.** Gather the values your component renders into the `codeSpec` object
   ([references/parity-scoring.md](references/parity-scoring.md) has the full shape). You only need to
   fill the sections you want compared — `visual`, `spacing`, `typography`, `accessibility`. Tip:
   `figma-scan-code-accessibility --map-to-codespec` builds `codeSpec.accessibility` automatically.
2. **Read the design specs.** Set `NODE_ID` and paste your `codeSpec` into
   [`scripts/check-parity.js`](scripts/check-parity.js). Run it via `use_figma`
   (`skillNames: "figma-check-design-parity"`). It extracts the node's fills, strokes, corner radius,
   opacity, padding/gap, and text properties, then diffs them against the codeSpec.
3. **Read the scorecard.** `summary.parityScore` is `max(0, 100 − (critical×15 + major×8 + minor×3 +
   info×1))`. `discrepancies[]` lists each mismatch with `category`, `property`, `severity`,
   `designValue`, `codeValue`, and a `suggestion`.
4. **Decide which side to fix.** Each discrepancy says what design has vs what code has. Update code to
   match the design, or push the design to match an intentional code change (via
   `figma-manage-variables` / `figma-use`), then re-run to confirm the score rose.

## Key rules
- **Colors are 0–1 in Figma**; the script converts to hex and normalizes both sides before comparing.
- **Only filled codeSpec sections are compared.** Omit a section to skip it — no false positives for
  data you didn't provide.
- **Numeric tolerance**: dimensions compare with a small epsilon (≈2px for width/height, 0.01 for
  opacity) so sub-pixel rounding doesn't register as drift.
- **Severity drives the score**: color/spacing mismatches are `major` (−8), radius/border-width/opacity
  are `minor` (−3). See parity-scoring.md for the full weighting.
