---
name: figma-export-tokens
description: "Export Figma variables to design token files in DTCG, CSS custom properties, Tailwind v4/v3, SCSS, TypeScript, or JSON. Use when the user wants to pull design tokens OUT of Figma into code — triggers: 'export tokens', 'export Figma variables', 'generate CSS variables from Figma', 'turn my Figma variables into a tokens.json / Tailwind config / SCSS', 'sync design tokens to code'. Works on ANY Figma plan (reads via the Plugin API, not the Enterprise-only Variables REST API). For the reverse direction (code → Figma) use figma-import-tokens."
disable-model-invocation: false
---

# figma-export-tokens — Figma variables → design tokens

Read every local variable in a Figma file and emit design-token files. The canonical output is
**DTCG** (W3C Design Tokens Community Group JSON); CSS, Tailwind, SCSS, TS, and JSON derive from it.

**Why this beats a raw REST export:** Figma's Variables REST API is **Enterprise-only** (`403` on
Starter/Pro/Org). This skill reads through the Plugin API via `use_figma`, so it works on **every
plan** and resolves aliases + multi-mode values that `get_variable_defs` (default mode only) drops.

## Skill boundaries
- **Plugin API rules** (return pattern, async getters, page reset) → load the official
  [`figma-use`](https://www.figma.com/community/skills) skill first; this skill assumes it.
- **Shared idiom + helpers** → [use-figma-conventions.md](../references/use-figma-conventions.md).
- **Reverse direction** (code → Figma variables) → use the `figma-import-tokens` skill.

## Workflow

1. **Confirm scope & format.** Ask (or infer) the target format (`dtcg` is the safe default), whether
   to split by mode/collection, and the output path. Get the file key from the active Figma file or a
   URL the user provides.
2. **Read the variables.** Run [`scripts/read-variables.js`](scripts/read-variables.js) via `use_figma`
   (`skillNames: "figma-export-tokens"`). It returns the normalized collections/modes/variables tree
   with hex colors, resolved alias references, scopes, and code syntax.
3. **Convert.** Transform the normalized tree to the requested format following
   [references/token-formats.md](references/token-formats.md). For DTCG, preserve round-trip metadata
   (`$extensions["figma-console-mcp"].variableId`/`key`) so a later `figma-import-tokens` matches
   instead of duplicating.
4. **Write or return.** Write file(s) to the output path (one per mode/collection slice if splitting),
   or return inline if no path was given. Report every path written + a token count summary.
5. **Validate.** Re-read one token from the emitted file and confirm its value matches the Figma
   source. For DTCG, confirm it parses as JSON.

## Notes
- Variable `name` uses `/` as the group separator (`Color/Brand/Primary`). Slug it per the target
  format's convention (kebab for CSS, dot-path for DTCG/JS).
- Large systems: the read script returns everything in one call. If serialization is huge, ask the
  user to scope to specific collection names and filter `collections` before converting.
- Spacing/size FLOATs are usually px in Figma — convert to `rem` (÷16) only when the target wants it
  (Tailwind/CSS spacing) and say so.
