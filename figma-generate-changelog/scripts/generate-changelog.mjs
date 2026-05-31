#!/usr/bin/env node
//
// generate-changelog.mjs — markdown changelog between two Figma file versions.
//
// Self-contained: fetches two snapshots, computes a page-structure diff (+ optional
// per-component deep diff), enriches the from/to refs with author/label/timestamp via
// one extra versions-list call, and renders release-notes markdown.
//
// Usage:
//   node generate-changelog.mjs --file <KEY_OR_URL> --from <VID> [--to <VID|current>]
//        [--components id1,id2] [--mode summary|standard|detailed] [--json]
//
// Env: FIGMA_TOKEN (File content: Read, File versions: Read).
//      See ../../references/rest-api-setup.md.

const API = "https://api.figma.com/v1";

// ---------------------------------------------------------------------------
// Args + REST helpers
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") args.file = argv[++i];
    else if (a === "--from") args.from = argv[++i];
    else if (a === "--to") args.to = argv[++i];
    else if (a === "--components") args.components = argv[++i];
    else if (a === "--mode") args.mode = argv[++i];
    else if (a === "--json") args.json = true;
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
    else if (resp.status === 404) hint = " (version_id may have been pruned, or doesn't belong to this file)";
    throw new Error(`HTTP ${resp.status} for ${url}${hint}: ${body}`);
  }
  return resp.json();
}

const versionParam = (v) => (v && v !== "current" ? `&version=${encodeURIComponent(v)}` : "");
const fetchDocument = (fileKey, v) => getJson(`${API}/files/${fileKey}?depth=1${versionParam(v)}`);
const fetchNode = (fileKey, id, v) =>
  getJson(`${API}/files/${fileKey}/nodes?ids=${encodeURIComponent(id)}&depth=2${versionParam(v)}`);

// ===========================================================================
// Diff engine (ported from the version-tools diff engine)
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
  const added = [], removed = [], renamed = [];
  for (const p of toPages) {
    if (!fromById.has(p.id)) added.push(p);
    else {
      const old = fromById.get(p.id);
      if (old.name !== p.name) renamed.push({ id: p.id, old_name: old.name, new_name: p.name });
    }
  }
  for (const p of fromPages) if (!toById.has(p.id)) removed.push(p);
  return {
    pages_added: added,
    pages_removed: removed,
    pages_renamed: renamed,
    summary: { added: added.length, removed: removed.length, renamed: renamed.length },
  };
}

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
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (!deepEqual(a[k], b[k])) return false;
  return true;
}

function diffComponentPropertyDefinitions(fromDefs, toDefs) {
  const from = fromDefs ?? {}, to = toDefs ?? {};
  const added = [], removed = [], typeChanged = [], defaultChanged = [];
  for (const key of Object.keys(to)) {
    const toDef = to[key];
    if (!(key in from)) added.push({ name: key, type: toDef.type, default_value: toDef.defaultValue });
    else {
      const fromDef = from[key];
      if (fromDef.type !== toDef.type) typeChanged.push({ name: key, from_type: fromDef.type, to_type: toDef.type });
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
    added, removed, type_changed: typeChanged, default_changed: defaultChanged,
    summary: { added: added.length, removed: removed.length, type_changed: typeChanged.length, default_changed: defaultChanged.length },
  };
}

function extractTopLevelBindings(node) {
  const out = {};
  const bv = node?.boundVariables;
  if (!bv || typeof bv !== "object") return out;
  for (const [prop, ref] of Object.entries(bv)) {
    if (ref && typeof ref === "object") {
      if (ref.type === "VARIABLE_ALIAS" && typeof ref.id === "string") { out[prop] = ref.id; continue; }
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
  const fc = Array.isArray(fromNode?.children) ? fromNode.children : [];
  const tc = Array.isArray(toNode?.children) ? toNode.children : [];
  const byF = new Map(), byT = new Map();
  for (const c of fc) if (c?.id) byF.set(c.id, c);
  for (const c of tc) if (c?.id) byT.set(c.id, c);
  for (const id of new Set([...byF.keys(), ...byT.keys()])) walkBoth(byF.get(id), byT.get(id), visit);
}

function collectBindingChanges(fromNode, toNode) {
  const changes = [];
  walkBoth(fromNode, toNode, (a, b) => {
    const aB = extractTopLevelBindings(a), bB = extractTopLevelBindings(b);
    for (const key of new Set([...Object.keys(aB), ...Object.keys(bB)])) {
      const fromId = aB[key] ?? null, toId = bB[key] ?? null;
      if (fromId === toId) continue;
      const kind = fromId === null ? "added" : toId === null ? "removed" : "rebound";
      changes.push({ node_id: (b ?? a).id, node_name: (b ?? a).name ?? "", property: key, from_variable_id: fromId, to_variable_id: toId, change_kind: kind });
    }
  });
  return changes;
}

function diffNode(fromNode, toNode, mode = "standard") {
  const id = (toNode ?? fromNode)?.id ?? "";
  const name = (toNode ?? fromNode)?.name ?? "";
  const type = (toNode ?? fromNode)?.type ?? "";
  const out = { node_id: id, node_name: name, node_type: type, name_changed: null, description_changed: null, children_added: [], children_removed: [], component_properties: null, binding_changes: [], change_count: 0, notes: [] };

  if (!fromNode && toNode) { out.notes.push("Node was added in the target version (no prior state to compare)."); out.change_count = 1; return out; }
  if (fromNode && !toNode) { out.notes.push("Node was removed in the target version (no later state to compare)."); out.change_count = 1; return out; }
  if (!fromNode && !toNode) { out.notes.push("Node not found in either version."); return out; }

  if (fromNode.name !== toNode.name) out.name_changed = { from: fromNode.name, to: toNode.name };
  if ((fromNode.description ?? "") !== (toNode.description ?? "")) out.description_changed = { from: fromNode.description ?? "", to: toNode.description ?? "" };

  const fromChildIds = new Set((fromNode.children ?? []).filter((c) => c?.id).map((c) => c.id));
  const toChildIds = new Set((toNode.children ?? []).filter((c) => c?.id).map((c) => c.id));
  for (const c of toNode.children ?? []) if (c?.id && !fromChildIds.has(c.id)) out.children_added.push({ id: c.id, name: c.name ?? "", type: c.type ?? "" });
  for (const c of fromNode.children ?? []) if (c?.id && !toChildIds.has(c.id)) out.children_removed.push({ id: c.id, name: c.name ?? "", type: c.type ?? "" });

  if (fromNode.type === "COMPONENT_SET" || toNode.type === "COMPONENT_SET") {
    const pd = diffComponentPropertyDefinitions(fromNode.componentPropertyDefinitions, toNode.componentPropertyDefinitions);
    const s = pd.summary;
    if (s.added || s.removed || s.type_changed || s.default_changed) out.component_properties = pd;
  }
  out.binding_changes = collectBindingChanges(fromNode, toNode);
  out.change_count =
    (out.name_changed ? 1 : 0) + (out.description_changed ? 1 : 0) +
    out.children_added.length + out.children_removed.length +
    (out.component_properties ? out.component_properties.summary.added + out.component_properties.summary.removed + out.component_properties.summary.type_changed + out.component_properties.summary.default_changed : 0) +
    out.binding_changes.length;
  return out;
}

// ===========================================================================
// Author enrichment: page the versions list to find from/to metadata.
// ===========================================================================
async function findVersionAuthorMetadata(fileKey, versionIds) {
  const result = new Map();
  for (const id of versionIds) result.set(id, null);
  const wanted = new Set(versionIds.filter((id) => id && id !== "current"));
  if (wanted.size === 0) return result;

  let cursor;
  for (let page = 0; page < 4 && wanted.size > 0; page++) {
    let resp;
    try {
      const url = `${API}/files/${fileKey}/versions?page_size=50${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`;
      resp = await getJson(url);
    } catch {
      break; // enrichment is best-effort
    }
    const versions = resp?.versions || [];
    if (versions.length === 0) break;
    for (const v of versions) {
      if (wanted.has(v.id)) {
        result.set(v.id, { version_id: v.id, label: v.label || null, created_at: v.created_at || null, user_handle: v.user?.handle || null });
        wanted.delete(v.id);
      }
    }
    if (wanted.size === 0) break;
    if (!resp?.pagination?.next_page) break;
    const last = versions[versions.length - 1];
    if (!last?.id || last.id === cursor) break;
    cursor = last.id;
  }
  return result;
}

// ===========================================================================
// Markdown formatter (ported from changelog-formatter)
// ===========================================================================
function escapeMd(s) {
  return String(s).replace(/([\\`*_{}\[\]<>])/g, "\\$1");
}
function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}
function computeSpanDays(fromIso, toIso) {
  if (!fromIso || !toIso) return null;
  const from = new Date(fromIso).getTime(), to = new Date(toIso).getTime();
  if (isNaN(from) || isNaN(to)) return null;
  return Math.max(0, Math.round((to - from) / (1000 * 60 * 60 * 24)));
}
function formatVersionRef(meta, versionId, headLastModified) {
  if (versionId === "current") {
    const date = headLastModified ? formatDate(headLastModified) : "current state";
    return `Current state (last modified ${date})`;
  }
  if (!meta) return `\`${versionId}\` _(metadata not available)_`;
  const label = meta.label && meta.label.trim() !== "" ? `"${meta.label}"` : "_(unlabeled)_";
  const date = meta.created_at ? formatDate(meta.created_at) : "";
  const user = meta.user_handle ? `by ${meta.user_handle}` : "";
  const parts = [label, date, user].filter(Boolean).join(" — ");
  return `${parts} \`${versionId}\``;
}

function formatSummaryLine(pageSummary, scoped) {
  const componentCount = scoped.filter((n) => n.change_count > 0).length;
  const totalComponentChanges = scoped.reduce((acc, n) => acc + n.change_count, 0);
  const parts = [];
  if (pageSummary.added > 0) parts.push(`${pageSummary.added} page${pageSummary.added === 1 ? "" : "s"} added`);
  if (pageSummary.removed > 0) parts.push(`${pageSummary.removed} page${pageSummary.removed === 1 ? "" : "s"} removed`);
  if (pageSummary.renamed > 0) parts.push(`${pageSummary.renamed} page${pageSummary.renamed === 1 ? "" : "s"} renamed`);
  if (componentCount > 0) parts.push(`${componentCount} component${componentCount === 1 ? "" : "s"} with ${totalComponentChanges} change${totalComponentChanges === 1 ? "" : "s"}`);
  return parts.length === 0 ? "_No structural changes detected._" : parts.join("; ") + ".";
}

function appendPageStructure(lines, page) {
  const total = page.summary.added + page.summary.removed + page.summary.renamed;
  lines.push("## Page Structure", "");
  if (total === 0) { lines.push("_No page-level changes._", ""); return; }
  if (page.pages_added.length) { lines.push(`**Added (${page.pages_added.length}):**`); for (const p of page.pages_added) lines.push(`- ${escapeMd(p.name)} \`${p.id}\``); lines.push(""); }
  if (page.pages_removed.length) { lines.push(`**Removed (${page.pages_removed.length}):**`); for (const p of page.pages_removed) lines.push(`- ${escapeMd(p.name)} \`${p.id}\``); lines.push(""); }
  if (page.pages_renamed.length) { lines.push(`**Renamed (${page.pages_renamed.length}):**`); for (const r of page.pages_renamed) lines.push(`- \`${r.id}\`: ${escapeMd(r.old_name)} → ${escapeMd(r.new_name)}`); lines.push(""); }
}

function appendComponentBlock(lines, n, mode) {
  lines.push(`### ${escapeMd(n.node_name || "(unnamed)")} — \`${n.node_id}\``);
  lines.push(`**${n.change_count} change${n.change_count === 1 ? "" : "s"}**`);
  const bullets = [];
  if (n.name_changed) bullets.push(`- Renamed: \`${escapeMd(n.name_changed.from)}\` → \`${escapeMd(n.name_changed.to)}\``);
  if (n.description_changed) bullets.push(`- Description changed (${n.description_changed.from.length} → ${n.description_changed.to.length} chars)`);
  if (n.children_added.length) bullets.push(`- Children added (${n.children_added.length}): ${n.children_added.map((c) => `\`${escapeMd(c.name || c.id)}\``).join(", ")}`);
  if (n.children_removed.length) bullets.push(`- Children removed (${n.children_removed.length}): ${n.children_removed.map((c) => `\`${escapeMd(c.name || c.id)}\``).join(", ")}`);
  if (bullets.length) { lines.push(""); lines.push(...bullets); }

  if (n.component_properties && (n.component_properties.summary.added || n.component_properties.summary.removed || n.component_properties.summary.type_changed || n.component_properties.summary.default_changed)) {
    const s = n.component_properties.summary;
    const parts = [];
    if (s.added) parts.push(`${s.added} added`);
    if (s.removed) parts.push(`${s.removed} removed`);
    if (s.type_changed) parts.push(`${s.type_changed} type changed`);
    if (s.default_changed) parts.push(`${s.default_changed} default changed`);
    lines.push("", `**Component properties:** ${parts.join(", ")}`);
    if (mode === "detailed") {
      for (const p of n.component_properties.added) lines.push(`- ➕ \`${escapeMd(p.name)}\` (${p.type})`);
      for (const p of n.component_properties.removed) lines.push(`- ➖ \`${escapeMd(p.name)}\` (${p.type})`);
      for (const t of n.component_properties.type_changed) lines.push(`- 🔄 \`${escapeMd(t.name)}\`: ${t.from_type} → ${t.to_type}`);
      for (const d of n.component_properties.default_changed) lines.push(`- ⚙️ \`${escapeMd(d.name)}\` default changed`);
    }
  }

  if (n.binding_changes.length) {
    lines.push("", `**Variable bindings (${n.binding_changes.length}):**`);
    if (mode === "detailed") {
      for (const b of n.binding_changes) {
        const arrow = b.change_kind === "added" ? `→ \`${b.to_variable_id}\`` : b.change_kind === "removed" ? `(removed, was \`${b.from_variable_id}\`)` : `\`${b.from_variable_id}\` → \`${b.to_variable_id}\``;
        lines.push(`- ${escapeMd(b.node_name || b.node_id)} — \`${b.property}\` ${arrow}`);
      }
    } else {
      const counts = { added: 0, removed: 0, rebound: 0 };
      for (const b of n.binding_changes) counts[b.change_kind]++;
      const parts = [];
      if (counts.added) parts.push(`${counts.added} added`);
      if (counts.removed) parts.push(`${counts.removed} removed`);
      if (counts.rebound) parts.push(`${counts.rebound} rebound`);
      lines.push(`_${parts.join(", ")}._`);
    }
  }
  lines.push("");
}

function formatChangelogMarkdown(input, mode) {
  const lines = [];
  const title = input.file_name ? `${input.file_name} — Change Log` : "Figma File Change Log";
  lines.push(`# ${title}`, "");
  lines.push(`**From:** ${formatVersionRef(input.from_meta, input.from_version_id, input.from_last_modified)}`);
  lines.push(`**To:** ${formatVersionRef(input.to_meta, input.to_version_id, input.to_last_modified)}`);
  const span = computeSpanDays(input.from_meta?.created_at ?? input.from_last_modified, input.to_meta?.created_at ?? input.to_last_modified);
  if (span !== null) lines.push(`**Span:** ${span} day${span === 1 ? "" : "s"}`);
  lines.push("");

  if (mode === "summary") {
    lines.push(formatSummaryLine(input.page_structure.summary, input.scoped_nodes ?? []), "");
    appendNotes(lines, input.notes);
    return lines.join("\n").trimEnd() + "\n";
  }

  appendPageStructure(lines, input.page_structure);

  if (input.scoped_nodes && input.scoped_nodes.length > 0) {
    lines.push("## Components", "");
    const withChanges = input.scoped_nodes.filter((n) => n.change_count > 0);
    const unchanged = input.scoped_nodes.filter((n) => n.change_count === 0 && n.notes.length === 0);
    if (withChanges.length === 0 && unchanged.length === 0) { lines.push("_No scoped components had changes._", ""); }
    for (const n of withChanges) appendComponentBlock(lines, n, mode);
    if (unchanged.length) lines.push(`**No changes:** ${unchanged.map((n) => `\`${n.node_name || n.node_id}\``).join(", ")}`, "");
  } else {
    lines.push("## Components", "", "_No components were scoped. Pass `--components` to include per-component changes._", "");
  }

  appendNotes(lines, input.notes);
  return lines.join("\n").trimEnd() + "\n";
}

function appendNotes(lines, notes) {
  if (!notes || notes.length === 0) return;
  lines.push("## Notes", "");
  for (const n of notes) lines.push(`- ${n}`);
  lines.push("");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file || !args.from) {
    console.error("Usage: node generate-changelog.mjs --file <KEY_OR_URL> --from <VID> [--to <VID|current>] [--components id1,id2] [--mode summary|standard|detailed] [--json]");
    process.exit(1);
  }
  const fileKey = extractFileKey(args.file);
  const fromVer = args.from;
  const toVer = args.to ?? "current";
  const mode = args.mode ?? "standard";
  const componentIds = args.components ? args.components.split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (fromVer === toVer) { console.error("from and to are identical — nothing to diff."); process.exit(1); }

  const [fromFile, toFile] = await Promise.all([fetchDocument(fileKey, fromVer), fetchDocument(fileKey, toVer)]);
  const pageDiff = diffPageStructure(fromFile.document, toFile.document);

  const scoped = [];
  for (const nodeId of componentIds) {
    try {
      const [fr, to] = await Promise.all([fetchNode(fileKey, nodeId, fromVer), fetchNode(fileKey, nodeId, toVer)]);
      scoped.push(diffNode(fr?.nodes?.[nodeId]?.document ?? null, to?.nodes?.[nodeId]?.document ?? null, mode));
    } catch (e) {
      scoped.push({ node_id: nodeId, node_name: "", node_type: "", name_changed: null, description_changed: null, children_added: [], children_removed: [], component_properties: null, binding_changes: [], change_count: 0, notes: [`Fetch failed: ${e.message}`] });
    }
  }

  // Best-effort author enrichment for the two version refs.
  const idsToLookup = [fromVer, toVer].filter((id) => id !== "current");
  const authorMap = idsToLookup.length > 0 ? await findVersionAuthorMetadata(fileKey, idsToLookup) : new Map();

  const notes = [
    "Not tracked: instances of components on the canvas, raw layout/visual properties (hug-vs-fill, unbound paddings/widths/cornerRadius/fills), variable VALUE changes (Figma REST doesn't expose them), and style content.",
  ];

  const markdown = formatChangelogMarkdown(
    {
      file_key: fileKey,
      file_name: fromFile?.name ?? toFile?.name ?? null,
      from_version_id: fromVer,
      to_version_id: toVer,
      from_meta: authorMap.get(fromVer) ?? null,
      to_meta: authorMap.get(toVer) ?? null,
      from_last_modified: fromFile?.lastModified ?? null,
      to_last_modified: toFile?.lastModified ?? null,
      page_structure: pageDiff,
      scoped_nodes: componentIds.length > 0 ? scoped : undefined,
      notes,
    },
    mode
  );

  if (args.json) {
    const fromMeta = authorMap.get(fromVer) ?? null;
    const toMeta = authorMap.get(toVer) ?? null;
    process.stdout.write(JSON.stringify({
      markdown,
      structured: { page_structure: pageDiff, scoped_nodes: scoped },
      _meta: {
        authors_enriched: idsToLookup.length > 0,
        from_author_found: !!fromMeta,
        to_author_found: !!toMeta,
      },
    }, null, 2) + "\n");
  } else {
    process.stdout.write(markdown);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
