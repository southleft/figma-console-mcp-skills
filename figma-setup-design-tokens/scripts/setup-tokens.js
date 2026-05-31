// figma-setup-design-tokens — bootstrap a whole token system in ONE atomic call.
//
// Creates a collection, renames/adds modes, and creates every variable with per-mode values.
// Best for a fresh system or a new collection. For incremental edits use figma-manage-variables.
// Run via `use_figma` (skillNames: "figma-setup-design-tokens"). Edit the constants below.
// See the official figma-use skill.

// ── INPUT (edit me) ────────────────────────────────────────────────────────────
const COLLECTION_NAME = 'Primitives';
const MODES = ['Light', 'Dark']; // MODES[0] becomes the default mode
// values keyed by mode NAME. COLOR accepts hex; FLOAT/STRING/BOOLEAN are literals.
const TOKENS = [
  { name: 'color/gray/900', type: 'COLOR', values: { Light: '#111111', Dark: '#FAFAFA' } },
  { name: 'color/gray/50',  type: 'COLOR', values: { Light: '#FAFAFA', Dark: '#111111' } },
  { name: 'radius/md',      type: 'FLOAT', values: { Light: 8, Dark: 8 } },
  { name: 'space/4',        type: 'FLOAT', values: { Light: 16, Dark: 16 } },
];
// optional: per-variable scopes, e.g. SCOPES['color/gray/900'] = ['FRAME_FILL','SHAPE_FILL']
const SCOPES = {};
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

const collection = figma.variables.createVariableCollection(COLLECTION_NAME);
const modeId = {};
collection.renameMode(collection.modes[0].modeId, MODES[0]);
modeId[MODES[0]] = collection.modes[0].modeId;
for (let i = 1; i < MODES.length; i++) modeId[MODES[i]] = collection.addMode(MODES[i]);

const created = [], errors = [];
for (const t of TOKENS) {
  try {
    const v = figma.variables.createVariable(t.name, collection, t.type);
    for (const mode of MODES) {
      const raw = t.values[mode];
      if (raw === undefined || raw === null) continue;
      v.setValueForMode(modeId[mode], t.type === 'COLOR' && typeof raw === 'string' ? hexToRgb(raw) : raw);
    }
    if (SCOPES[t.name]) v.scopes = SCOPES[t.name];
    created.push({ id: v.id, name: v.name });
  } catch (e) {
    errors.push({ token: t.name, error: String(e && e.message || e) });
  }
}

return { collectionId: collection.id, collectionName: COLLECTION_NAME, modes: modeId, created, errors };
