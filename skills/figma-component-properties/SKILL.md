---
name: figma-component-properties
description: "Add, edit, and delete Figma component properties (TEXT, BOOLEAN, INSTANCE_SWAP, VARIANT) on a COMPONENT or COMPONENT_SET, and instantiate a component then set its instance properties. Use when authoring or wiring up a component's API in Figma — triggers: 'add a component property', 'add a boolean prop to this component', 'make this text a component property', 'add an instance-swap slot', 'create a variant property', 'rename/delete a component property', 'place an instance of this component', 'instantiate this component and set its label/state', 'set properties on this instance'. Properties must be added to the parent COMPONENT_SET, not individual variants. NOT covered by the native MCP's read-only get_design_context/get_metadata."
disable-model-invocation: false
---

# figma-component-properties — define a component's API + instantiate it

Two related jobs:
1. **Author the component's property API** — add/edit/delete `TEXT`, `BOOLEAN`, `INSTANCE_SWAP`, and
   `VARIANT` properties so the component exposes the right knobs (the Figma equivalent of a React
   component's props).
2. **Use the component** — create an instance and set its properties (label text, boolean toggles,
   variant selection, swapped sub-instances).

## Skill boundaries
- **`use_figma` rules** — load the official **`figma-use`** skill first; it is the full Figma Plugin API reference. Essentials these scripts rely on: plain JS with top-level `await` + `return` (no IIFE, no `figma.closePlugin()`; `console.log` is not returned), inputs inlined as `const` at the top of each script, colors in 0–1 range, load fonts before any text op, `await figma.getNodeByIdAsync(...)`, and **atomic errors** (a failed script applies nothing — read the error, fix, retry).
- **Reading a component's existing property definitions / state machine** →
  use `figma-analyze-component-set` or `figma-deep-component`.
- These are **design-system authoring writes** the native MCP's `get_design_context` /
  `get_metadata` (read-only) do not cover.

## Property types

| Type | What it controls | `defaultValue` | Notes |
| --- | --- | --- | --- |
| `TEXT` | A text-layer string override | `"Label"` | Bind in UI to a text node's characters |
| `BOOLEAN` | Show/hide a layer | `true`/`false` | Bind to a layer's visibility |
| `INSTANCE_SWAP` | Which sub-component fills a slot | a component **key** | Pass `preferredValues` to populate the picker |
| `VARIANT` | A variant axis (Size, State…) | one option string | Only meaningful on a `COMPONENT_SET` |

## Workflow — authoring properties

1. **Target the COMPONENT_SET (or standalone COMPONENT).** You **cannot** add properties to an
   individual variant — the script errors and tells you to use the parent set.
2. **Add** with [`scripts/add-property.js`](scripts/add-property.js) (`use_figma`,
   `skillNames: "figma-component-properties"`). Set `NODE_ID`, `PROPERTY_NAME`, `PROPERTY_TYPE`,
   `DEFAULT_VALUE`. `addComponentProperty` returns a name with a `#id` suffix — capture it.
3. **Edit / delete** by reusing the same script's `editComponentProperty(name, {...})` /
   `deleteComponentProperty(name)` calls (commented variants are in the script). Use the **suffixed**
   name returned at creation for edits/deletes of non-variant props.
4. **Verify** by re-reading `node.componentPropertyDefinitions` (the script returns it).

## Workflow — instantiate + set instance properties

1. **Get a component identity.** A published library `componentKey` (preferred) and/or a local
   `nodeId`. Pass **both** when you have them — the script tries the library import first, then the
   local node.
2. **Run** [`scripts/instantiate-and-set.js`](scripts/instantiate-and-set.js). Set `COMPONENT_KEY` /
   `COMPONENT_ID`, optional `VARIANT` (e.g. `{ Size: "md", State: "default" }`), `OVERRIDES`,
   `POSITION`, and `PARENT_ID`.
3. **Set properties on an existing instance** with the same script's `setProperties` path — it loads
   the main component, then matches plain names *and* `Name#id`-suffixed names automatically.

## Notes
- **Instance property keys carry `#nodeId` suffixes** for TEXT/BOOLEAN/INSTANCE_SWAP
  (`"Label#12:3"`); VARIANT props use the bare name. The instantiate script resolves both, so you can
  pass the human name (`Label`) and it finds the suffixed key.
- **Direct text editing of an instance's text layer fails silently** — always go through
  `setProperties` / instance properties, never set `.characters` on a nested instance text node.
- `componentKey` only works for **published** components. For local/unpublished ones use `nodeId`.
