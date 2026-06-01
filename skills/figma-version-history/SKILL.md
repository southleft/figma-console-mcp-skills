---
name: figma-version-history
description: "List a Figma file's version history, snapshot the file at any past version, and diff two versions (added/removed/renamed pages plus deep per-component changes). Use when the user wants to inspect Figma history — triggers: 'list Figma versions', 'what versions does this file have', 'show version history', 'snapshot this file at version X', 'get the file as it was last week', 'diff two Figma versions', 'what changed between these versions', 'compare version A and B', 'did this component change between releases'. Uses the Figma REST API + a personal access token because version history is NOT reachable via the Plugin API / use_figma / the native Figma MCP. For a prose release-notes writeup use figma-generate-changelog; to find which version introduced a change use figma-blame-node."
disable-model-invocation: false
---

# figma-version-history — list, snapshot & diff Figma versions

Version history lives only in Figma's **REST API**, so this skill calls REST directly with a
personal access token (PAT). It does three things:

1. **List** a file's version history (label, description, author, timestamp, version id).
2. **Snapshot** the file (or just some nodes) as it existed at a given `version_id`.
3. **Diff** two versions — a cheap page-structure diff always, plus optional deep per-component
   diffs at `depth=2`.

> **Setup — terminal + token required.** This skill runs shell commands, so it works in **Claude Code** (including the "Code" tab inside Claude Desktop), Cursor, Codex, or Gemini CLI — it does **not** run in plain Claude Desktop or claude.ai chat (no shell). The Figma connector's OAuth login does **not** authorize these REST calls, so you must supply your own **Figma personal access token**: in Figma go to **Settings → Security → Personal access tokens**, generate one with scope *File content: read* (plus *File versions: read*), then set it in your shell: `export FIGMA_TOKEN="figd_…"`. The script reads it from the environment at runtime — never put the token in a skill file.

## Setup & skill boundaries

- All requests go to `https://api.figma.com` with the header `X-Figma-Token: $FIGMA_TOKEN`.
- Endpoint reference: [references/endpoints.md](references/endpoints.md).

## Derive the file key

The file key is the path segment after `/design/` or `/file/` in a Figma URL:

```bash
FILE_URL="https://www.figma.com/design/ABC123def456/My-File"
FILE_KEY=$(echo "$FILE_URL" | sed -E 's#.*/(design|file)/([A-Za-z0-9]+).*#\2#')
echo "$FILE_KEY"   # ABC123def456
```

## Workflow

1. **List versions** to find the `version_id`s you care about. Run
   [`scripts/list-versions.sh`](scripts/list-versions.sh):

   ```bash
   ./scripts/list-versions.sh ABC123def456              # labeled versions only (default)
   ./scripts/list-versions.sh ABC123def456 --autosaves  # include unlabeled auto-saves
   ```

   It auto-paginates (newest-first) and prints `version_id | created_at | author | label`.
   By default it filters out unlabeled auto-saves; pass `--autosaves` to keep them.

2. **Snapshot a version** with a one-line curl (omit `&version=` for current/HEAD). Save to disk so
   you can diff repeatedly without re-fetching — past versions are immutable:

   ```bash
   # Whole file at a past version (depth=1 keeps it small for orienting)
   curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
     "https://api.figma.com/v1/files/$FILE_KEY?version=4096761871&depth=1" \
     > /tmp/v-4096761871.json

   # Just specific nodes at that version (much smaller payload)
   curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
     "https://api.figma.com/v1/files/$FILE_KEY/nodes?ids=695:313&version=4096761871&depth=2"

   # Current / HEAD — omit the version param entirely
   curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
     "https://api.figma.com/v1/files/$FILE_KEY?depth=1"
   ```

3. **Diff two versions** with [`scripts/diff-versions.mjs`](scripts/diff-versions.mjs). It fetches
   both snapshots, computes a page-structure diff (cheap, 2 calls), and — if you pass
   `--components` — deep per-node diffs at depth 2 (added/removed children, name/description
   changes, `componentPropertyDefinitions` changes for COMPONENT_SETs, and `boundVariables`
   deltas):

   ```bash
   # Page-structure diff only (2 API calls)
   node scripts/diff-versions.mjs --file ABC123def456 --from 4096761871 --to current

   # Deep diff of specific component sets (2 calls per node), detailed verbosity
   node scripts/diff-versions.mjs --file ABC123def456 --from 4096761871 --to 4096800000 \
     --components 695:313,420:88 --mode detailed
   ```

   Use `current` (or omit `--to`) to diff against HEAD. `--mode` is `summary` (counts only),
   `standard` (names + counts, default), or `detailed` (full property/binding detail).

## What the diff DOES and does NOT track

The diff is honest about its blind spots — don't read "no changes" as "nothing changed":

- **Tracks:** page structure (added/removed/renamed pages); on scoped nodes — children
  added/removed, `componentPropertyDefinitions` (added/removed/type/default change),
  name & description changes, and variable **binding** references.
- **Does NOT track:** instances of components placed elsewhere on the canvas (only the nodes you
  pass as `--components`), raw layout props (hug-vs-fill, unbound paddings/widths/cornerRadius),
  unbound fills/strokes/effects, variable **VALUE** changes (Figma REST never exposes these), and
  style content. For forensic per-edit history including raw property changes, the live Desktop
  Bridge plugin's `figma_get_design_changes` is the complementary tool.

## Notes

- Figma's version pagination is cursor-style: `after=<version_id>` returns versions **older** in
  time (the list is newest-first). `list-versions.sh` handles this for you.
- Old `version_id`s can be **pruned** by Figma's plan-tier retention policy — a `404` on snapshot
  usually means the version aged out, not that your key is wrong. Re-list to get valid IDs.
- `403` on these endpoints means your PAT is missing the **File versions: Read** scope — reissue it.
