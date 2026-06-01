#!/usr/bin/env bash
#
# delete-comment.sh — delete a comment from a Figma file by id.
#
# Usage:
#   ./delete-comment.sh <FILE_KEY_OR_URL> <COMMENT_ID>
#
# Env:
#   FIGMA_TOKEN   required — PAT with "Comments: Read and write".
#                 See ../../references/rest-api-setup.md.
#
# Find comment ids with get-comments.sh. Deleting a parent comment removes its
# whole thread; delete replies first to prune only part of a conversation.

set -euo pipefail

if [ -z "${FIGMA_TOKEN:-}" ]; then
  echo "ERROR: FIGMA_TOKEN is not set. See ../../references/rest-api-setup.md" >&2
  exit 1
fi

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <FILE_KEY_OR_URL> <COMMENT_ID>" >&2
  exit 1
fi

RAW="$1"
FILE_KEY=$(echo "$RAW" | sed -E 's#.*/(design|file)/([A-Za-z0-9]+).*#\2#')
COMMENT_ID="$2"

# Capture HTTP status separately so we can report a clean success/failure.
HTTP_CODE=$(curl -s -o /tmp/figma-delete-comment-resp.json -w '%{http_code}' \
  -X DELETE \
  -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/${FILE_KEY}/comments/${COMMENT_ID}")

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "204" ]; then
  jq -n --arg id "$COMMENT_ID" '{ success: true, deleted_comment_id: $id }'
else
  echo "API error ${HTTP_CODE}: $(jq -r '.err // .message // "unknown"' /tmp/figma-delete-comment-resp.json 2>/dev/null)" >&2
  [ "$HTTP_CODE" = "403" ] && echo "Hint: your PAT needs 'Comments: Read and write'." >&2
  exit 1
fi
