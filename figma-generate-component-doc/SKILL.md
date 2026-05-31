---
name: figma-generate-component-doc
description: "Generate complete Markdown documentation for a Figma component — anatomy/layer tree, design tokens (colors, spacing, typography), states/variants matrix, accessibility notes, content guidelines, and optional code-parity + YAML frontmatter. Use when the user wants a docs page or handoff spec for a component or component set. Triggers: 'document this component', 'generate component docs/spec', 'create a docs page for the Button', 'write up the anatomy and variants', 'component handoff doc from Figma', 'turn this component into Markdown docs'. Reads the node tree, bound variables/tokens, and designer annotations, then the agent assembles Markdown. Requires the Figma Desktop app (Plugin API)."
disable-model-invocation: false
---

# figma-generate-component-doc — Figma component → Markdown docs

Produce a complete documentation page for one component or component set: overview, anatomy tree,
design tokens, variants/states matrix, typography, accessibility, content guidelines, and (optionally)
design-code parity and YAML frontmatter. This skill **collects** structured data from the file via
`use_figma`; **you (the agent) assemble** the Markdown from it using the template in references.

## Skill boundaries
- **Plugin API rules** (return pattern, async getters, page reset) → load the official
  [`figma-use`](https://www.figma.com/community/skills) skill first; this skill assumes it.
- **Shared `use_figma` idiom + helpers** → [../references/use-figma-conventions.md](../references/use-figma-conventions.md).
- **Markdown section layout + the `cleanVariantName` rule** → [references/doc-template.md](references/doc-template.md).
- **Reading/writing annotations as standalone specs** → use the `figma-annotations` skill.
- **Exporting the whole token system** (not just one component's tokens) → use `figma-export-tokens`.

## Workflow

1. **Identify the target.** Get the component or component-set node ID from the current selection or a
   URL/ID the user provides. Component **sets** (with variants) produce the richest docs.
2. **Collect data.** Run [`scripts/collect-component-data.js`](scripts/collect-component-data.js) via
   `use_figma` (`skillNames: "figma-generate-component-doc"`). It returns the anatomy tree, per-variant
   colors with bound token names, typography, spacing tokens, component property definitions
   (variants/booleans/text props), the description, and any annotations on the node and its children.
3. **Assemble Markdown** following [references/doc-template.md](references/doc-template.md). Map the
   collected data into the sections: Overview (+ When to / When NOT to Use parsed from the description),
   Anatomy, Variants & States, Tokens, Typography, Content Guidelines, Accessibility. Apply
   `cleanVariantName` so `"Type=Image, Size=12"` renders as `Image / 12`.
4. **Optional code parity.** If the user supplies a code component (props, source path, base library),
   add a Design-Code Parity section and `[View Source]` / `[Storybook]` links per the template.
5. **Optional frontmatter.** If requested, prepend YAML frontmatter (name, status, figma URL, tags).
6. **Write or return.** Write the `.md` to the path the user gave, or return inline. Report the path
   and a one-line summary (variant count, token count).

## Notes
- **Font loading:** if you add a step that writes text into Figma (e.g. stamping the doc back onto the
  canvas), `await figma.loadFontAsync(...)` first. Pure documentation generation reads only.
- The collect script uses `depth`/`maxNodes` constants to keep payloads small for deep trees — raise
  them only if the anatomy looks truncated.
- Token names come from `boundVariables`; if a value is hardcoded (no bound variable) flag it in the
  Tokens section as a hardcoded value to fix.
- These tools require the **Figma Desktop** app (the Plugin API isn't available in the browser).
