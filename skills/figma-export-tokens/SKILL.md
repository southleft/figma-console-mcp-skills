---
name: figma-export-tokens
description: "Export Figma variables to design token files in DTCG, CSS custom properties, Tailwind v4/v3, SCSS, TypeScript, JSON, Style Dictionary, or Tokens Studio. Use when the user wants to pull design tokens OUT of Figma into code — triggers: 'export tokens', 'export Figma variables', 'generate CSS variables from Figma', 'turn my Figma variables into a tokens.json / Tailwind config / SCSS', 'sync design tokens to code'. Works on ANY Figma plan (reads via the Plugin API, not the Enterprise-only Variables REST API). For the reverse direction (code → Figma) use figma-import-tokens."
disable-model-invocation: false
---

# figma-export-tokens — Figma variables → design tokens

Read every local variable in a Figma file and emit design-token files. The canonical output is
**DTCG** (W3C Design Tokens Community Group JSON); CSS, Tailwind, SCSS, TS, and JSON derive from it.

**Why this beats a raw REST export:** Figma's Variables REST API is **Enterprise-only** (`403` on
Starter/Pro/Org). This skill reads through the Plugin API via `use_figma`, so it works on **every
plan** and resolves aliases + multi-mode values that `get_variable_defs` (default mode only) drops.

## Skill boundaries
- **`use_figma` rules** — load the official **`figma-use`** skill first; it is the full Figma Plugin API reference. Essentials these scripts rely on: plain JS with top-level `await` + `return` (no IIFE, no `figma.closePlugin()`; `console.log` is not returned), inputs inlined as `const` at the top of each script, colors in 0–1 range, load fonts before any text op, `await figma.getNodeByIdAsync(...)`, and **atomic errors** (a failed script applies nothing — read the error, fix, retry).
- **Reverse direction** (code → Figma variables) → use the `figma-import-tokens` skill.

## Workflow

1. **Confirm scope & format.** Ask (or infer) the target format (`dtcg` is the safe default), whether
   to split by mode/collection, and the output path. Get the file key from the active Figma file or a
   URL the user provides.
2. **Read the variables.** Run [`scripts/read-variables.js`](scripts/read-variables.js) via `use_figma`
   (`skillNames: "figma-export-tokens"`). It returns the normalized collections/modes/variables tree
   with hex colors, resolved alias references, scopes, and code syntax.
3. **Save the read output** to a file, e.g. `variables.json`.
4. **Convert — deterministically.** Run the bundled converter (Node 18+, zero dependencies). **Do not
   hand-write the conversion** — this script is the source of truth and produces identical output every
   run:
   ```bash
   node scripts/convert-tokens.mjs variables.json --format dtcg --out tokens/
   # --format: dtcg (default) | css-vars | tailwind-v4 | tailwind-v3 | scss | ts-module
   #           | json-flat | json-nested | style-dictionary-v3 | tokens-studio
   #           (aliases: css, tailwind, ts)
   # --out <dir>  write file(s) — tokens-studio writes several; omit to print to stdout
   # --prefix <p>            prefix CSS/SCSS var names
   # --modes Light,Dark      include only these modes (default: all)
   # --collection <substr>   include only collections whose name contains <substr>
   ```
   This matches the Console `figma_export_tokens` formatters. It handles exactly what freehand
   conversion gets wrong: **per-type units** (opacity/line-height unitless, spacing/radius `px`);
   **multi-mode** output (CSS & Tailwind v4 emit `:root` + `.dark`/`[data-theme]`; TS/JSON emit
   `{mode: value}`; SCSS suffixes modes; DTCG keeps them in `$extensions`); **aliases → `var()`/`{ref}`**;
   **font-weight names → numbers**; DTCG round-trip metadata; and it **warns** on slug collisions and
   non-numeric weights. (`style-dictionary-v3` and `tailwind-v3` use the primary mode, matching the
   Console — those formats have no native multi-mode encoding.)
5. **Report.** Surface the written path(s) and any warnings the converter printed (collisions /
   weight issues are real findings about the Figma file, worth flagging to the user).

## Notes
- **The converter is deterministic and authoritative.** [references/token-formats.md](references/token-formats.md)
  documents the formats it emits; it is reference, not a thing to re-implement by hand.
- **Where it runs:** `read-variables.js` runs anywhere via `use_figma`. `convert-tokens.mjs` is Node,
  so it needs a terminal-capable agent (Claude Code, the Code tab in Claude Desktop, Cursor, Codex,
  Gemini CLI). In plain Desktop/web chat (no shell), run the converter on your own machine against the
  saved `variables.json`, or accept a best-effort inline conversion for DTCG only.
- **Large systems:** if the read is huge, scope it to specific collection names before saving.
- **Aliases across collections** become `var(--…)` / `{ref}` — export *all* collections together so
  those references resolve.
