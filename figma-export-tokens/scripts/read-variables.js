// figma-export-tokens — read all local variables on ANY Figma plan.
//
// Run via the native Figma MCP `use_figma` tool (pass skillNames: "figma-export-tokens").
// Returns a normalized JSON tree the agent converts to DTCG / CSS / Tailwind / SCSS / TS.
// Uses the Plugin API (works on Starter/Pro/Org/Enterprise) — NOT the Enterprise-only
// Variables REST API. See ../../references/use-figma-conventions.md.

const collections = await figma.variables.getLocalVariableCollectionsAsync();

// First pass: id -> variable name, so we can render aliases as DTCG references.
const idToName = {};
for (const col of collections) {
  for (const vid of col.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(vid);
    if (v) idToName[v.id] = v.name; // Figma names use "/" group separators
  }
}

// Figma stores colors as {r,g,b,a} 0–1. Emit hex (8-digit when alpha < 1).
function colorToHex(c) {
  const to255 = (n) => Math.round((n || 0) * 255);
  const hh = (n) => to255(n).toString(16).padStart(2, '0');
  const base = '#' + hh(c.r) + hh(c.g) + hh(c.b);
  return (c.a === undefined || c.a >= 1) ? base : base + hh(c.a);
}

// "{Color.Brand.Primary}" DTCG-style reference from a Figma "Color/Brand/Primary" name.
function toReference(targetId) {
  const name = idToName[targetId];
  if (!name) return { alias: targetId };
  return { reference: '{' + name.split('/').join('.') + '}' };
}

function encodeValue(raw, type) {
  if (raw && typeof raw === 'object' && raw.type === 'VARIABLE_ALIAS') {
    return toReference(raw.id);
  }
  if (type === 'COLOR' && raw && typeof raw === 'object') return colorToHex(raw);
  return raw; // FLOAT | STRING | BOOLEAN literal
}

const out = [];
for (const col of collections) {
  const modes = col.modes.map((m) => ({ modeId: m.modeId, name: m.name }));
  const variables = [];
  for (const vid of col.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(vid);
    if (!v) continue;
    const valuesByMode = {};
    for (const m of col.modes) {
      valuesByMode[m.name] = encodeValue(v.valuesByMode[m.modeId], v.resolvedType);
    }
    variables.push({
      id: v.id,            // stash in $extensions["figma-console-mcp"].variableId for round-trip
      key: v.key || null,  // stable across renames; published variables only
      name: v.name,        // "/" = group nesting
      type: v.resolvedType,
      description: v.description || '',
      scopes: v.scopes,
      codeSyntax: v.codeSyntax || {},
      valuesByMode,
    });
  }
  out.push({
    id: col.id,
    name: col.name,
    defaultModeId: col.defaultModeId,
    modes,
    variables,
  });
}

return {
  collections: out,
  summary: {
    collectionCount: out.length,
    variableCount: out.reduce((n, c) => n + c.variables.length, 0),
  },
};
