---
name: figma-extract-design-system
description: "Extract a design system from vibe-coded production apps that never had one: inventory components, mine de-facto styling into DTCG tokens, scaffold a Storybook package, port components, and optionally round-trip tokens/components into Figma. Use when the user wants to 'extract a design system', 'create a design system from this app/codebase', 'reverse-engineer our components into Storybook', 'turn our app styles into tokens', or 'consolidate the UI of several AI-built products'. Works best with the figma-console-mcp local server connected (figma_ds_* tools); includes an agent-driven fallback."
disable-model-invocation: false
---

# figma-extract-design-system — production app(s) → design system

Organizations let small teams vibe-code products with AI. The products work — but there's no
design system underneath, so nothing is consistent, reusable, or versionable. This skill runs the
extraction engagement: **app(s) → component inventory → DTCG tokens → Storybook package →
(optionally) Figma**.

Two valid stopping points:
- **Code-led org**: stop at the Storybook package. It becomes the versioned source of truth that
  gets packaged and re-imported into the products.
- **Design-led org**: continue into Figma — tokens become variables (`figma_import_tokens`),
  key components become Figma component sets.

## Tooling modes

- **Preferred — figma-console-mcp connected (Local Mode):** use the five `figma_ds_*` tools.
  They are deterministic, bounded, and persist manifests under `<outDir>/.extraction/` so the
  engagement survives session boundaries.
- **Fallback — no console MCP:** do the same phases yourself with Read/Grep/Bash (slower, less
  deterministic). Keep the same artifacts: an `analysis.json` you write yourself, DTCG
  `tokens/tokens.json`, and the same package layout. For the Figma round-trip use the
  `figma-import-tokens` skill (official Figma MCP `use_figma`).

## Phase 0 — Discovery (talk first)

Establish with the user before scanning:
1. **Target app path(s)** — absolute paths. Multiple apps is a feature: the real design system is
   the *intersection* of their products.
2. **Code-led or design-led?** Decides whether Phase 6 (Figma) happens.
3. **Brand/naming context** — product name, existing brand color names if any. Needed for the
   semantic-naming pass.
4. **Where the design system lives** — default `<first app>/design-system`, or a separate dir in
   the monorepo.

## Phase 1 — Analyze

```
figma_ds_analyze { targets: ["/abs/path/app"], outDir: "/abs/path/app/design-system" }
```

Review the summary **with the user** before proceeding — especially the
**`architecture` block**, which is what separates a design system from a UI kit:

- **`specializations`** are usage-named components (`FollowButton`, `ModerationMenu`,
  `NodeCard`) — each is really a generic component (`Button`, `Menu`, `Card`) plus a
  usage. The usage is what makes it a "follow button"; the component is just a button.
- **`missingPrimitives`** is the build list: generics the app implies but never made.
- **`levels`** is the atomic-design read (atom/molecule/organism/template) — heuristic;
  confirm the org's vernacular with the user.

**Generalization pass (after review, before/during porting):** if the
**design-systems-assistant MCP** is connected, ground decisions in it
(`search_design_knowledge` for naming conventions, component API design, atomic
hierarchy — it carries the cross-industry best practices). Then:
1. Build each agreed `missingPrimitive` as a generic component with a variant/prop API
   wide enough to cover its observed specializations.
2. Re-express each specialization as a **recipe**: either a story on the generic
   ("Button → Recipes/Follow") or a thin wrapper in a `recipes/` tier — never a
   sibling primitive. The product keeps its follow button; the SYSTEM ships Button.
3. Organize Storybook by the chosen layers (e.g. `Primitives/`, `Components/`,
   `Patterns/`) instead of one flat `Components/` list.
4. Not every specialization collapses — positional qualifiers (LeftNav) or true
   one-off organisms (ThreadCanvas) may stay; the report proposes, the user disposes.

Also review the classic items:
- **Classification matters.** `vendored` (shadcn-style copied source) and `bespoke` get ported
  as-is; `wrapped` gets ported keeping the vendor package as a peer dep; `pure-vendor` (raw
  MUI/Chakra usage) is NOT ported — it's represented by theme/tokens and usage docs.
- **duplicateGroups** are the vibe-code smell (three Button.tsx files). Decide the canonical one
  per group with the user; record losers as `skipped` in figma_ds_status with a note.
- Porting order = the tool's usage ranking (`topByUsage`). Don't port long-tail components nobody
  uses without asking.

## Phase 2 — Extract tokens

```
figma_ds_extract_tokens { outDir, formats: [...match the app's styling method...] }
```

- `declared` tokens (CSS vars, @theme, SCSS vars, tailwind theme, shadcn HSL triples) keep their
  names and carry `sources` provenance. `.dark` / `[data-theme=dark]` values become a real
  Light/Dark multi-mode structure.
- `inferred` tokens are frequency-promoted raw values — **review them with the user**; the
  `belowThreshold` list is worth a skim for near-misses.

**Semantic-naming pass (your job, not the tool's):** structural names (`color/blue/500`,
`color/extracted/hex-22c55e`) are correct but not shippable. With the user's brand context,
layer semantic alias tokens (`color/primary` → `{color.blue.500}`) by editing
`tokens/tokens.json` — add to the `Semantic` group, reference primitives with `{dot.path}`
aliases, never delete the primitives. Re-run `figma_ds_extract_tokens` only if the codebase
changed (it regenerates; hand edits to generated projections are lost, edits to tokens.json are
the input for scaffold).

## Phase 3 — Scaffold + Storybook

```
figma_ds_scaffold { outDir, packageName: "@org/design-system" }
cd <outDir> && npm install && npm create storybook@latest -- --yes --no-dev
figma_ds_setup_storybook { outDir }    # AFTER init — wires the workshop to the extraction
```

`figma_ds_setup_storybook` generates `.storybook/preview.css` (extracted tokens + the source
app's @theme mapping, @utility definitions, @layer base, and @font-face rules so production
class names and fonts render faithfully), copies self-hosted fonts, and patches main.js
(tailwind vite plugin + automatic JSX runtime) and preview.jsx (theme toolbar/decorator from
the extracted mode names). Apply any `manualSteps` it returns, then restart the dev server.
Verify `.storybook/main` story globs include `src/**/*.mdx` — the generated
`src/docs/*.mdx` pages are the token/typography/iconography showcases.

## Phase 4 — Port components (the loop)

Per component, in usage-rank order:

1. `figma_ds_extract_component { outDir, component: "Button" }` — gives source, local import
   closure, prop contract, **observed call-site variants**, style touchpoints, and a CSF3 story
   scaffold.
2. Port into `<outDir>/src/components/<Name>/` — each component gets its own directory, component
   file, stories file, and index (never monolithic files). Decouple app-specific imports
   (routing, data fetching, global state); replace hardcoded values with tokens (check
   `styleTouchpoints.customProperties` against tokens.json).
3. Adapt the story scaffold — one story per *real* variant (observedProps), `tags: ['autodocs']`.
4. **Visually verify in Storybook** (browser) before calling it done.
5. `figma_ds_status { outDir, update: { component, status: "ported", storyFile } }`.

Long engagements: `figma_ds_status { outDir }` at session start tells you exactly where you left
off.

## Phase 5 — Code-led stopping point

Buildable, versioned package: components + tokens + Storybook. Set up whatever
publishing/versioning the org uses (changesets, private registry). The products then consume
`@org/design-system` instead of their local copies — that migration is a separate engagement.

## Phase 6 — Design-led: into Figma

1. **Tokens → variables:** `figma_import_tokens` with `tokens/tokens.json` (top-level groups
   become collections; Light/Dark modes come across). Preview with `strategy: "dry-run"` first.
2. **Components → Figma:** rebuild key components as component sets using the existing tools
   (`figma_create_component_set`, `figma_execute`) or the `figma-generate-library` /
   `prototype-to-figma` workflows — bind fills/strokes/radii to the imported variables so Figma
   and code share one token source.
3. From then on the sync loop is `figma_export_tokens` / `figma_import_tokens` diff-aware merge.

## Boundaries & gotchas

- `figma_ds_*` tools are **Local Mode only** (they read/write the local filesystem).
- Extraction never mutates the target app — everything lands under `outDir`.
- Absolute paths always: the MCP server's working directory is not the project.
- Don't hand-edit generated projections (`tokens.css`, `theme.css`, …); edit `tokens.json` (or
  the source app) and regenerate.
- Provenance lives in `$extensions["figma-console-mcp.extraction"]` on every token — use it to
  justify decisions to the user ("this is your primary because it appears 214 times").
