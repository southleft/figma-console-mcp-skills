#!/usr/bin/env node
// figma-import-tokens — DETERMINISTIC DTCG → TOKENS parser.
//
// Removes the freehand "flatten the token file by hand" step. Reads a DTCG tokens file
// (e.g. one produced by figma-export-tokens' convert-tokens.mjs) and emits the exact
// `COLLECTION_NAME` / `MODES` / `TOKENS` constants to paste into apply-tokens.js.
//
// USAGE
//   node parse-tokens.mjs <tokens.json> [--default-mode Light] [--collection Brand]
//   <tokens.json>     a DTCG (.tokens.json) file: nested groups with leaf { $type, $value }.
//                     Multi-mode + Figma round-trip metadata under
//                     $extensions["figma-console-mcp"].{ modes, variableId } are honored.
//   --default-mode    the mode name that $value represents (default "Light").
//   --collection      target collection name for the import (default "Imported").
//
// Pairs with figma-export-tokens. Node 18+, zero dependencies. Non-DTCG inputs (Tailwind/SCSS)
// aren't parsed here — export to DTCG first, or build the TOKENS array by hand for those.

import fs from 'node:fs';

const argv = process.argv.slice(2);
const flags = {};
const positionals = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) { const n = argv[i + 1]; flags[a.slice(2)] = n && !n.startsWith('--') ? argv[++i] : true; }
  else positionals.push(a);
}
if (!positionals[0]) { console.error('Usage: node parse-tokens.mjs <tokens.json> [--default-mode Light] [--collection Brand]'); process.exit(1); }
const DEFAULT_MODE = typeof flags['default-mode'] === 'string' ? flags['default-mode'] : 'Light';
const COLLECTION = typeof flags.collection === 'string' ? flags.collection : 'Imported';
const EXT = 'figma-console-mcp';

let doc;
try { doc = JSON.parse(fs.readFileSync(positionals[0], 'utf8')); } catch (e) { console.error('Could not read/parse ' + positionals[0] + ': ' + e.message); process.exit(1); }

function figmaType(dtcg) {
  return ({ color: 'COLOR', dimension: 'FLOAT', number: 'FLOAT', fontWeight: 'FLOAT', duration: 'FLOAT', fontFamily: 'STRING', string: 'STRING', boolean: 'BOOLEAN' })[dtcg] || 'STRING';
}
function isLeaf(n) { return n && typeof n === 'object' && '$value' in n; }
function coerce(v, ftype) {
  if (typeof v === 'string') {
    if (/^\{.+\}$/.test(v)) return { reference: v };        // DTCG alias → reference (apply-tokens maps dots→/)
    if (ftype === 'FLOAT') { const n = parseFloat(v); return Number.isNaN(n) ? v : n; } // strip "16px" → 16
    return v;
  }
  return v;
}

const tokens = [];
const modeSet = new Set([DEFAULT_MODE]);
const warnings = [];
(function walk(node, path) {
  for (const key of Object.keys(node)) {
    if (key.startsWith('$')) continue;
    const child = node[key];
    if (!child || typeof child !== 'object') continue;
    if (isLeaf(child)) {
      const ftype = figmaType(child.$type);
      const values = { [DEFAULT_MODE]: coerce(child.$value, ftype) };
      const ext = child.$extensions && child.$extensions[EXT];
      if (ext && ext.modes) for (const [m, val] of Object.entries(ext.modes)) { values[m] = coerce(val, ftype); modeSet.add(m); }
      const t = { name: [...path, key].join('/'), type: ftype, values };
      if (ext && ext.variableId) t.figmaVariableId = ext.variableId;
      if (!child.$type) warnings.push(`${t.name}: no $type — defaulted to ${ftype}.`);
      tokens.push(t);
    } else walk(child, [...path, key]);
  }
})(doc, []);

const MODES = [DEFAULT_MODE, ...[...modeSet].filter((m) => m !== DEFAULT_MODE)];
process.stdout.write(
  `const COLLECTION_NAME = ${JSON.stringify(COLLECTION)};\n` +
  `const MODES = ${JSON.stringify(MODES)}; // first is the default mode\n` +
  `const TOKENS = ${JSON.stringify(tokens, null, 2)};\n`
);
console.error(`\nParsed ${tokens.length} tokens; modes: ${MODES.join(', ')}. Paste the three constants above into apply-tokens.js.`);
if (warnings.length) { console.error(`${warnings.length} warning(s):`); for (const w of warnings) console.error('  ⚠ ' + w); }
