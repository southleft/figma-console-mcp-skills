# `visualSpec` shape (design-system inventory)

Every component / variant in the inventory carries an optional `visualSpec` — a compact, CSS-oriented
summary of how that node looks. It only includes fields that have meaningful (non-default) data, so a
plain frame may have just `fills`, while a styled button has the full set. Colors are **hex**
(uppercase, alpha dropped); spacing/size values are **pixels**.

```jsonc
{
  "fills": [                       // background colors / gradients
    { "type": "SOLID", "color": "#3B82F6", "opacity": 1 }
  ],
  "strokes": [                     // borders
    { "type": "SOLID", "color": "#1D4ED8", "weight": 1, "align": "INSIDE" }
  ],
  "effects": [                     // shadows / blurs
    { "type": "DROP_SHADOW", "color": "#00000026", "offset": { "x": 0, "y": 1 }, "radius": 2, "spread": 0 }
  ],
  "cornerRadius": 8,               // → border-radius (omitted when 0 or mixed)
  "opacity": 0.5,                  // only present when < 1
  "layout": {                      // auto-layout → CSS flexbox
    "mode": "HORIZONTAL",          // HORIZONTAL | VERTICAL → flex-direction row|column
    "paddingTop": 12,
    "paddingRight": 16,
    "paddingBottom": 12,
    "paddingLeft": 16,
    "itemSpacing": 8,              // → gap
    "primaryAxisAlign": "CENTER",  // justify-content (along main axis)
    "counterAxisAlign": "CENTER"   // align-items (cross axis)
  },
  "typography": {                  // TEXT nodes only
    "fontFamily": "Inter",
    "fontStyle": "Semi Bold",
    "fontSize": 14,
    "fontWeight": 600,
    "lineHeight": { "unit": "PIXELS", "value": 20 },
    "letterSpacing": { "unit": "PERCENT", "value": 0 },
    "textAlignHorizontal": "CENTER"
  }
}
```

## Field → CSS mapping

| `visualSpec` field | CSS equivalent |
| --- | --- |
| `fills[].color` | `background-color` (or `background` for gradients) |
| `strokes[].color` + `weight` + `align` | `border-color` / `border-width`; `align` ≈ box-sizing nuance |
| `effects[]` (`DROP_SHADOW`) | `box-shadow: offset.x offset.y radius spread color` |
| `effects[]` (`*_BLUR`) | `backdrop-filter` / `filter: blur(radius)` |
| `cornerRadius` | `border-radius` |
| `opacity` | `opacity` |
| `layout.mode` | `display: flex; flex-direction: row|column` |
| `layout.padding*` | `padding-*` |
| `layout.itemSpacing` | `gap` |
| `layout.primaryAxisAlign` | `justify-content` |
| `layout.counterAxisAlign` | `align-items` |
| `typography.*` | `font-family` / `font-size` / `font-weight` / `line-height` / `letter-spacing` / `text-align` |

## Verbosity interaction

- `VERBOSITY: "full"` — every component/variant gets a `visualSpec`. Largest payload.
- `VERBOSITY: "summary"` — components keep `componentProps` and metadata but **omit** per-variant
  `visualSpec` (sets report a `variantCount` instead). Styles keep `resolvedValue` only in `full`.
- `VERBOSITY: "inventory"` — names, ids, and counts only; no specs, no values. Use for very large
  files just to see what exists, then re-run scoped with `COMPONENT_NAME_FILTER`.

For a single component in unlimited depth (full child tree, resolved bound variables, reactions,
instance references), use the `figma-deep-component` skill instead — its node shape is richer than
this flat `visualSpec`.
