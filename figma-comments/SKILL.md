---
name: figma-comments
description: "Read, post, reply to, and delete comments on a Figma file via the REST API — including pinning a comment to a specific node and threading replies. Use when the user wants to work with Figma comments programmatically — triggers: 'get Figma comments', 'read comments on this file', 'post a comment in Figma', 'leave a comment on this node', 'reply to a Figma comment', 'pin a comment to this element', 'delete a Figma comment', 'notify designers of drift', 'add a review note in Figma'. Uses the Figma REST API + a personal access token because comments are NOT reachable via the Plugin API / use_figma / the native Figma MCP."
disable-model-invocation: false
---

# figma-comments — read, post, reply & delete Figma comments

Comments live only in Figma's **REST API** — the Plugin API (`use_figma`) and the native Figma MCP
can't touch them. This skill reads comment threads, posts new comments (optionally pinned to a node),
replies to existing threads, and deletes comments.

> **Setup — terminal + token required.** This skill runs shell commands, so it works in **Claude Code** (including the "Code" tab inside Claude Desktop), Cursor, Codex, or Gemini CLI — it does **not** run in plain Claude Desktop or claude.ai chat (no shell). The Figma connector's OAuth login does **not** authorize these REST calls, so you must supply your own **Figma personal access token**: in Figma go to **Settings → Security → Personal access tokens**, generate one with scope *File content: read* (plus *Comments: read/write*), then set it in your shell: `export FIGMA_TOKEN="figd_…"`. The script reads it from the environment at runtime — never put the token in a skill file.

## Setup & skill boundaries

- All requests use `X-Figma-Token: $FIGMA_TOKEN` against `https://api.figma.com`.
- **`@mentions` are a Figma UI-only feature.** Putting `@name` in a message renders as plain text,
  not a clickable mention, and does **not** trigger a Figma notification.

## Derive the file key

```bash
FILE_KEY=$(echo "$FILE_URL" | sed -E 's#.*/(design|file)/([A-Za-z0-9]+).*#\2#')
```

## Read comments

[`scripts/get-comments.sh`](scripts/get-comments.sh) lists threads with author, message, timestamps,
pinned node, and resolution state. Resolved threads are filtered out by default:

```bash
./scripts/get-comments.sh ABC123def456                 # active comments only
./scripts/get-comments.sh ABC123def456 --include-resolved
./scripts/get-comments.sh ABC123def456 --md             # request markdown message bodies
```

Raw endpoint:

```bash
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/ABC123def456/comments?as_md=true"
```

## Post a comment

[`scripts/post-comment.sh`](scripts/post-comment.sh) posts a top-level comment, a node-pinned
comment, or a threaded reply:

```bash
# Plain file-level comment
./scripts/post-comment.sh ABC123def456 "Heads up: the button radius drifted from code."

# Pinned to a node (appears on that element). x/y default to 0,0 if omitted.
./scripts/post-comment.sh ABC123def456 "Padding here should be 16, not 12." --node 695:313 --x 40 --y 12

# Reply to an existing thread (get IDs from get-comments.sh)
./scripts/post-comment.sh ABC123def456 "Fixed in the latest sync." --reply 123456789
```

The raw POST body shape:

```bash
curl -s -X POST -H "X-Figma-Token: $FIGMA_TOKEN" -H "Content-Type: application/json" \
  -d '{"message":"Pinned note","client_meta":{"node_id":"695:313","node_offset":{"x":0,"y":0}}}' \
  "https://api.figma.com/v1/files/ABC123def456/comments"
```

- **Pinning:** include `client_meta` with `node_id` and a `node_offset` (`{x,y}` relative to the
  node). Figma requires `node_offset` whenever `node_id` is present — the script defaults it to
  `(0,0)`.
- **Replies:** add `comment_id` (the id of the comment you're replying to) to the body. The script's
  `--reply` flag does this. Replies form a thread under the original comment.

## Delete a comment

[`scripts/delete-comment.sh`](scripts/delete-comment.sh) removes a comment by id (find ids via
`get-comments.sh`):

```bash
./scripts/delete-comment.sh ABC123def456 123456789
```

Raw:

```bash
curl -s -X DELETE -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/ABC123def456/comments/123456789"
```

## Notes

- A `403` on post/delete means your PAT lacks **Comments: Read and write** — reissue the token.
- Deleting a parent comment removes its whole thread. Delete replies first if you only want to prune
  part of a conversation.
- A common workflow: detect design/code drift, then `post-comment.sh --node <id>` to leave an
  actionable note pinned to the offending element so designers see it in context.
