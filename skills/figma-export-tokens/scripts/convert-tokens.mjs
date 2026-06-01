#!/usr/bin/env node
// figma-export-tokens — DETERMINISTIC token converter (parity with the Figma Console MCP exporter).
//
// Ports src/core/tokens/formatters/* so output is tested code, not freehanded. Turns the JSON from
// read-variables.js into the same formats the Console `figma_export_tokens` tool emits.
//
// USAGE
//   node convert-tokens.mjs <variables.json> --format <fmt> [--out <dir>] [--prefix <p>]
//                            [--modes Light,Dark] [--collection <substr>]
//   cat variables.json | node convert-tokens.mjs --format css-vars
//
//   --format   dtcg (default) | css-vars | tailwind-v4 | tailwind-v3 | scss | ts-module
//              | json-flat | json-nested | style-dictionary-v3 | tokens-studio
//              (aliases: css→css-vars, tailwind→tailwind-v4, ts→ts-module)
//   --out      directory to write file(s) into (tokens-studio writes several); else prints to stdout
//   --prefix   prefix for CSS/SCSS var names
//   --modes    comma-separated mode names to include (default: all)
//   --collection  only include collections whose name contains this substring (default: all)
//
// Multi-mode: CSS/Tailwind-v4 emit `:root` + `.dark`/`[data-theme]` blocks; TS/JSON emit per-mode
// value objects; SCSS suffixes non-default modes; DTCG keeps modes in $extensions; tokens-studio
// writes one file per (set, mode) + $metadata/$themes; style-dictionary/tailwind-v3 use the primary
// mode (matching the Console — those formats have no native multi-mode encoding). Node 18+, zero deps.

import fs from 'node:fs';
import path from 'node:path';

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flags = {};
const positionals = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) { const n = argv[i + 1]; flags[a.slice(2)] = n && !n.startsWith('--') ? argv[++i] : true; }
  else positionals.push(a);
}
const FORMAT_ALIASES = { css: 'css-vars', tailwind: 'tailwind-v4', ts: 'ts-module', json: 'json-nested', 'style-dictionary': 'style-dictionary-v3' };
let FORMAT = String(flags.format || 'dtcg').toLowerCase();
FORMAT = FORMAT_ALIASES[FORMAT] || FORMAT;
const OUT_DIR = typeof flags.out === 'string' ? flags.out : null;
const PREFIX = typeof flags.prefix === 'string' ? flags.prefix : '';
const MODE_FILTER = typeof flags.modes === 'string' ? flags.modes.split(',').map((s) => s.trim()).filter(Boolean) : null;
const COLLECTION_FILTER = typeof flags.collection === 'string' ? flags.collection.toLowerCase() : null;

// ── input ─────────────────────────────────────────────────────────────────────
let raw;
try { raw = positionals[0] ? fs.readFileSync(positionals[0], 'utf8') : fs.readFileSync(0, 'utf8'); }
catch (e) { console.error('Could not read input. Pass a file path or pipe JSON on stdin.\n' + e.message); process.exit(1); }
let data;
try { data = JSON.parse(raw); } catch (e) { console.error('Input is not valid JSON: ' + e.message); process.exit(1); }
let collections = data.collections || (Array.isArray(data) ? data : null);
if (!collections) { console.error('Input has no `collections` — expected the output of read-variables.js.'); process.exit(1); }
if (COLLECTION_FILTER) collections = collections.filter((c) => String(c.name).toLowerCase().includes(COLLECTION_FILTER));

const warnings = [];

// ── helpers ─────────────────────────────────────────────────────────────────
function slugify(s) { return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function pathToCssName(segs) { return segs.map(slugify).join('-'); }
function mapType(figmaType, name) {
  const l = String(name).toLowerCase();
  if (figmaType === 'COLOR') return 'color';
  if (figmaType === 'BOOLEAN') return 'boolean';
  if (figmaType === 'STRING') {
    if (l.includes('font-family') || l.includes('font/family')) return 'fontFamily';
    if (l.includes('font-weight') || l.includes('weight')) return 'fontWeight';
    return 'string';
  }
  if (l.includes('opacity') || l.includes('alpha')) return 'number';
  if (l.includes('font-weight') || l.includes('weight')) return 'fontWeight';
  if (l.includes('duration') || l.includes('delay')) return 'duration';
  return 'dimension';
}
const WEIGHT_NAMES = { thin: 100, hairline: 100, extralight: 200, 'extra light': 200, ultralight: 200, 'ultra light': 200, light: 300, normal: 400, regular: 400, book: 400, medium: 500, semibold: 600, 'semi bold': 600, demibold: 600, 'demi bold': 600, bold: 700, extrabold: 800, 'extra bold': 800, ultrabold: 800, black: 900, heavy: 900 };
function needsQuoting(s) { return /[^a-zA-Z0-9_-]/.test(s); }
function isAlias(v) { return v && typeof v === 'object' && typeof v.reference === 'string'; }

// ── normalize into a flat token list ───────────────────────────────────────────
const tokens = [];
const allModeNames = [];
const seenMode = new Set();
for (const col of collections) {
  let modeNames = (col.modes || []).map((m) => m.name);
  if (MODE_FILTER) modeNames = modeNames.filter((m) => MODE_FILTER.includes(m));
  const sole = modeNames.length <= 1;
  for (const mn of modeNames) if (!seenMode.has(mn)) { seenMode.add(mn); allModeNames.push(mn); }
  for (const v of (col.variables || [])) {
    const valuesByMode = {};
    for (const mn of modeNames) if (mn in (v.valuesByMode || {})) valuesByMode[mn] = v.valuesByMode[mn];
    if (Object.keys(valuesByMode).length === 0) continue;
    tokens.push({
      collection: col.name, path: String(v.name).split('/'), name: v.name,
      type: mapType(v.type, v.name), figmaType: v.type, scopes: v.scopes || [],
      valuesByMode, modeNames, sole, id: v.id || null, key: v.key || null, description: v.description || '',
    });
  }
}
// slug-collision detection
const byCss = {};
for (const t of tokens) { const c = pathToCssName(t.path); (byCss[c] = byCss[c] || []).push(t.name); }
for (const [c, names] of Object.entries(byCss)) { const u = [...new Set(names)]; if (u.length > 1) warnings.push(`Slug collision on --${c}: ${u.join(', ')} (last write wins). Rename to disambiguate.`); }

function pickPrimaryMode(t) {
  const modes = Object.keys(t.valuesByMode);
  const pref = modes.find((m) => ['light', 'default', 'value', 'base'].includes(m.trim().toLowerCase()));
  return pref || t.modeNames.find((m) => m in t.valuesByMode) || modes[0];
}

// value formatting (CSS-family literals; units from $type)
function cssLiteral(value, type) {
  if (typeof value === 'number') return type === 'dimension' ? `${value}px` : String(value);
  if (typeof value === 'string') {
    if (type === 'color') return value;
    if (type === 'fontWeight') { const w = WEIGHT_NAMES[value.trim().toLowerCase()]; if (w) return String(w); warnings.push(`Font weight "${value}" isn't numeric — emitted as-is.`); return needsQuoting(value) ? JSON.stringify(value) : value; }
    if (type === 'fontFamily' || type === 'string') return needsQuoting(value) ? JSON.stringify(value) : value;
    return value;
  }
  if (typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}
// plain literal for object formats (ts/json): dimension→"16px", fontWeight name→number, alias kept/resolved
function plainLiteral(value, type, resolveAlias) {
  if (isAlias(value)) return resolveAlias ? `var(--${PREFIX}${pathToCssName(value.reference.replace(/^\{|\}$/g, '').split('.'))})` : value.reference;
  if (typeof value === 'number' && type === 'dimension') return `${value}px`;
  if (type === 'fontWeight' && typeof value === 'string') { const w = WEIGHT_NAMES[value.trim().toLowerCase()]; if (w) return w; }
  return value;
}

// ── CSS-family selector helpers (multi-mode) ───────────────────────────────────
function selectorFor(mode, sole) {
  const l = String(mode).trim().toLowerCase();
  if (sole || ['', 'default', 'light', 'value', 'base', 'mode 1', 'mode1'].includes(l)) return ':root';
  if (l === 'dark') return '.dark';
  return `[data-theme="${slugify(mode)}"]`;
}
// Build selector → [ "--name: value;" ] using a per-token name fn (CSS var name or Tailwind @theme name).
function buildSelectorBlocks(nameFn) {
  const sel2lines = {};
  const order = [];
  for (const mode of allModeNames) {
    for (const t of tokens) {
      if (!(mode in t.valuesByMode)) continue;
      const val = t.valuesByMode[mode];
      const sel = selectorFor(mode, t.sole);
      const nm = nameFn(t);
      if (!nm) continue;
      if (!sel2lines[sel]) { sel2lines[sel] = []; order.push(sel); }
      if (isAlias(val)) {
        const bare = val.reference.replace(/^\{|\}$/g, '');
        if (bare.startsWith('__library:') || bare === 'unknown') { warnings.push(`${t.name}: unresolved alias — emitted as comment.`); sel2lines[sel].push(`  /* ${nm}: skipped — unresolved alias */`); }
        else sel2lines[sel].push(`  ${nm}: var(--${PREFIX}${pathToCssName(bare.split('.'))});`);
      } else sel2lines[sel].push(`  ${nm}: ${cssLiteral(val, t.type)};`);
    }
  }
  return { sel2lines, sels: [...new Set(order)].sort((a, b) => (a === ':root' ? -1 : b === ':root' ? 1 : 0)) };
}

// ── DTCG ────────────────────────────────────────────────────────────────────
function dtcgType(type) { return ({ color: 'color', dimension: 'dimension', number: 'number', fontWeight: 'fontWeight', fontFamily: 'fontFamily', duration: 'duration', string: 'string', boolean: 'boolean' })[type] || 'string'; }
function dtcgEncode(value, type) { if (isAlias(value)) return value.reference; if (type === 'fontWeight' && typeof value === 'string') { const w = WEIGHT_NAMES[value.trim().toLowerCase()]; if (w) return w; } return value; }
function sortKeys(node) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return node;
  const out = {};
  for (const k of Object.keys(node).sort((a, b) => { const ad = a.startsWith('$'), bd = b.startsWith('$'); if (ad && !bd) return -1; if (!ad && bd) return 1; return a.localeCompare(b); })) out[k] = sortKeys(node[k]);
  return out;
}
function emitDtcg() {
  const tree = {};
  for (const t of tokens) {
    let cur = tree;
    for (let i = 0; i < t.path.length - 1; i++) { const seg = t.path[i]; if (!cur[seg] || ('$value' in cur[seg])) cur[seg] = cur[seg] && !('$value' in cur[seg]) ? cur[seg] : {}; cur = cur[seg]; }
    const primary = pickPrimaryMode(t);
    const leaf = { $type: dtcgType(t.type), $value: dtcgEncode(t.valuesByMode[primary], t.type) };
    if (t.description) leaf.$description = t.description;
    const others = {};
    for (const m of Object.keys(t.valuesByMode)) if (m !== primary) others[m] = dtcgEncode(t.valuesByMode[m], t.type);
    const ext = {};
    if (Object.keys(others).length) ext.modes = others;
    if (t.id) ext.variableId = t.id;
    if (t.key) ext.key = t.key;
    if (Object.keys(ext).length) leaf.$extensions = { 'figma-console-mcp': ext };
    cur[t.path[t.path.length - 1]] = leaf;
  }
  return [{ path: 'tokens.tokens.json', content: JSON.stringify(sortKeys(tree), null, 2) + '\n' }];
}

// ── CSS custom properties (multi-mode) ──────────────────────────────────────────
function emitCss() {
  const { sel2lines, sels } = buildSelectorBlocks((t) => `--${PREFIX}${pathToCssName(t.path)}`);
  const out = ['/* Generated by figma-console-mcp-skills convert-tokens — do not edit by hand */', ''];
  for (const sel of sels) out.push(`${sel} {`, ...sel2lines[sel], '}', '');
  return [{ path: 'tokens.css', content: out.join('\n') }];
}

// ── Tailwind v4 (@theme base + mode override blocks) ────────────────────────────
function twV4Name(t) {
  const ns = (() => {
    if (t.type === 'color') return 'color';
    if (t.type === 'fontFamily') return 'font';
    if (t.type === 'fontWeight') return 'font-weight';
    if (t.type === 'dimension') { const n = t.name.toLowerCase(); if (n.includes('radius')) return 'radius'; if (n.includes('font-size') || n.includes('/text') || n.includes('text-')) return 'text'; if (n.includes('lead') || n.includes('line-height')) return 'leading'; if (n.includes('track') || n.includes('letter')) return 'tracking'; return 'spacing'; }
    return null;
  })();
  if (!ns) return null;
  let segs = t.path.map(slugify);
  const cat = { color: ['color', 'colors'], spacing: ['spacing', 'space'], radius: ['radius', 'border-radius', 'corner-radius'], text: ['font-size', 'text', 'size'], font: ['font', 'font-family'], 'font-weight': ['font-weight', 'weight'], leading: ['line-height', 'leading'], tracking: ['letter-spacing', 'tracking'] };
  while (segs.length > 1 && (cat[ns] || []).includes(segs[0])) segs = segs.slice(1);
  return `--${ns}-${segs.join('-')}`;
}
function emitTailwindV4() {
  // base mode → @theme; non-base modes → selector blocks reassigning the same vars.
  const skipped = [];
  const baseLines = [];
  for (const t of tokens) {
    const nm = twV4Name(t); if (!nm) { skipped.push(t.name); continue; }
    const primary = pickPrimaryMode(t); const val = t.valuesByMode[primary];
    if (val === undefined) continue;
    baseLines.push(isAlias(val) ? `  ${nm}: var(--${PREFIX}${pathToCssName(val.reference.replace(/^\{|\}$/g, '').split('.'))});` : `  ${nm}: ${cssLiteral(val, t.type)};`);
  }
  const lines = ['/* Generated by figma-console-mcp-skills convert-tokens (Tailwind v4). */', '@theme {', ...baseLines, '}', ''];
  // mode-override blocks (skip the primary/:root mode — that's the @theme base)
  const { sel2lines, sels } = buildSelectorBlocks((t) => twV4Name(t));
  for (const sel of sels) { if (sel === ':root') continue; lines.push(`${sel} {`, ...sel2lines[sel], '}', ''); }
  if (skipped.length) warnings.push(`Tailwind: ${skipped.length} token(s) have no @theme namespace — omitted.`);
  return [{ path: 'theme.css', content: lines.join('\n') }];
}

// ── Tailwind v3 (module.exports config, primary mode, aliases resolved) ──────────
const TW3_NS = { color: 'colors', colors: 'colors', spacing: 'spacing', space: 'spacing', radius: 'borderRadius', 'border-radius': 'borderRadius', rounded: 'borderRadius', font: 'fontFamily', 'font-family': 'fontFamily', text: 'fontSize', 'font-size': 'fontSize', 'font-weight': 'fontWeight', shadow: 'boxShadow', opacity: 'opacity', 'z-index': 'zIndex', 'line-height': 'lineHeight', leading: 'lineHeight', tracking: 'letterSpacing', 'letter-spacing': 'letterSpacing' };
function tw3Namespace(t) {
  const slug = t.path.map(slugify);
  if (TW3_NS[slug[0]]) return { ns: TW3_NS[slug[0]], sub: slug.slice(1) };
  if (t.type === 'color') return { ns: 'colors', sub: slug };
  if (t.type === 'dimension') return { ns: 'spacing', sub: slug };
  if (t.type === 'fontFamily') return { ns: 'fontFamily', sub: slug };
  if (t.type === 'fontWeight') return { ns: 'fontWeight', sub: slug };
  return { ns: 'extend', sub: slug };
}
function emitTailwindV3() {
  // primary-value lookup for 1-hop alias resolution (Tailwind v3 config needs literals)
  const byName = {}; for (const t of tokens) byName[t.name] = t;
  function resolved(t) {
    let val = t.valuesByMode[pickPrimaryMode(t)];
    let hop = 0;
    while (isAlias(val) && hop++ < 8) { const tgt = byName[val.reference.replace(/^\{|\}$/g, '').split('.').join('/')]; if (!tgt) return null; val = tgt.valuesByMode[pickPrimaryMode(tgt)]; }
    if (isAlias(val) || val === undefined) return null;
    if (typeof val === 'number') return t.type === 'dimension' ? `${val}px` : val;
    return val;
  }
  const ns = {};
  for (const t of tokens) { const r = resolved(t); if (r === null) { warnings.push(`Tailwind v3: ${t.name} alias unresolved — skipped.`); continue; } const { ns: name, sub } = tw3Namespace(t); (ns[name] = ns[name] || []).push({ sub, value: r }); }
  // build nested objects
  const tree = {};
  for (const [name, items] of Object.entries(ns)) { const root = tree[name] = {}; for (const { sub, value } of items) { let cur = root; for (let i = 0; i < sub.length - 1; i++) { cur[sub[i]] = cur[sub[i]] || {}; cur = cur[sub[i]]; } cur[sub[sub.length - 1] || 'DEFAULT'] = value; } }
  const content = '/** Generated by figma-console-mcp-skills convert-tokens. Spread into tailwind.config theme.extend. */\nmodule.exports = ' + JSON.stringify(tree, null, 2) + ';\n';
  return [{ path: 'tailwind.tokens.js', content }];
}

// ── SCSS (base $vars + suffixed non-default modes) ──────────────────────────────
function emitScss() {
  const out = ['// Generated by figma-console-mcp-skills convert-tokens.', '// Base mode = unsuffixed; other modes = $name--mode. SCSS is compile-time (no runtime theming).', ''];
  for (const t of tokens) {
    const base = `$${PREFIX}${pathToCssName(t.path)}`;
    for (const mode of t.modeNames) {
      if (!(mode in t.valuesByMode)) continue;
      const sel = selectorFor(mode, t.sole);
      const name = sel === ':root' ? base : `${base}--${slugify(mode)}`;
      const val = t.valuesByMode[mode];
      out.push(isAlias(val) ? `${name}: $${PREFIX}${pathToCssName(val.reference.replace(/^\{|\}$/g, '').split('.'))};` : `${name}: ${cssLiteral(val, t.type)};`);
    }
  }
  out.push('');
  return [{ path: '_tokens.scss', content: out.join('\n') }];
}

// ── object formats (TS / JSON) — multi-mode → per-mode value objects ────────────
function buildNested(resolveAlias) {
  const tree = {};
  for (const t of tokens) {
    let cur = tree;
    for (let i = 0; i < t.path.length - 1; i++) { const s = t.path[i]; if (typeof cur[s] !== 'object' || cur[s] === null) cur[s] = {}; cur = cur[s]; }
    const modes = Object.keys(t.valuesByMode);
    let leaf;
    if (modes.length <= 1) leaf = plainLiteral(t.valuesByMode[modes[0]], t.type, resolveAlias);
    else { leaf = {}; for (const m of modes) leaf[m] = plainLiteral(t.valuesByMode[m], t.type, resolveAlias); }
    cur[t.path[t.path.length - 1]] = leaf;
  }
  return tree;
}
function emitTs() { return [{ path: 'tokens.ts', content: '// Generated by figma-console-mcp-skills convert-tokens. Multi-mode tokens are {mode: value} objects.\nexport const tokens = ' + JSON.stringify(buildNested(true), null, 2) + ' as const;\n' }]; }
function emitJsonNested() { return [{ path: 'tokens.json', content: JSON.stringify(buildNested(false), null, 2) + '\n' }]; }
function emitJsonFlat() {
  const flat = {};
  for (const t of tokens) {
    const modes = Object.keys(t.valuesByMode);
    flat[t.path.join('.')] = modes.length <= 1 ? plainLiteral(t.valuesByMode[modes[0]], t.type, false) : Object.fromEntries(modes.map((m) => [m, plainLiteral(t.valuesByMode[m], t.type, false)]));
  }
  return [{ path: 'tokens.flat.json', content: JSON.stringify(flat, null, 2) + '\n' }];
}

// ── Style Dictionary v3 (nested {value,type,comment}, primary mode, {ref} aliases) ─
function sdType(t) {
  if (t.type === 'dimension') { const l = (t.path[0] || '').toLowerCase(); return (l.startsWith('spacing') || l === 'space') ? 'spacing' : 'size'; }
  return ({ color: 'color', fontFamily: 'string', fontWeight: 'number', duration: 'time', number: 'number', string: 'string', boolean: 'boolean' })[t.type] || t.type;
}
function emitStyleDictionary() {
  const tree = {};
  for (const t of tokens) {
    const primary = pickPrimaryMode(t); const v = t.valuesByMode[primary];
    let value;
    if (isAlias(v)) { const bare = v.reference.replace(/^\{|\}$/g, ''); if (bare.startsWith('__library:') || bare === 'unknown') { warnings.push(`${t.name}: unresolved alias — skipped in Style Dictionary.`); continue; } value = `{${bare}}`; }
    else value = (typeof v === 'number' && t.type === 'dimension') ? `${v}px` : v;
    let cur = tree;
    for (let i = 0; i < t.path.length - 1; i++) { const s = t.path[i]; if (typeof cur[s] !== 'object' || cur[s] === null) cur[s] = {}; cur = cur[s]; }
    const leaf = { value, type: sdType(t) };
    if (t.description) leaf.comment = t.description;
    cur[t.path[t.path.length - 1]] = leaf;
  }
  return [{ path: 'tokens.sd.json', content: JSON.stringify(sortKeys(tree), null, 2) + '\n' }];
}

// ── Tokens Studio (per-(set,mode) files + $metadata + $themes) ──────────────────
function tsStudioType(t) {
  if (t.type === 'dimension') { const l = (t.path[0] || '').toLowerCase(); if (l.includes('border') || l.includes('radius')) return 'borderRadius'; if (l.startsWith('space') || l.startsWith('spacing')) return 'spacing'; return 'sizing'; }
  return ({ color: 'color', fontFamily: 'fontFamilies', fontWeight: 'fontWeights', duration: 'time', number: 'number', string: 'string', boolean: 'boolean' })[t.type] || t.type;
}
function emitTokensStudio() {
  const files = [];
  const setNamesByMode = [];
  for (const col of collections) {
    let modeNames = (col.modes || []).map((m) => m.name);
    if (MODE_FILTER) modeNames = modeNames.filter((m) => MODE_FILTER.includes(m));
    const setTokens = tokens.filter((t) => t.collection === col.name);
    for (const mode of modeNames) {
      const setName = modeNames.length > 1 ? `${slugify(col.name)}/${slugify(mode)}` : slugify(col.name);
      setNamesByMode.push({ setName, mode });
      const tree = {};
      for (const t of setTokens) {
        if (!(mode in t.valuesByMode)) continue;
        const v = t.valuesByMode[mode];
        let value;
        if (isAlias(v)) { const bare = v.reference.replace(/^\{|\}$/g, ''); if (bare.startsWith('__library:') || bare === 'unknown') continue; value = `{${bare}}`; }
        else value = (typeof v === 'number' && t.type === 'dimension') ? `${v}px` : v;
        let cur = tree;
        for (let i = 0; i < t.path.length - 1; i++) { const s = t.path[i]; if (typeof cur[s] !== 'object' || cur[s] === null) cur[s] = {}; cur = cur[s]; }
        const leaf = { value, type: tsStudioType(t) };
        if (t.description) leaf.description = t.description;
        cur[t.path[t.path.length - 1]] = leaf;
      }
      files.push({ path: `${setName}.json`, content: JSON.stringify(sortKeys(tree), null, 2) + '\n' });
    }
  }
  files.push({ path: '$metadata.json', content: JSON.stringify({ tokenSetOrder: setNamesByMode.map((e) => e.setName) }, null, 2) + '\n' });
  const modes = [...new Set(setNamesByMode.map((e) => e.mode))];
  const themes = modes.map((mode) => { const sel = {}; for (const e of setNamesByMode) sel[e.setName] = e.mode === mode ? 'enabled' : 'source'; return { id: slugify(mode), name: mode, selectedTokenSets: sel }; });
  files.push({ path: '$themes.json', content: JSON.stringify(themes, null, 2) + '\n' });
  return files;
}

// ── dispatch ────────────────────────────────────────────────────────────────────
const EMITTERS = {
  'dtcg': emitDtcg, 'css-vars': emitCss, 'tailwind-v4': emitTailwindV4, 'tailwind-v3': emitTailwindV3,
  'scss': emitScss, 'ts-module': emitTs, 'json-nested': emitJsonNested, 'json-flat': emitJsonFlat,
  'style-dictionary-v3': emitStyleDictionary, 'tokens-studio': emitTokensStudio,
};
const emit = EMITTERS[FORMAT];
if (!emit) { console.error(`Unknown --format "${FORMAT}". Use: ${Object.keys(EMITTERS).join(', ')} (aliases: css, tailwind, ts).`); process.exit(1); }

const outFiles = emit();
if (OUT_DIR) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const f of outFiles) { const p = path.join(OUT_DIR, f.path); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.content); console.error(`Wrote ${p}`); }
  console.error(`(${tokens.length} tokens, format=${FORMAT})`);
} else {
  for (const f of outFiles) { if (outFiles.length > 1) process.stdout.write(`\n/* ===== ${f.path} ===== */\n`); process.stdout.write(f.content); }
}
if (warnings.length) { console.error(`\n${warnings.length} warning(s):`); for (const w of warnings) console.error('  ⚠ ' + w); }
