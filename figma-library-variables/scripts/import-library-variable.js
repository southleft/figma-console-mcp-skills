// figma-library-variables — import a library variable into the current file by key.
// Run via `use_figma` (skillNames: "figma-library-variables"). Idempotent: re-importing
// returns the same local id. Use the key from list-library-variables.js.
// See the official figma-use skill.

const VARIABLE_KEYS = [
  'paste_variable_key_here',
  // add more keys to import several at once
];

const imported = [], errors = [];
for (const key of VARIABLE_KEYS) {
  try {
    const v = await figma.variables.importVariableByKeyAsync(key);
    imported.push({ key, localId: v.id, name: v.name, type: v.resolvedType });
  } catch (e) {
    errors.push({ key, error: String(e && e.message || e) });
  }
}
// The returned localId works with every binding/update tool just like a local variable.
return { imported, errors };
