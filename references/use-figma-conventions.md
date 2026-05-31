# `use_figma` conventions (reference)

> **You do NOT need to load this file to use the skills.** Every skill is self-contained — each
> `SKILL.md` already inlines these rules and points to the official `figma-use` skill (the canonical
> Plugin API reference). This doc is optional background for readers and contributors; uploading a
> single skill folder works without it.

Every Plugin-API skill in this collection runs its JavaScript through the **native Figma MCP
`use_figma` tool**. That tool has a specific execution model that differs from a normal Figma
plugin. Read this once; every `scripts/*.js` file in these skills already follows it.

> **Prerequisite:** Always load the official **`figma-use`** skill before calling `use_figma`. It is
> the source of truth for the Plugin API surface. These skills add domain workflows on top of it;
> they do not replace it.

## The execution model

1. **Write plain JavaScript with top-level `await` and `return`.** Your code is automatically wrapped
   in an async context. Do **NOT** wrap it in `(async () => { ... })()` and do **NOT** call
   `figma.closePlugin()`.
2. **Return data with `return`.** The return value is JSON-serialized automatically. `console.log()`
   output is **not** returned.
3. **Always `return` every created/mutated node ID** so later calls can reference, validate, or undo.
4. **Inputs are inlined.** These scripts declare their inputs as `const` at the top (e.g.
   `const COLLECTION_NAME = "Brand";`). Edit those constants before running — there is no `msg.*`
   parameter object (that pattern only exists inside a packaged plugin).
5. **Colors are 0–1 range**, not 0–255: `{ r: 1, g: 0, b: 0 }` is red. Use the `hexToRgb` helper below.
6. **Fonts must be loaded before any text operation:** `await figma.loadFontAsync({ family, style })`.
7. **Page context resets between calls.** `figma.currentPage` starts on the first page each call. Use
   `await figma.setCurrentPageAsync(page)` to switch — the sync setter throws in `use_figma`.
8. **Use async getters:** `await figma.getNodeByIdAsync(id)`, `await figma.variables.getLocalVariablesAsync()`,
   etc. `await` every Promise — unawaited async calls fire-and-forget and fail silently.
9. **`figma.notify()` throws** — never use it.
10. **On error, STOP and read it.** Failed scripts are atomic — nothing is applied. Fix, then retry.
11. **Pass `skillNames` when calling `use_figma`** (e.g. `skillNames: "figma-export-tokens"`). It is a
    logging parameter and does not affect execution.

## Shared `hexToRgb` helper

Figma fills/strokes/variable color values use 0–1 floats. Paste this at the top of any script that
takes hex colors:

```js
function hexToRgb(hex) {
  hex = String(hex).replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  const a = hex.length === 8 ? parseInt(hex.substring(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}
```

For a `SOLID` paint: `{ type: 'SOLID', color: { r, g, b }, opacity: a }`.
For a variable `COLOR` value via `setValueForMode`: pass `{ r, g, b, a }` (alpha included).

## Reading variables on ANY plan (bridge-first)

Figma's Variables **REST** API (`/v1/files/:key/variables/local`) is **Enterprise-only** and returns
`403` for Starter/Pro/Org. The **Plugin API** `figma.variables.getLocalVariablesAsync()` works on
**every** plan. Because `use_figma` runs in the file context, the token/variable skills here always
read through the Plugin API — so they work regardless of plan. This is the single biggest reason to
prefer these skills over a raw REST call for variables.

## Plugin API gotchas (verified against real files)

These bit us during live testing — every shipped script already guards against them, but keep them in
mind when adapting a script:

- **Many property getters THROW on node types that lack them — not just `.children`.** Accessing a
  property a node type doesn't define throws a `TypeError` (it does **not** return `undefined`), and
  `(node.fills || [])` does **not** save you (the throw happens before `||`). Confirmed throwers when
  read on the wrong node type (e.g. TEXT/leaf): `children`, `layoutMode`, `itemSpacing`,
  `paddingLeft/Right/Top/Bottom`, `primaryAxisSizingMode`, `counterAxisSizingMode`,
  `layoutSizingHorizontal/Vertical`, `primaryAxisAlignItems`, `counterAxisAlignItems`, `layoutWrap`,
  `min/maxWidth`, `min/maxHeight`, `clipsContent`, `fills`, `strokes`, `strokeWeight`, `cornerRadius`,
  `effects`. **In any code that walks arbitrary/recursive nodes**, guard each such access with
  `"prop" in node`, wrap it in `try/catch`, or short-circuit on a container/shape **type check first**
  (`if (node.type === 'FRAME' && node.children) …`). Reading these on a node already known to be a
  COMPONENT/FRAME is safe.
- **`figma.loadAllPagesAsync()` is NOT supported in `use_figma`** (it works in a packaged plugin /
  the Console MCP bridge, but throws here). Consequently `figma.root.findAllWithCriteria(...)` —
  which requires all pages loaded — also fails. To enumerate components/nodes across pages, load each
  page incrementally and scan it: `for (const page of figma.root.children) { await figma.setCurrentPageAsync(page); page.findAllWithCriteria({ types: ['COMPONENT_SET'] }); }` (capture and restore the original `figma.currentPage` afterward to be polite).
- **`AnnotationCategory` exposes `.label`, not `.name`** — reading `category.name` returns `undefined`
  and leaks the raw category id where a human-readable label was expected.
- **Alias / bound-variable targets can live outside the enumerated set.** Neither
  `getLocalVariableCollectionsAsync()` nor `getLocalVariablesAsync()` is guaranteed to return every
  variable an alias points at — orphaned/hidden collections remain referenceable. If you resolve a
  `VARIABLE_ALIAS` (or a node's `boundVariables`) by looking it up in a prebuilt name map, fall back
  to a direct `await figma.variables.getVariableByIdAsync(id)` for any id you didn't index, or you'll
  leak raw `VariableID:…` strings into your output.

## Returning large results

`use_figma` return values are serialized whole. For big design systems, page or summarize inside the
script (return counts + a slice) rather than dumping thousands of nodes in one call. Skills that read
a lot (inventory, deep component) include a `verbosity`/`depth` constant for exactly this reason.
