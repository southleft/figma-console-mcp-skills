# Annotation property types

When an annotation should pin specific design attributes, pass them in `properties` as
`[{ type: '<value>' }, …]`. The `type` string must be one of the values below — they are the exact
`AnnotationPropertyType` strings from the Figma Plugin API. An unrecognized string is rejected.

Pinning a property links the note to that attribute in Figma's UI; it does **not** change the value.

## Valid `type` values

### Sizing
- `width`
- `height`
- `maxWidth`
- `minWidth`
- `maxHeight`
- `minHeight`

### Appearance
- `fills`
- `strokes`
- `effects`
- `strokeWeight`
- `cornerRadius`
- `opacity`

### Typography
- `textStyleId`
- `textAlignHorizontal`
- `fontFamily`
- `fontStyle`
- `fontSize`
- `fontWeight`
- `lineHeight`
- `letterSpacing`

### Auto-layout
- `itemSpacing`
- `padding`
- `layoutMode`
- `alignItems`

### Component
- `mainComponent`

### Grid layout
- `gridRowGap`
- `gridColumnGap`
- `gridRowCount`
- `gridColumnCount`
- `gridRowAnchorIndex`
- `gridColumnAnchorIndex`
- `gridRowSpan`
- `gridColumnSpan`

## Annotation shape

```js
{
  label: 'Plain text note',                 // OR labelMarkdown (not both on write)
  labelMarkdown: '**Rich** note with `code`, [links](…), lists, headers',
  properties: [{ type: 'fills' }, { type: 'cornerRadius' }],
  categoryId: 'category-id-from-getAnnotationCategoriesAsync',
}
```

- Provide **either** `label` or `labelMarkdown`, not both — Figma rejects writing both.
- `labelMarkdown` supports bold, italic, links, lists, code, and headers.
- `categoryId` must be a real ID for the current file. List them with:
  ```js
  return (await figma.annotations.getAnnotationCategoriesAsync())
    .map(c => ({ id: c.id, label: c.label, color: c.color }));
  ```
