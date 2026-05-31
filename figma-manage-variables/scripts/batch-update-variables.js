// figma-manage-variables — batch update many variable values in one call (10–50× faster than loops).
// Run via `use_figma` (skillNames: "figma-manage-variables"). Edit UPDATES below.
// See the official figma-use skill.

// Each entry: variableId + modeId + value. COLOR accepts hex; others are literals.
// Get variableId/modeId from figma-export-tokens' read script or get_variable_defs.
const UPDATES = [
  { variableId: 'VariableID:3:4', modeId: '1:0', value: '#2D6CDF' },
  { variableId: 'VariableID:3:5', modeId: '1:1', value: 16 },
];

function hexToRgb(hex) {
  hex = String(hex).replace('#', '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  return {
    r: parseInt(hex.substring(0, 2), 16) / 255,
    g: parseInt(hex.substring(2, 4), 16) / 255,
    b: parseInt(hex.substring(4, 6), 16) / 255,
    a: hex.length === 8 ? parseInt(hex.substring(6, 8), 16) / 255 : 1,
  };
}

const updated = [], errors = [];
for (const u of UPDATES) {
  try {
    const v = await figma.variables.getVariableByIdAsync(u.variableId);
    if (!v) { errors.push({ ...u, error: 'variable not found' }); continue; }
    const value = v.resolvedType === 'COLOR' && typeof u.value === 'string' ? hexToRgb(u.value) : u.value;
    v.setValueForMode(u.modeId, value);
    updated.push({ id: v.id, name: v.name, modeId: u.modeId });
  } catch (e) {
    errors.push({ ...u, error: String(e && e.message || e) });
  }
}
return { updatedCount: updated.length, updated, errors };
