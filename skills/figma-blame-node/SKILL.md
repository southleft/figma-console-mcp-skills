---
name: figma-blame-node
description: "Find which Figma version introduced a specific change — a component property or a child node — via a binary search over version history (~log2(N) API calls instead of N). Answers 'who added this and when'. Use when the user wants git-blame-style attribution for a Figma design — triggers: 'when was this component property added', 'which version introduced this variant', 'who added this node', 'blame this Figma element', 'find when this was created', 'git blame for Figma', 'when did this property first appear'. Uses the Figma REST API + a personal access token because version history is NOT reachable via the Plugin API / use_figma / the native Figma MCP. For a full diff between two versions use figma-version-history; for prose release notes use figma-generate-changelog."
disable-model-invocation: false
---

# figma-blame-node — binary-search which version introduced a change

Like `git blame`, but for Figma. Given a node and a target (a `componentPropertyDefinitions` key or
a descendant child node id), this localizes the **version that first introduced** the target and
returns that version's label, author handle, and timestamp.

> **Setup — terminal + token required.** This skill runs shell commands, so it works in **Claude Code** (including the "Code" tab inside Claude Desktop), Cursor, Codex, or Gemini CLI — it does **not** run in plain Claude Desktop or claude.ai chat (no shell). The Figma connector's OAuth login does **not** authorize these REST calls, so you must supply your own **Figma personal access token**: in Figma go to **Settings → Security → Personal access tokens**, generate one with scope *File content: read* (plus *File versions: read*), then set it in your shell: `export FIGMA_TOKEN="figd_…"`. The script reads it from the environment at runtime — never put the token in a skill file.

## Why binary search

A naive walk would fetch the node at every version — `N` API calls for `N` versions. Existence of a
target is **monotonic** (added once, then present in every newer version up to HEAD), so we binary
search: probe the midpoint, check whether the target exists there, then narrow to the older or newer
half. That's **~log2(N)** calls — e.g. ~8 probes across 200 versions instead of 200. This is the
rate-limit-friendly approach: Figma REST is throttled per token, and old snapshots are immutable, so
fewer probes is strictly better.

## Setup & skill boundaries

- All requests use `X-Figma-Token: $FIGMA_TOKEN` against `https://api.figma.com`.

## Derive the file key

```bash
FILE_KEY=$(echo "$FILE_URL" | sed -E 's#.*/(design|file)/([A-Za-z0-9]+).*#\2#')
```

## Workflow

1. **Identify the node and the target.** `node_id` is typically a COMPONENT_SET. The target is
   **exactly one** of:
   - `--property '<key>'` — a `componentPropertyDefinitions` key like `Disabled#1:2`, or
   - `--child '<node_id>'` — a descendant node id that should appear under `node_id`.

   List versions first if you want to bound the search or sanity-check IDs:

   ```bash
   ../figma-version-history/scripts/list-versions.sh ABC123def456 --autosaves
   ```

2. **Run the blame search** with [`scripts/blame-node.mjs`](scripts/blame-node.mjs):

   ```bash
   # When was a component property first added?
   node scripts/blame-node.mjs --file ABC123def456 --node 695:313 --property 'Disabled#1:2'

   # When was a child node first added under a component set?
   node scripts/blame-node.mjs --file ABC123def456 --node 695:313 --child 695:340

   # Bound the lookback and start from a specific version instead of HEAD
   node scripts/blame-node.mjs --file ABC123def456 --node 695:313 --property 'Size#9:0' \
     --start 4096800000 --max 100 --no-autosaves
   ```

   It prints JSON: the introducing version (`version_id`, `label`, `user_handle`, `created_at`), an
   `attribution_certainty`, and a `probes_made` count so you can see how few calls it took.

## Reading the result

`attribution_certainty` tells you how much to trust the answer:

- `exact` — a real, attributable version introduced the target.
- `system_attributed` — the introducing version was a system autosave (`user = "Figma"`). Re-run
  with `--no-autosaves` to snap to the nearest **labeled** version that contains the change.
- `exists_at_lookback_horizon` — the target also exists at the oldest version we scanned, so the
  true introduction is **older than the search range**. Increase `--max`.
- `metadata_unavailable` — introduced at `--start` itself but author metadata wasn't found within
  the versions-list lookback. The introduction is real; the user just isn't attributable from REST.

## Notes & caveats

- **Monotonicity assumption:** binary search assumes the target was added once and never removed. If
  it was added, removed, then re-added, the reported introduction point may be the later re-add.
- **`--start` must contain the target.** You're asking "when was this introduced", so the search
  requires the target to exist at the starting version (default HEAD/`current`). To track something
  that was **removed**, pick a `--start` where it still existed.
- Autosaves are **included by default** for finer attribution (most autosaves carry the real human
  user). Use `--no-autosaves` for human-labeled attribution only.
- A `404` mid-search usually means a probed `version_id` was pruned by retention — re-run; the
  search tolerates and skips missing nodes.
