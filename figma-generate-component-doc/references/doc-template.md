# Component doc template — section layout & rules

Assemble the Markdown from the data returned by `scripts/collect-component-data.js`. Use the section
order below. Omit any section with no data (don't emit empty headers).

## Optional YAML frontmatter (only if requested)

```yaml
---
title: <componentName>
status: <stable|beta|experimental|deprecated>   # infer from description keywords if present
figma: <figma file URL>
tags: [component, <domain>]
---
```

## 1. Overview

```
# <componentName>

**[Open in Figma](<fileUrl>)**[ | **[View Source](<filePath>)**][ | **[Storybook](<storiesPath>)**]

## Overview

<overview text — first paragraph of the description, or "The <name> component.">

[Built on <baseComponent>, <baseComponent description>.]   # only if code parity supplied

### When to Use
- <bullet>            # parsed from a "When to Use" section in the description

### When NOT to Use
- <bullet>            # parsed from a "When NOT to Use" / "Don't Use" section
```

Parse the description for these headers (case-insensitive, markdown or plain): `When to Use`,
`When NOT to Use` / `Don't Use` / `Do Not Use`, `Accessibility`, `Content`/`Writing`/`Copy Guidelines`.
Everything before the first recognized header is the overview.

## 2. Anatomy

Render the `anatomyTree` string inside a fenced block:

````
## Anatomy

```
Button — horizontal auto-layout, gap: 8px
├── Icon (INSTANCE)
└── Label (TEXT)
```
````

## 3. Variants & States

Build from `componentProperties`. **Apply `cleanVariantName`** to raw variant names (see rule below).

```
## Variants

### Variant Matrix
| Variant | Background | Icon | Text/Icon Color |
| ------- | ---------- | ---- | --------------- |
| Primary / lg | `#2D6BE0` | check | `#FFFFFF` |

### Boolean Properties
- **Show Left Icon** — default: `true`

### Text Properties
- **Label** — default: `"Button"`
```

Columns are driven by available data: include **Icon** only if any variant has icons; include
**Background** / **Text/Icon Color** only if those colors exist. Use the bound `variableName` instead
of the raw hex when present (e.g. `color/brand/primary` rather than `#2D6BE0`).

## 4. Tokens

List `spacingTokens` and the colors collected per variant. Prefer the bound token name; flag any value
with no `variableName` as a hardcoded value to replace with a token.

```
## Tokens

### Spacing
| Property | Value | Token |
| -------- | ----- | ----- |
| Padding left | 16px | space/4 |
| Gap | 8px | space/2 |
| Border radius | 8px | radius/md |

### Color
| Role | Value | Token |
| ---- | ----- | ----- |
| Background | `#2D6BE0` | color/brand/primary |
| Border | `#1B4DB0` | _hardcoded — add token_ |
```

## 5. Typography

From `typography`:

```
## Typography
| Layer | Font | Style | Size | Line height |
| ----- | ---- | ----- | ---- | ----------- |
| Label | Inter | SemiBold | 16px | 24px |
```

## 6. Content Guidelines

From the parsed `Content`/`Writing`/`Copy Guidelines` description sections — render each heading as a
`###` subsection with its bullets.

## 7. Accessibility

Combine: accessibility bullets parsed from the description, plus any annotations whose label mentions
accessibility/aria/keyboard/focus, plus state-coverage notes (does the component have focus / disabled
/ error variants?). If code-parity data is supplied, surface a11y discrepancies here.

```
## Accessibility
- Keyboard: Enter/Space activates (from annotation)
- Has focus, disabled, and error variants
- Contrast: text on background meets WCAG AA
```

## 8. Design-Code Parity (optional — only with code data)

A short table of properties that differ between the Figma node and the supplied code spec
(background color, border, spacing, typography, prop/variant coverage), each with design value, code
value, and a suggested fix.

---

## The `cleanVariantName` rule

Figma variant names look like `Type=Image, Size=12` or `State=Hover, Variant=Primary`. Convert each
`Key=Value` pair to just its value, joined by ` / `:

```js
function cleanVariantName(rawName) {
  const pairs = rawName.match(/(\w[\w\s]*)=([^,]+)/g);
  if (!pairs) return rawName;
  return pairs.map((p) => p.slice(p.indexOf('=') + 1).trim()).join(' / ');
}
// "Type=Image, Size=12"            -> "Image / 12"
// "State=Hover, Variant=Primary"   -> "Hover / Primary"
```

Use cleaned names in the variant matrix and anywhere a variant is referenced by name.
