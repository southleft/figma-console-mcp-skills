# Token output formats

> **The conversion is implemented deterministically in [`scripts/convert-tokens.mjs`](../scripts/convert-tokens.mjs)** —
> run that, don't hand-write output. This doc explains *what* it emits (and the rules it follows) so
> you can review or extend it; it is not a spec to re-implement by hand.

`scripts/read-variables.js` returns this normalized shape:

```jsonc
{
  "collections": [{
    "id": "VariableCollectionId:1:2",
    "name": "Brand",
    "defaultModeId": "1:0",
    "modes": [{ "modeId": "1:0", "name": "Light" }, { "modeId": "1:1", "name": "Dark" }],
    "variables": [{
      "id": "VariableID:3:4",
      "key": "abc…",            // stable across renames (published vars)
      "name": "Color/Brand/Primary",
      "type": "COLOR",          // COLOR | FLOAT | STRING | BOOLEAN
      "description": "",
      "scopes": ["FRAME_FILL", "SHAPE_FILL"],
      "codeSyntax": { "WEB": "--color-brand-primary" },
      "valuesByMode": {
        "Light": "#2D6CDFFF",
        "Dark":  "#5B8FF0FF",
        // alias example: { "reference": "{Color.Brand.500}" }
      }
    }]
  }]
}
```

Convert it to the requested format. Variable `name` uses `/` for group nesting (`Color/Brand/Primary`
→ groups `color` → `brand` → token `primary`).

## DTCG (canonical, round-trip safe) — `*.tokens.json`

DTCG (W3C Design Tokens Community Group, https://tr.designtokens.org/format/) is the canonical format
— every other format derives from it. Rules:

- Nest groups by splitting `name` on `/`. Leaf token: `{ "$value": …, "$type": … }`.
- `$type` map: `COLOR`→`color`, `FLOAT`→`number` (or `dimension` for sizing), `STRING`→`string`,
  `BOOLEAN`→`boolean`.
- **Aliases**: emit the reference verbatim — `{ "$value": "{Color.Brand.500}" }`.
- **Round-trip metadata** — stash Figma identity so re-import matches instead of duplicating:
  ```jsonc
  "$extensions": { "figma-console-mcp": { "variableId": "VariableID:3:4", "key": "abc…" } }
  ```
  Also stamp the document root with `{ "figma-console-mcp": { "figmaFileKey": "…", "exportedAt": "…" } }`.
- **Multi-mode** — DTCG v1 has no native modes. Two supported layouts:
  - *Split by mode* (recommended, what Style Dictionary v4 / Tokens Studio do): one file per mode,
    e.g. `brand.light.tokens.json`, `brand.dark.tokens.json`.
  - *Single file*: pick the default mode as `$value`, stash the rest under
    `"$extensions": { "figma-console-mcp": { "modes": { "Dark": "…" } } }`.
- Sort keys (`$`-prefixed first, then alphabetical) for stable git diffs.

## CSS custom properties — `*.css`

```css
:root {
  --color-brand-primary: #2d6cdf;   /* slug the name: lowercase, "/" and spaces → "-" */
}
[data-theme="dark"] {                /* one selector block per non-default mode */
  --color-brand-primary: #5b8ff0;
}
```
Aliases become `var(--…)`: `{Color.Brand.500}` → `var(--color-brand-500)`.

## Tailwind v4 — `*.css` (`@theme`)

```css
@theme {
  --color-brand-primary: #2d6cdf;
  --spacing-4: 1rem;        /* FLOAT px → rem (÷16) for spacing scopes */
}
```

## Tailwind v3 — `tailwind.config.js` fragment

Group under `theme.extend` by type: colors → `colors`, FLOAT spacing → `spacing`, etc. Nest by the
name path (`colors.brand.primary`).

## SCSS — `*.scss`

```scss
$color-brand-primary: #2d6cdf;
$color-brand-primary-dark: #5b8ff0;   // suffix non-default modes
```

## TypeScript module — `*.ts`

```ts
export const tokens = {
  color: { brand: { primary: '#2d6cdf' } },
  spacing: { 4: '1rem' },
} as const;
```

## JSON (flat / nested)

- **flat**: `{ "color.brand.primary": "#2d6cdf" }`
- **nested**: plain nested objects without DTCG `$value` wrappers.

## Color format options

Default hex. If asked for `oklch`/`hsl`/`rgba`, convert from the hex/`{r,g,b,a}`. Preserve alpha.

## Writing the file

If the user gave an output path, write the file(s) there. Otherwise return the content inline. For
split-by-mode/collection, write one file per slice and report all paths.
