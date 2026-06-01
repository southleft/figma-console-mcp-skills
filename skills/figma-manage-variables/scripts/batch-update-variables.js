// figma-manage-variables — batch update many variable values in one call (10–50× faster than loops).
// Run via `use_figma` (skillNames: "figma-manage-variables"). Edit UPDATES below.
// See the official figma-use skill.

// Each entry: variableId + modeId + value. COLOR accepts hex; others are literals;
// a "VariableID:…" string value aliases this variable to another (resolved via the API).
// Get variableId/modeId from figma-export-tokens' read script or get_variable_defs.
const UPDATES = [
  { variableId: 'VariableID:3:4', modeId: '1:0', value: '#2D6CDF' },
  { variableId: 'VariableID:3:5', modeId: '1:1', value: 16 },
];

function hexToRgb(hex) {
  let s = String(hex).trim().replace(/^#/, '');
  if (![3, 4, 6, 8].includes(s.length) || /[^0-9a-fA-F]/.test(s)) {
    throw new Error('Invalid hex color: ' + JSON.stringify(hex)); // fail loud, never write NaN
  }
  if (s.length === 3 || s.length === 4) s = s.split('').map((c) => c + c).join('');
  return {
    r: parseInt(s.substring(0, 2), 16) / 255,
    g: parseInt(s.substring(2, 4), 16) / 255,
    b: parseInt(s.substring(4, 6), 16) / 255,
    a: s.length === 8 ? parseInt(s.substring(6, 8), 16) / 255 : 1,
  };
}

const updated = [], errors = [];
for (const u of UPDATES) {
  try {
    const v = await figma.variables.getVariableByIdAsync(u.variableId);
    if (!v) { errors.push({ ...u, error: 'variable not found' }); continue; }
    let value;
    if (typeof u.value === 'string' && u.value.startsWith('VariableID:')) {
      // alias: bind this variable to another (matches Console MCP UPDATE_VARIABLE alias handling)
      const target = await figma.variables.getVariableByIdAsync(u.value);
      if (!target) { errors.push({ ...u, error: 'alias target not found: ' + u.value }); continue; }
      value = figma.variables.createVariableAlias(target);
    } else {
      value = v.resolvedType === 'COLOR' && typeof u.value === 'string' ? hexToRgb(u.value) : u.value;
    }
    v.setValueForMode(u.modeId, value);
    updated.push({ id: v.id, name: v.name, modeId: u.modeId });
  } catch (e) {
    errors.push({ ...u, error: String(e && e.message || e) });
  }
}
return { updatedCount: updated.length, updated, errors };
