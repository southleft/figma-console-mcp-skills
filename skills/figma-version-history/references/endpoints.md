# Figma REST endpoints — version history

All requests use the header `X-Figma-Token: $FIGMA_TOKEN` against `https://api.figma.com`.
Token setup: [../../../references/rest-api-setup.md](../../../references/rest-api-setup.md). Required PAT
scopes: **File content: Read** and **File versions: Read**.

## List versions

```
GET /v1/files/{file_key}/versions?page_size=50&after={version_id}
```

- `page_size`: 1–50 (default 30). Use 50 to minimize round-trips.
- Pagination is **cursor-style** and the list is **newest-first**. Counter-intuitively,
  `after={version_id}` returns versions that are **OLDER** in time (and `before=` returns newer).
  To page into history, pass the **last** id from the current page as `after` on the next call.
- Follow `pagination.next_page` (a full URL) until it's absent, or stop when you have enough.
- Each entry: `{ id, created_at, label, description, user: { id, handle, img_url } }`.
- A version with an empty/null `label` is an auto-save; filter these unless you want them.

```bash
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/FILEKEY/versions?page_size=50"
```

## Snapshot a version

Whole file — omit `version` for current/HEAD:

```
GET /v1/files/{file_key}?version={version_id}&depth={n}
```

Node-scoped (much smaller payload):

```
GET /v1/files/{file_key}/nodes?ids={id1,id2}&version={version_id}&depth={n}
```

- `version` is the `id` from the versions list. **Omit it entirely for HEAD/current.**
- `depth` limits tree recursion — `depth=1` for page-level orientation, `depth=2` for component
  internals. Lower is cheaper.
- Past-version snapshots are **immutable** — cache them on disk and re-diff locally.

```bash
# At a version
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/FILEKEY?version=4096761871&depth=1"

# Just two nodes at depth 2
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/FILEKEY/nodes?ids=695:313,420:88&version=4096761871&depth=2"
```

## Diffing

There is no Figma "diff" endpoint — diffing is done client-side by fetching two snapshots and
comparing. `diff-versions.mjs` implements:

- **Page-structure diff** from two `depth=1` file documents: pages added / removed / renamed
  (matched by page `id`).
- **Per-node diff** from two `depth=2` node fetches per scoped node:
  - children added / removed (matched by child `id`)
  - `name` and `description` changes
  - `componentPropertyDefinitions` changes for COMPONENT_SETs (added / removed / type change /
    default change), keyed by `propName#nodeId`
  - `boundVariables` deltas (variable bindings added / removed / rebound), walked over the matched
    subtree, top-level bindings only

## Error hints

- `403` → PAT missing **File versions: Read** (for `/versions`) or **File content: Read** (snapshots).
- `404` on a snapshot → the `version_id` was pruned by Figma's plan-tier retention, or doesn't
  belong to this file. Re-list to get valid IDs.
