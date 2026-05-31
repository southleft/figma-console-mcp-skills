# Figma Console MCP Skills

**The most powerful [Figma Console MCP](https://github.com/southleft/figma-console-mcp) capabilities,
repackaged as Markdown skills for the _native_ Figma MCP server.**

The official Figma MCP server is intentionally general-purpose: it reads designs
(`get_design_context`, `get_metadata`, `get_variable_defs`, `get_screenshot`, `search_design_system`)
and writes to Figma through a single JavaScript-execution tool, `use_figma`. It is excellent at
design↔code, but it doesn't ship the deep **design-systems** tooling that the
[Figma Console MCP](https://github.com/southleft/figma-console-mcp) has — token export/import,
variable management, component-set analysis, WCAG linting, accessibility audits, version
diffing/changelogs, annotations, comments, FigJam, and Slides.

This repo bridges that gap. Each directory here is a **skill** — a Markdown playbook (plus
ready-to-paste scripts) that teaches your AI agent to perform a Console MCP capability using only the
native Figma MCP. Plugin-API capabilities run through `use_figma`; a few read-only capabilities
(version history, comments) use the Figma REST API.

> **You do not need to install the Figma Console MCP to use these skills.** You only need the native
> Figma MCP server and (for the four REST skills) a Figma personal access token.

---

## How it works

A "skill" is a folder containing a `SKILL.md` with YAML frontmatter (`name`, `description`). When your
request matches a skill's `description`, the agent loads it and follows the playbook. You can also
invoke one explicitly with `/skill-name`.

- **`scripts/*.js`** — ready-to-paste snippets for the native `use_figma` tool. They follow the
  `use_figma` execution model (plain JS, top-level `await`, `return` for output, inlined inputs). See
  [`references/use-figma-conventions.md`](references/use-figma-conventions.md).
- **`scripts/*.mjs` / `*.sh`** — runnable Node/bash for the REST and code-side skills.
- **`references/*.md`** — on-demand detail loaded when needed.

**Prerequisite:** Always load the official **`figma-use`** skill alongside any Plugin-API skill here —
it's the source of truth for the Figma Plugin API surface. These skills add design-systems workflows
on top of it.

---

## Install

Clone, then copy the skill directories into your agent's skills folder.

```bash
git clone https://github.com/southleft/figma-console-mcp-skills.git
cd figma-console-mcp-skills

# Claude Code / Claude Desktop: skills live in ~/.claude/skills
# Copy the skill folders AND the shared references/ folder together — each skill links to
# ../references/..., so references/ must sit as a sibling of the skill folders.
cp -R figma-* figjam-* references ~/.claude/skills/
```

After this, a skill at `~/.claude/skills/figma-export-tokens/` resolves `../references/...` to
`~/.claude/skills/references/` — so the shared docs link correctly. For other MCP hosts, place each
skill folder wherever that host discovers skills, keeping `references/` as their sibling (or just keep
this cloned repo and point your host at it). Then start a chat with the native Figma MCP connected and
either let the agent auto-select a skill or type `/figma-export-tokens` (etc.).

### REST skills need a Figma token

`figma-version-history`, `figma-generate-changelog`, `figma-blame-node`, and `figma-comments` read
data the Plugin API can't reach (version history, comments). They call the Figma REST API with a
personal access token — one-time setup in
[`references/rest-api-setup.md`](references/rest-api-setup.md). All other skills need nothing beyond
the native Figma MCP.

---

## The 22 skills

### 🎨 Tokens & Variables — _the native MCP can't write tokens; these can_
| Skill | What it does |
|---|---|
| [`figma-export-tokens`](figma-export-tokens) | Export Figma variables → DTCG / CSS vars / Tailwind v4–v3 / SCSS / TS / JSON. Resolves aliases + multi-mode. Works on **any plan** (Plugin API, not the Enterprise-only Variables REST API). |
| [`figma-import-tokens`](figma-import-tokens) | Push tokens (DTCG/etc.) **into** Figma as variables, non-destructively (matches by id/key/name). |
| [`figma-setup-design-tokens`](figma-setup-design-tokens) | Bootstrap a whole token system (collection + modes + variables) atomically. |
| [`figma-manage-variables`](figma-manage-variables) | CRUD + fast batch create/update, scopes, code syntax, add/rename modes. |
| [`figma-library-variables`](figma-library-variables) | Discover & import variables from subscribed team libraries. |

### 🧩 Components & Design System
| Skill | What it does |
|---|---|
| [`figma-analyze-component-set`](figma-analyze-component-set) | Extract a variant **state machine** + CSS pseudo-class mapping + per-variant visual diffs for code gen. |
| [`figma-arrange-component-set`](figma-arrange-component-set) | Organize variants into a labeled grid container. |
| [`figma-component-properties`](figma-component-properties) | Add/edit/delete component properties; instantiate + set instance properties. |
| [`figma-design-system-inventory`](figma-design-system-inventory) | One-call unified extraction: tokens + components + styles + visual specs. |
| [`figma-deep-component`](figma-deep-component) | Unlimited-depth component tree with resolved tokens, mainComponent refs, reactions. |

### ♿ Quality & Accessibility — _the native MCP has nothing design-side here_
| Skill | What it does |
|---|---|
| [`figma-lint-design`](figma-lint-design) | WCAG 2.2 + design-system quality lint over a node tree. |
| [`figma-audit-accessibility`](figma-audit-accessibility) | Per-component a11y scorecard: state coverage, focus, target size, color-blind sim. |
| [`figma-scan-code-accessibility`](figma-scan-code-accessibility) | axe-core + JSDOM scan of generated HTML (code-side Node script). |
| [`figma-check-design-parity`](figma-check-design-parity) | Compare a Figma node vs a code spec; parity score + discrepancies. |

### 🕓 Versioning & Collaboration — _REST + Figma token_
| Skill | What it does |
|---|---|
| [`figma-version-history`](figma-version-history) | List versions, snapshot a version, diff two versions. |
| [`figma-generate-changelog`](figma-generate-changelog) | Human-readable markdown changelog between versions. |
| [`figma-blame-node`](figma-blame-node) | Binary-search which version introduced a node/property change (~log₂N requests). |
| [`figma-comments`](figma-comments) | Read / post / reply / delete file comments (with node pinning). |

### 📝 Documentation, Annotations, FigJam & Slides
| Skill | What it does |
|---|---|
| [`figma-generate-component-doc`](figma-generate-component-doc) | Generate complete component documentation markdown (anatomy, tokens, states, a11y, parity). |
| [`figma-annotations`](figma-annotations) | Read & write designer annotations (specs pinned to nodes) + categories. |
| [`figjam-create-content`](figjam-create-content) | Author FigJam: stickies, connectors, shapes, sections, tables, code blocks, auto-arrange. |
| [`figma-slides`](figma-slides) | Author Figma Slides: create/reorder slides, text/shapes, backgrounds, transitions. |

> `figjam-create-content` only works in a **FigJam** file and `figma-slides` only in a **Figma Slides**
> file (the editor-specific node types throw elsewhere). The token, variable, component, lint, and
> a11y skills work in standard Figma **design** files.

---

## What we deliberately left out (to avoid conflicts)

These overlap with the native Figma MCP's built-in tools, so there's no skill for them — use the
native tool instead:

- **Design-to-code / inspect a node** → native `get_design_context`
- **Screenshots** → native `get_screenshot`
- **File metadata / structure** → native `get_metadata`
- **Basic variable defs (default mode)** → native `get_variable_defs` _(our token skills go further:
  alias resolution + every mode)_
- **Component search** → native `search_design_system`
- **Code Connect** → native Code Connect suite
- **Create a new file / diagram** → native `create_new_file` / `generate_diagram`
- **Low-level node create/move/resize/fills/text** → already taught by the official `figma-use` skill

---

## FAQ

**Do I need the Figma Console MCP installed?** No. These skills run on the native Figma MCP. They're
distilled from the Console MCP's implementation so you get the capabilities without the extra server.

**Why is `use_figma` enough for tokens/variables/components?** Because `use_figma` executes the Figma
Plugin API in the file context — the same API the Console MCP's Desktop Bridge uses. The scripts here
are that logic, rewritten for the `use_figma` idiom.

**Why do four skills need a token?** Version history and comments live only in Figma's REST API, which
the Plugin API (and therefore `use_figma`) can't reach. See
[`references/rest-api-setup.md`](references/rest-api-setup.md).

**My script errored on the first `use_figma` call.** Failed scripts are atomic — nothing was applied.
Read the error, fix, retry. See [`references/use-figma-conventions.md`](references/use-figma-conventions.md).

---

## Contributing

PRs welcome — new skills, better ports, more output formats. Keep each skill self-contained, mirror
the existing `SKILL.md` structure (frontmatter + "Skill boundaries" + workflow), and make scripts
follow the `use_figma` conventions. Run a quick syntax check (`node --check` wrapped in an async
function for `use_figma` scripts; `bash -n` for shell) before opening a PR.

## Credits & license

Distilled from the [Figma Console MCP](https://github.com/southleft/figma-console-mcp) by
[Southleft](https://southleft.com). MIT licensed — see [LICENSE](LICENSE).
