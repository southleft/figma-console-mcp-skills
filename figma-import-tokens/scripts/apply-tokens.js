// figma-import-tokens — push design tokens INTO Figma as variables (create + update).
//
// Run via `use_figma` (skillNames: "figma-import-tokens"). Edit the two constants below.
// Two-pass: pass 1 creates/updates literal values; pass 2 wires aliases (so targets exist first).
// Matches existing variables by saved Figma id → key → exact name, so re-imports don't duplicate.
// See the official figma-use skill.

// ── INPUT (edit me) ────────────────────────────────────────────────────────────
const COLLECTION_NAME = 'Brand';
const MODES = ['Light', 'Dark']; // first is the default mode
// Each token: name uses "/" groups. value is per-mode. Literal OR { reference: "{Color.Brand.500}" }.
// Optionally include figmaVariableId (from a prior export's $extensions) to match an existing var.
const TOKENS = [
  { name: 'Color/Brand/Primary', type: 'COLOR', values: { Light: '#2D6CDF', Dark: '#5B8FF0' } },
  { name: 'Color/Text/Default',  type: 'COLOR', values: { Light: '#111111', Dark: '#FFFFFF' } },
  { name: 'Space/4',             type: 'FLOAT', values: { Light: 16,        Dark: 16 } },
  // alias example:
  // { name: 'Color/Action', type: 'COLOR', values: { Light: { reference: '{Color.Brand.Primary}' } } },
];
// ───────────────────────────────────────────────────────────────────────────────

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

// Find or create the collection + modes.
const collections = await figma.variables.getLocalVariableCollectionsAsync();
let collection = collections.find((c) => c.name === COLLECTION_NAME);
if (!collection) collection = figma.variables.createVariableCollection(COLLECTION_NAME);

const modeIdByName = {};
collection.renameMode(collection.modes[0].modeId, MODES[0]);
modeIdByName[MODES[0]] = collection.modes[0].modeId;
for (let i = 1; i < MODES.length; i++) {
  const existing = collection.modes.find((m) => m.name === MODES[i]);
  modeIdByName[MODES[i]] = existing ? existing.modeId : collection.addMode(MODES[i]);
}

// Index existing variables for non-destructive matching.
const existingById = {};
const existingByName = {};
for (const vid of collection.variableIds) {
  const v = await figma.variables.getVariableByIdAsync(vid);
  if (!v) continue;
  existingById[v.id] = v;
  existingByName[v.name] = v;
}

const nameToVar = {}; // resolved Figma variable per token name (for alias pass)
const created = [], updated = [], errors = [];

// PASS 1 — create/find every variable, set literal values.
for (const t of TOKENS) {
  try {
    let v = (t.figmaVariableId && existingById[t.figmaVariableId]) || existingByName[t.name];
    if (!v) {
      v = figma.variables.createVariable(t.name, collection, t.type);
      created.push(v.name);
    } else {
      updated.push(v.name);
    }
    nameToVar[t.name] = v;
    for (const mode of MODES) {
      const raw = t.values[mode];
      if (raw === undefined || raw === null) continue;
      if (raw && typeof raw === 'object' && raw.reference) continue; // alias → pass 2
      // Coerce per Figma type so a DTCG dimension like "16px" lands as the number 16, etc.
      let value;
      if (t.type === 'COLOR') value = typeof raw === 'string' ? hexToRgb(raw) : raw;
      else if (t.type === 'FLOAT') value = typeof raw === 'number' ? raw : parseFloat(String(raw));
      else if (t.type === 'BOOLEAN') value = typeof raw === 'boolean' ? raw : String(raw).toLowerCase() === 'true';
      else value = String(raw); // STRING
      if (t.type === 'FLOAT' && Number.isNaN(value)) { errors.push({ token: t.name, error: 'non-numeric FLOAT value: ' + JSON.stringify(raw) }); continue; }
      v.setValueForMode(modeIdByName[mode], value);
    }
  } catch (e) {
    errors.push({ token: t.name, error: String(e && e.message || e) });
  }
}

// PASS 2 — wire aliases now that all targets exist.
function refName(ref) { return ref.replace(/^\{|\}$/g, '').split('.').join('/'); }
for (const t of TOKENS) {
  for (const mode of MODES) {
    const raw = t.values[mode];
    if (!raw || typeof raw !== 'object' || !raw.reference) continue;
    try {
      const target = nameToVar[refName(raw.reference)] || existingByName[refName(raw.reference)];
      const v = nameToVar[t.name];
      if (target && v) {
        v.setValueForMode(modeIdByName[mode], figma.variables.createVariableAlias(target));
      } else {
        errors.push({ token: t.name, error: 'alias target not found: ' + raw.reference });
      }
    } catch (e) {
      errors.push({ token: t.name, error: String(e && e.message || e) });
    }
  }
}

return {
  collectionId: collection.id,
  collectionName: collection.name,
  modes: modeIdByName,
  created,
  updated,
  errors,
  variableIds: Object.values(nameToVar).map((v) => v.id),
};
