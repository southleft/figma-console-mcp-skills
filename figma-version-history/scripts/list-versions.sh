#!/usr/bin/env bash
#
# list-versions.sh — list a Figma file's version history (newest-first).
#
# Usage:
#   ./list-versions.sh <FILE_KEY_OR_URL> [--autosaves] [--max N]
#
# Env:
#   FIGMA_TOKEN   required — a Figma personal access token with "File versions: Read".
#                 See ../../references/rest-api-setup.md.
#
# Output: tab-separated  version_id <TAB> created_at <TAB> author <TAB> label
# By default unlabeled auto-saves are filtered out; pass --autosaves to keep them.
#
# Pagination: Figma's version list is newest-first and cursor-style. `after=<version_id>`
# returns versions OLDER in time, so we page by passing the last id we received as `after`.

set -euo pipefail

if [ -z "${FIGMA_TOKEN:-}" ]; then
  echo "ERROR: FIGMA_TOKEN is not set. See ../../references/rest-api-setup.md" >&2
  exit 1
fi

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <FILE_KEY_OR_URL> [--autosaves] [--max N]" >&2
  exit 1
fi

# Accept either a bare file key or a full Figma URL.
RAW="$1"; shift
FILE_KEY=$(echo "$RAW" | sed -E 's#.*/(design|file)/([A-Za-z0-9]+).*#\2#')

INCLUDE_AUTOSAVES=0
MAX=200
while [ "$#" -gt 0 ]; do
  case "$1" in
    --autosaves) INCLUDE_AUTOSAVES=1; shift ;;
    --max) MAX="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

API="https://api.figma.com/v1/files/${FILE_KEY}/versions"
PAGE_SIZE=50
CURSOR=""
COUNT=0
PAGES=0

printf 'version_id\tcreated_at\tauthor\tlabel\n'

while [ "$PAGES" -lt 20 ] && [ "$COUNT" -lt "$MAX" ]; do
  URL="${API}?page_size=${PAGE_SIZE}"
  if [ -n "$CURSOR" ]; then
    URL="${URL}&after=${CURSOR}"
  fi

  RESP=$(curl -s -H "X-Figma-Token: $FIGMA_TOKEN" "$URL")
  PAGES=$((PAGES + 1))

  # Surface API errors instead of silently printing nothing.
  ERR=$(printf '%s' "$RESP" | jq -r '.status // empty')
  if [ -n "$ERR" ]; then
    echo "API error ${ERR}: $(printf '%s' "$RESP" | jq -r '.err // .message // "unknown"')" >&2
    [ "$ERR" = "403" ] && echo "Hint: your PAT needs the 'File versions: Read' scope." >&2
    exit 1
  fi

  N=$(printf '%s' "$RESP" | jq '.versions | length')
  if [ "$N" -eq 0 ]; then
    break
  fi

  # Filter + format this page. Keep only labeled versions unless --autosaves.
  printf '%s' "$RESP" | jq -r --argjson auto "$INCLUDE_AUTOSAVES" '
    .versions[]
    | select($auto == 1 or (.label != null and .label != ""))
    | [.id, .created_at, (.user.handle // "?"), (.label // "")]
    | @tsv'

  ADDED=$(printf '%s' "$RESP" | jq -r --argjson auto "$INCLUDE_AUTOSAVES" '
    [.versions[] | select($auto == 1 or (.label != null and .label != ""))] | length')
  COUNT=$((COUNT + ADDED))

  # Advance cursor to the last (oldest) id on this page.
  LAST=$(printf '%s' "$RESP" | jq -r '.versions[-1].id')
  # Stop if Figma reports no next page, or the cursor didn't advance.
  HAS_NEXT=$(printf '%s' "$RESP" | jq -r '.pagination.next_page // empty')
  if [ -z "$HAS_NEXT" ] || [ "$LAST" = "$CURSOR" ]; then
    break
  fi
  CURSOR="$LAST"
done
