#!/usr/bin/env node
//
// diff-versions.mjs — diff two versions of a Figma file via the REST API.
//
// Always computes a cheap page-structure diff (2 API calls). If --components is
// passed, also computes deep per-node diffs at depth=2 (2 calls per node):
// children added/removed, name/description changes, componentPropertyDefinitions
// changes for COMPONENT_SETs, and boundVariables (variable-binding) deltas.
//
// Usage:
//   node diff-versions.mjs --file <KEY_OR_URL> --from <VID> [--to <VID|current>]
//                          [--components id1,id2] [--mode summary|standard|detailed]
//
// Env: FIGMA_TOKEN (File content: Read, File versions: Read).
//      See ../../references/rest-api-setup.md.
//
// Output: JSON to stdout. Use `current` (or omit --to) to diff against HEAD.

const API = "https://api.figma.com/v1";

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") args.file = argv[++i];
    else if (a === "--from") args.from = argv[++i];
    else if (a === "--to") args.to = argv[++i];
    else if (a === "--components") args.components = argv[++i];
    else if (a === "--mode") args.mode = argv[++i];
    else {
      console.error(`Unknown arg: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

function extractFileKey(s) {
  const m = String(s).match(/\/(?:design|file)\/([A-Za-z0-9]+)/);
  return m ? m[1] : s;
}

// ---------------------------------------------------------------------------
// REST fetch helpers
// ---------------------------------------------------------------------------
function token() {
  const t = process.env.FIGMA_TOKEN;
  if (!t) {
    console.error("ERROR: FIGMA_TOKEN is not set. See ../../references/rest-api-setup.md");
    process.exit(1);
  }
  return t;
}

async function getJson(url) {
  const resp = await fetch(url, { headers: { "X-Figma-Token": token() } });
  if (!resp.ok) {
    const body = await resp.text();
    let hint = "";
    if (resp.status === 403) hint = " (PAT likely missing 'File versions: Read' / 'File content: Read')";
    else if (resp.status === 404) hint = " (version_id may have been pruned by retention, or doesn't belong to this file)";
    throw new Error(`HTTP ${resp.status} for ${url}${hint}: ${body}`);
  }
  return resp.json();
}

// "current" / HEAD => omit the version param.
function versionParam(versionId) {
  return versionId && versionId !== "current" ? `&version=${encodeURIComponent(versionId)}` : "";
}

async function fetchDocument(fileKey, versionId) {
  const url = `${API}/files/${fileKey}?depth=1${versionParam(versionId)}`;
  return getJson(url);
}

async function fetchNode(fileKey, nodeId, versionId) {
  const url = `${API}/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&depth=2${versionParam(versionId)}`;
  return getJson(url);
}

// ===========================================================================
// Page-structure diff (from depth=1 file documents)
// ===========================================================================
function extractPages(doc) {
  const children = doc?.children;
  if (!Array.isArray(children)) return [];
  return children
    .filter((c) => c && typeof c.id === "string" && typeof c.name === "string")
    .map((c) => ({ id: c.id, name: c.name }));
}

function diffPageStructure(fromDoc, toDoc) {
  const fromPages = extractPages(fromDoc);
  const toPages = extractPages(toDoc);
  const fromById = new Map(fromPages.map((p) => [p.id, p]));
  const toById = new Map(toPages.map((p) => [p.id, p]));

  const added = [];
  const removed = [];
  const renamed = [];

  for (const p of toPages) {
    if (!fromById.has(p.id)) added.push(p);
    else {
      const old = fromById.get(p.id);
      if (old.name !== p.name) renamed.push({ id: p.id, old_name: old.name, new_name: p.name });
    }
  }
  for (const p of fromPages) {
    if (!toById.has(p.id)) removed.push(p);
  }

  return {
    pages_added: added,
    pages_removed: removed,
    pages_renamed: renamed,
    summary: { added: added.length, removed: removed.length, renamed: renamed.length },
  };
}

// ===========================================================================
// componentPropertyDefinitions diff (COMPONENT_SET only)
// ===========================================================================
function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) if (!deepEqual(a[k], b[k])) return false;
  return true;
}

function diffComponentPropertyDefinitions(fromDefs, toDefs) {
  const from = fromDefs ?? {};
  const to = toDefs ?? {};
  const added = [];
  const removed = [];
  const typeChanged = [];
  const defaultChanged = [];

  for (const key of Object.keys(to)) {
    const toDef = to[key];
    if (!(key in from)) {
      added.push({ name: key, type: toDef.type, default_value: toDef.defaultValue });
    } else {
      const fromDef = from[key];
      if (fromDef.type !== toDef.type)
        typeChanged.push({ name: key, from_type: fromDef.type, to_type: toDef.type });
      if (!deepEqual(fromDef.defaultValue, toDef.defaultValue))
        defaultChanged.push({ name: key, from_default: fromDef.defaultValue, to_default: toDef.defaultValue });
    }
  }
  for (const key of Object.keys(from)) {
    if (!(key in to)) {
      const fromDef = from[key];
      removed.push({ name: key, type: fromDef.type, default_value: fromDef.defaultValue });
    }
  }

  return {
    added,
    removed,
    type_changed: typeChanged,
    default_changed: defaultChanged,
    summary: {
      added: added.length,
      removed: removed.length,
      type_changed: typeChanged.length,
      default_changed: defaultChanged.length,
    },
  };
}

// ===========================================================================
// Variable-binding diff (top-level boundVariables, walked over matched subtree)
// ===========================================================================
function extractTopLevelBindings(node) {
  const out = {};
  const bv = node?.boundVariables;
  if (!bv || typeof bv !== "object") return out;
  for (const [prop, ref] of Object.entries(bv)) {
    if (ref && typeof ref === "object") {
      if (ref.type === "VARIABLE_ALIAS" && typeof ref.id === "string") {
        out[prop] = ref.id;
        continue;
      }
      if (Array.isArray(ref)) {
        const first = ref.find((r) => r && r.type === "VARIABLE_ALIAS" && typeof r.id === "string");
        if (first) out[`${prop}[0]`] = first.id;
      }
    }
  }
  return out;
}

function walkBoth(fromNode, toNode, visit) {
  if (!fromNode && !toNode) return;
  visit(fromNode, toNode);
  const fromChildren = Array.isArray(fromNode?.children) ? fromNode.children : [];
  const toChildren = Array.isArray(toNode?.children) ? toNode.children : [];
  const byIdFrom = new Map();
  for (const c of fromChildren) if (c?.id) byIdFrom.set(c.id, c);
  const byIdTo = new Map();
  for (const c of toChildren) if (c?.id) byIdTo.set(c.id, c);
  const allIds = new Set([...byIdFrom.keys(), ...byIdTo.keys()]);
  for (const id of allIds) walkBoth(byIdFrom.get(id), byIdTo.get(id), visit);
}

function collectBindingChanges(fromNode, toNode) {
  const changes = [];
  walkBoth(fromNode, toNode, (a, b) => {
    const aB = extractTopLevelBindings(a);
    const bB = extractTopLevelBindings(b);
    const allKeys = new Set([...Object.keys(aB), ...Object.keys(bB)]);
    for (const key of allKeys) {
      const fromId = aB[key] ?? null;
      const toId = bB[key] ?? null;
      if (fromId === toId) continue;
      let kind;
      if (fromId === null) kind = "added";
      else if (toId === null) kind = "removed";
      else kind = "rebound";
      changes.push({
        node_id: (b ?? a).id,
        node_name: (b ?? a).name ?? "",
        property: key,
        from_variable_id: fromId,
        to_variable_id: toId,
        change_kind: kind,
      });
    }
  });
  return changes;
}

// ===========================================================================
// Single-node diff (the headline output for a scoped diff)
// ===========================================================================
function diffNode(fromNode, toNode, mode = "standard") {
  const id = (toNode ?? fromNode)?.id ?? "";
  const name = (toNode ?? fromNode)?.name ?? "";
  const type = (toNode ?? fromNode)?.type ?? "";

  const out = {
    node_id: id,
    node_name: name,
    node_type: type,
    name_changed: null,
    description_changed: null,
    children_added: [],
    children_removed: [],
    component_properties: null,
    binding_changes: [],
    change_count: 0,
    notes: [],
  };

  if (!fromNode && toNode) {
    out.notes.push("Node was added in the target version (no prior state to compare).");
    out.change_count = 1;
    return out;
  }
  if (fromNode && !toNode) {
    out.notes.push("Node was removed in the target version (no later state to compare).");
    out.change_count = 1;
    return out;
  }
  if (!fromNode && !toNode) {
    out.notes.push("Node not found in either version.");
    return out;
  }

  if (fromNode.name !== toNode.name) out.name_changed = { from: fromNode.name, to: toNode.name };
  if ((fromNode.description ?? "") !== (toNode.description ?? ""))
    out.description_changed = { from: fromNode.description ?? "", to: toNode.description ?? "" };

  const fromChildIds = new Set((fromNode.children ?? []).filter((c) => c?.id).map((c) => c.id));
  const toChildIds = new Set((toNode.children ?? []).filter((c) => c?.id).map((c) => c.id));
  for (const c of toNode.children ?? [])
    if (c?.id && !fromChildIds.has(c.id))
      out.children_added.push({ id: c.id, name: c.name ?? "", type: c.type ?? "" });
  for (const c of fromNode.children ?? [])
    if (c?.id && !toChildIds.has(c.id))
      out.children_removed.push({ id: c.id, name: c.name ?? "", type: c.type ?? "" });

  if (fromNode.type === "COMPONENT_SET" || toNode.type === "COMPONENT_SET") {
    const propDiff = diffComponentPropertyDefinitions(
      fromNode.componentPropertyDefinitions,
      toNode.componentPropertyDefinitions
    );
    const s = propDiff.summary;
    if (s.added || s.removed || s.type_changed || s.default_changed) out.component_properties = propDiff;
  }

  out.binding_changes = collectBindingChanges(fromNode, toNode);

  out.change_count =
    (out.name_changed ? 1 : 0) +
    (out.description_changed ? 1 : 0) +
    out.children_added.length +
    out.children_removed.length +
    (out.component_properties
      ? out.component_properties.summary.added +
        out.component_properties.summary.removed +
        out.component_properties.summary.type_changed +
        out.component_properties.summary.default_changed
      : 0) +
    out.binding_changes.length;

  // Mode controls verbosity: strip heavy detail for summary/standard.
  if (mode === "summary") {
    out.children_added = [];
    out.children_removed = [];
    if (out.component_properties)
      out.component_properties = { added: [], removed: [], type_changed: [], default_changed: [], summary: out.component_properties.summary };
    out.binding_changes = [];
  } else if (mode === "standard") {
    if (out.component_properties) {
      out.component_properties = {
        added: out.component_properties.added.map((p) => ({ name: p.name, type: p.type })),
        removed: out.component_properties.removed.map((p) => ({ name: p.name, type: p.type })),
        type_changed: out.component_properties.type_changed,
        default_changed: out.component_properties.default_changed.map((d) => ({ name: d.name })),
        summary: out.component_properties.summary,
      };
    }
  }
  // "detailed" keeps everything.
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file || !args.from) {
    console.error("Usage: node diff-versions.mjs --file <KEY_OR_URL> --from <VID> [--to <VID|current>] [--components id1,id2] [--mode summary|standard|detailed]");
    process.exit(1);
  }
  const fileKey = extractFileKey(args.file);
  const fromVer = args.from;
  const toVer = args.to ?? "current";
  const mode = args.mode ?? "standard";
  const componentIds = args.components ? args.components.split(",").map((s) => s.trim()).filter(Boolean) : [];

  if (fromVer === toVer) {
    console.error("from and to are identical — nothing to diff.");
    process.exit(1);
  }

  let apiCalls = 0;

  // Phase A: cheap page-structure diff (parallel fetch).
  const [fromFile, toFile] = await Promise.all([
    fetchDocument(fileKey, fromVer),
    fetchDocument(fileKey, toVer),
  ]);
  apiCalls += 2;
  const pageDiff = diffPageStructure(fromFile.document, toFile.document);

  // Phase B: scoped per-node deep diffs (2 calls each).
  const scoped = [];
  const fetchErrors = [];
  for (const nodeId of componentIds) {
    try {
      const [fromResp, toResp] = await Promise.all([
        fetchNode(fileKey, nodeId, fromVer),
        fetchNode(fileKey, nodeId, toVer),
      ]);
      apiCalls += 2;
      const fromNode = fromResp?.nodes?.[nodeId]?.document ?? null;
      const toNode = toResp?.nodes?.[nodeId]?.document ?? null;
      scoped.push(diffNode(fromNode, toNode, mode));
    } catch (e) {
      fetchErrors.push({ node_id: nodeId, error: e.message });
    }
  }

  const notes = [];
  if (componentIds.length === 0) {
    notes.push("Only page-structure diff returned. Pass --components <ids> for per-component analysis.");
  }
  notes.push(
    "NOT tracked: instances on the canvas, raw layout/visual properties (hug-vs-fill, unbound paddings/widths/cornerRadius/fills), variable VALUE changes (Figma REST doesn't expose them), and style content."
  );

  const out = {
    file_key: fileKey,
    file_name: fromFile?.name ?? toFile?.name ?? null,
    from: { version_id: fromVer, last_modified: fromFile?.lastModified ?? null },
    to: { version_id: toVer, last_modified: toFile?.lastModified ?? null },
    mode,
    page_structure: pageDiff,
    scoped_nodes: componentIds.length > 0 ? scoped : undefined,
    summary: {
      page_changes: pageDiff.summary.added + pageDiff.summary.removed + pageDiff.summary.renamed,
      scoped_nodes_requested: componentIds.length,
      scoped_nodes_returned: scoped.length,
      scoped_nodes_with_changes: scoped.filter((n) => n.change_count > 0).length,
      api_calls_made: apiCalls,
    },
    notes,
    _fetch_errors: fetchErrors.length > 0 ? fetchErrors : undefined,
  };

  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

// Exported for reuse by figma-generate-changelog.
export { diffPageStructure, diffNode, extractFileKey, fetchDocument, fetchNode, versionParam };
