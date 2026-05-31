// figma-library-variables — discover variables available from SUBSCRIBED team libraries.
// Run via `use_figma` (skillNames: "figma-library-variables"). Optional name filters below.
// Returns library collections + their variables (keys you can import). See
// the official figma-use skill.

// ── optional filters (leave '' for all) ──
const LIBRARY_NAME = '';     // partial match on collection's library
const COLLECTION_NAME = '';  // partial match on collection name
const TYPE = '';             // '', 'COLOR', 'FLOAT', 'STRING', 'BOOLEAN'
// ─────────────────────────────────────────

const cols = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
const out = [];
for (const col of cols) {
  if (COLLECTION_NAME && !col.name.toLowerCase().includes(COLLECTION_NAME.toLowerCase())) continue;
  if (LIBRARY_NAME && col.libraryName && !col.libraryName.toLowerCase().includes(LIBRARY_NAME.toLowerCase())) continue;
  let vars = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(col.key);
  if (TYPE) vars = vars.filter((v) => v.resolvedType === TYPE);
  out.push({
    collectionKey: col.key,
    collectionName: col.name,
    libraryName: col.libraryName || null,
    variables: vars.map((v) => ({ key: v.key, name: v.name, type: v.resolvedType })),
  });
}
return {
  collections: out,
  summary: {
    collectionCount: out.length,
    variableCount: out.reduce((n, c) => n + c.variables.length, 0),
  },
};
