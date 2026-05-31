---
name: figma-generate-changelog
description: "Generate a human-readable markdown changelog between two Figma file versions — pages added/removed/renamed plus per-component changes, enriched with author handles and timestamps, ready to paste into release notes, PRs, or Storybook MDX. Use when the user wants prose history — triggers: 'generate a Figma changelog', 'write release notes from Figma', 'what changed between these versions in markdown', 'summarize Figma changes for the PR', 'changelog between version A and B', 'design changelog since last release'. Uses the Figma REST API + a personal access token because version history is NOT reachable via the Plugin API / use_figma / the native Figma MCP. For raw structured diff JSON use figma-version-history; to find which version introduced a specific change use figma-blame-node."
disable-model-invocation: false
---

# figma-generate-changelog — markdown changelog between two versions

Builds on the same version diff as `figma-version-history`, then formats it as release-notes-style
**markdown** and enriches each version reference with the author handle, label, and timestamp.

## Setup & skill boundaries

- **You need a Figma PAT.** Version history is REST-only — the native Figma MCP and the Plugin API
  (`use_figma`) can't reach it. Do the token setup in
  [../references/rest-api-setup.md](../references/rest-api-setup.md) and `export FIGMA_TOKEN=...`
  first. Scopes: **File content: Read** + **File versions: Read**.
- All requests use `X-Figma-Token: $FIGMA_TOKEN` against `https://api.figma.com`.
- Related: [figma-version-history](../figma-version-history/SKILL.md) for the structured diff and the
  endpoint reference.

## Derive the file key

```bash
FILE_KEY=$(echo "$FILE_URL" | sed -E 's#.*/(design|file)/([A-Za-z0-9]+).*#\2#')
```

## Workflow

1. **Pick the two versions.** List them first if you don't have the IDs:

   ```bash
   ../figma-version-history/scripts/list-versions.sh ABC123def456
   ```

2. **Generate the changelog** with [`scripts/generate-changelog.mjs`](scripts/generate-changelog.mjs):

   ```bash
   # Page-level changelog against HEAD
   node scripts/generate-changelog.mjs --file ABC123def456 --from 4096761871 --to current

   # Include per-component changes, detailed bullets
   node scripts/generate-changelog.mjs --file ABC123def456 --from 4096761871 --to 4096800000 \
     --components 695:313,420:88 --mode detailed
   ```

   By default it prints **markdown** to stdout. Pass `--json` to get `{ markdown, data }` (the
   structured diff alongside the rendered text). Redirect to a file for release notes:

   ```bash
   node scripts/generate-changelog.mjs --file ABC123def456 --from 4096761871 --to current \
     > CHANGELOG-figma.md
   ```

3. **Modes** mirror the diff: `summary` (one punchy line of counts), `standard` (sectioned with
   counts, default), `detailed` (full per-property and per-binding bullets).

## What it captures

- A header with **From / To** version refs — label (or `(unlabeled)`), date, and author handle —
  plus the span in days. Author/label come from one extra cheap call to the versions list.
- A **Page Structure** section: pages added / removed / renamed.
- A **Components** section (when `--components` is passed): per-component change counts and bullets
  for renames, description changes, children added/removed, `componentPropertyDefinitions` changes,
  and variable-binding changes.
- A **Notes** section listing the diff's known blind spots (instances on the canvas, raw
  layout/visual props, variable VALUE changes, style content — none of which Figma REST exposes for
  historical versions).

## Notes

- Author enrichment is **best-effort**: it pages the versions list up to ~200 entries back to find
  each version's metadata. If a version is older than that lookback (or `Figma` system-attributed),
  the ref degrades gracefully to the version id.
- `current`/HEAD references render as "Current state (last modified …)".
