# Figma REST API setup (shared reference)

A few skills in this collection — **figma-version-history**, **figma-generate-changelog**,
**figma-blame-node**, and **figma-comments** — read data that the Plugin API (and therefore
`use_figma`) cannot reach: file **version history** and **comments**. These live only in Figma's
**REST API**, so those skills call REST directly with a personal access token.

> The Plugin-API skills (tokens, variables, components, lint, a11y, annotations, FigJam, Slides) need
> **none** of this — skip straight to them if you don't need version history or comments.

## 1. Create a Figma personal access token (PAT)

1. In Figma: **Settings → Security → Personal access tokens → Generate new token**.
2. Grant scopes:
   - **File content** → *Read-only* (required for all four skills)
   - **Comments** → *Read and write* (only for `figma-comments` posting/deleting)
   - **File versions** → *Read-only* (for version history / changelog / blame)
3. Copy the token (`figd_…`). You only see it once.

## 2. Provide the token to your agent

Export it in the shell the agent runs commands in:

```bash
export FIGMA_TOKEN="figd_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

The skills call REST with the `X-Figma-Token` header, e.g.:

```bash
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/FILEKEY/versions"
```

## 3. Find the file key

The file key is the path segment after `/design/` or `/file/` in a Figma URL:

```
https://www.figma.com/design/ABC123def456/My-File   →   file key = ABC123def456
```

Most skills accept either the full URL or the bare key and extract it with:

```bash
echo "$FIGMA_URL" | sed -E 's#.*/(design|file)/([A-Za-z0-9]+).*#\2#'
```

## Rate limits & etiquette

- Figma REST is rate-limited per token. The `figma-blame-node` skill uses **binary search**
  (~log₂N requests) instead of walking every version for exactly this reason.
- Version snapshots are immutable — cache them locally if you diff repeatedly.
- Never commit your PAT. Treat it like a password; rotate if leaked.
