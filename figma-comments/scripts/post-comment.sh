#!/usr/bin/env bash
#
# post-comment.sh — post a comment on a Figma file (top-level, node-pinned, or reply).
#
# Usage:
#   ./post-comment.sh <FILE_KEY_OR_URL> "<message>" [--node <NODE_ID> [--x N] [--y N]] [--reply <COMMENT_ID>]
#
# Env:
#   FIGMA_TOKEN   required — PAT with "Comments: Read and write".
#                 See ../../references/rest-api-setup.md.
#
# Pinning: pass --node to pin to an element. node_offset (x,y) defaults to (0,0).
# Reply:   pass --reply <comment_id> to thread under an existing comment.

set -euo pipefail

if [ -z "${FIGMA_TOKEN:-}" ]; then
  echo "ERROR: FIGMA_TOKEN is not set. See ../../references/rest-api-setup.md" >&2
  exit 1
fi

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <FILE_KEY_OR_URL> \"<message>\" [--node <NODE_ID> [--x N] [--y N]] [--reply <COMMENT_ID>]" >&2
  exit 1
fi

RAW="$1"; shift
FILE_KEY=$(echo "$RAW" | sed -E 's#.*/(design|file)/([A-Za-z0-9]+).*#\2#')
MESSAGE="$1"; shift

NODE_ID=""
X=0
Y=0
REPLY_TO=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --node) NODE_ID="$2"; shift 2 ;;
    --x) X="$2"; shift 2 ;;
    --y) Y="$2"; shift 2 ;;
    --reply) REPLY_TO="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

# Build the JSON body with jq so message/ids are safely escaped.
BODY=$(jq -n \
  --arg message "$MESSAGE" \
  --arg node "$NODE_ID" \
  --argjson x "$X" \
  --argjson y "$Y" \
  --arg reply "$REPLY_TO" '
  { message: $message }
  + (if $node != "" then { client_meta: { node_id: $node, node_offset: { x: $x, y: $y } } } else {} end)
  + (if $reply != "" then { comment_id: $reply } else {} end)
')

RESP=$(curl -s -X POST \
  -H "X-Figma-Token: $FIGMA_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  "https://api.figma.com/v1/files/${FILE_KEY}/comments")

ERR=$(printf '%s' "$RESP" | jq -r '.status // empty')
if [ -n "$ERR" ]; then
  echo "API error ${ERR}: $(printf '%s' "$RESP" | jq -r '.err // .message // "unknown"')" >&2
  [ "$ERR" = "403" ] && echo "Hint: your PAT needs 'Comments: Read and write'." >&2
  exit 1
fi

printf '%s' "$RESP" | jq '{ success: true, comment: { id, message, created_at, author: (.user.handle // null), order_id, client_meta } }'
