# Variable operations — copy-paste `use_figma` snippets

Each snippet is a complete `use_figma` script (plain JS, top-level `await`, `return`). Edit the
constants, run, and check the returned IDs. Pass `skillNames: "figma-manage-variables"`.
See [use-figma-conventions.md](../../../references/use-figma-conventions.md) for the `hexToRgb` helper.

## Create a collection (with modes)

```js
const c = figma.variables.createVariableCollection('Brand');
c.renameMode(c.modes[0].modeId, 'Light');
const darkId = c.addMode('Dark');
return { collectionId: c.id, modes: { Light: c.modes[0].modeId, Dark: darkId } };
```

## Create a single variable

```js
const c = (await figma.variables.getLocalVariableCollectionsAsync()).find(x => x.name === 'Brand');
const v = figma.variables.createVariable('Color/Brand/Primary', c, 'COLOR'); // COLOR|FLOAT|STRING|BOOLEAN
v.setValueForMode(c.defaultModeId, { r: 0.18, g: 0.42, b: 0.87, a: 1 }); // 0–1 range
v.scopes = ['FRAME_FILL', 'SHAPE_FILL'];        // avoid the default ALL_SCOPES
v.setVariableCodeSyntax('WEB', '--color-brand-primary');
return { variableId: v.id, name: v.name };
```

## Batch create variables

```js
const c = (await figma.variables.getLocalVariableCollectionsAsync()).find(x => x.name === 'Brand');
const defs = [
  { name: 'Color/Text/Default', type: 'COLOR', value: '#111111' },
  { name: 'Space/2', type: 'FLOAT', value: 8 },
];
function hexToRgb(hex){hex=String(hex).replace('#','');if(hex.length===3)hex=hex.split('').map(x=>x+x).join('');return{r:parseInt(hex.substr(0,2),16)/255,g:parseInt(hex.substr(2,2),16)/255,b:parseInt(hex.substr(4,2),16)/255,a:hex.length===8?parseInt(hex.substr(6,2),16)/255:1};}
const created = [];
for (const d of defs) {
  const v = figma.variables.createVariable(d.name, c, d.type);
  v.setValueForMode(c.defaultModeId, d.type === 'COLOR' ? hexToRgb(d.value) : d.value);
  created.push({ id: v.id, name: v.name });
}
return { created };
```

## Batch update values

See [scripts/batch-update-variables.js](../scripts/batch-update-variables.js).

## Rename a variable (preserves values + bindings)

```js
const v = await figma.variables.getVariableByIdAsync('VariableID:3:4');
const old = v.name; v.name = 'Color/Brand/500';
return { id: v.id, from: old, to: v.name };
```

## Set scopes (which property pickers a variable appears in)

```js
const v = await figma.variables.getVariableByIdAsync('VariableID:3:4');
v.scopes = ['TEXT_FILL']; // FRAME_FILL, SHAPE_FILL, STROKE_COLOR, GAP, CORNER_RADIUS, WIDTH_HEIGHT, FONT_SIZE, ...
return { id: v.id, scopes: v.scopes };
```

## Add / rename a mode

```js
const c = (await figma.variables.getLocalVariableCollectionsAsync()).find(x => x.name === 'Brand');
const hcId = c.addMode('High Contrast');          // add
c.renameMode(c.modes[1].modeId, 'Dark (v2)');     // rename
return { modes: c.modes.map(m => ({ id: m.modeId, name: m.name })) };
```

## Delete a variable / collection (destructive — confirm first)

```js
const v = await figma.variables.getVariableByIdAsync('VariableID:3:4');
const name = v && v.name; if (v) v.remove();
return { removed: name || null };
```

```js
const c = (await figma.variables.getLocalVariableCollectionsAsync()).find(x => x.name === 'Brand');
if (c) c.remove(); // removes the collection AND all its variables
return { removed: c ? 'Brand' : null };
```
