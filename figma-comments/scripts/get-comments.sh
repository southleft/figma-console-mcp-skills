#!/usr/bin/env bash
#
# get-comments.sh — list comments on a Figma file.
#
# Usage:
#   ./get-comments.sh <FILE_KEY_OR_URL> [--include-resolved] [--md]
#
# Env:
#   FIGMA_TOKEN   required — PAT with "File content: Read". See ../../references/rest-api-setup.md.
#
# By default resolved threads are filtered out. --md requests markdown message bodies (as_md=true).

set -euo pipefail

if [ -z "${FIGMA_TOKEN:-}" ]; then
  echo "ERROR: FIGMA_TOKEN is not set. See ../../references/rest-api-setup.md" >&2
  exit 1
fi

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <FILE_KEY_OR_URL> [--include-resolved] [--md]" >&2
  exit 1
fi

RAW="$1"; shift
FILE_KEY=$(echo "$RAW" | sed -E 's#.*/(design|file)/([A-Za-z0-9]+).*#\2#')

INCLUDE_RESOLVED=0
AS_MD=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --include-resolved) INCLUDE_RESOLVED=1; shift ;;
    --md) AS_MD=1; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

URL="https://api.figma.com/v1/files/${FILE_KEY}/comments"
if [ "$AS_MD" -eq 1 ]; then
  URL="${URL}?as_md=true"
fi

RESP=$(curl -s -H "X-Figma-Token: $FIGMA_TOKEN" "$URL")

# Surface API errors.
ERR=$(printf '%s' "$RESP" | jq -r '.status // empty')
if [ -n "$ERR" ]; then
  echo "API error ${ERR}: $(printf '%s' "$RESP" | jq -r '.err // .message // "unknown"')" >&2
  exit 1
fi

# Filter resolved unless requested, then summarize each thread.
printf '%s' "$RESP" | jq --argjson keepResolved "$INCLUDE_RESOLVED" '
  {
    comments: [
      .comments[]
      | select($keepResolved == 1 or (.resolved_at == null))
      | {
          id,
          parent_id: (.parent_id // null),
          author: (.user.handle // "?"),
          message,
          created_at,
          resolved_at,
          pinned_node: (.client_meta.node_id // null)
        }
    ],
    summary: {
      total: (.comments | length),
      active: ([.comments[] | select(.resolved_at == null)] | length),
      resolved: ([.comments[] | select(.resolved_at != null)] | length),
      returned: ([.comments[] | select($keepResolved == 1 or (.resolved_at == null))] | length)
    }
  }'
