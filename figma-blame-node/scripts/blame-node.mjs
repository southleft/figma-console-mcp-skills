#!/usr/bin/env node
//
// blame-node.mjs — binary-search which Figma version introduced a target.
//
// The target is EXACTLY ONE of:
//   --property '<componentPropertyDefinitions key>'   e.g. 'Disabled#1:2'
//   --child '<descendant node id>'                    e.g. 695:340
//
// Existence of the target is assumed MONOTONIC (added once, present in every
// newer version up to start). So we binary-search the candidate version list
// for the OLDEST version that still has the target — that's the introduction
// point. ~log2(N) node fetches instead of N. Rate-limit friendly.
//
// Usage:
//   node blame-node.mjs --file <KEY_OR_URL> --node <ID> (--property <KEY> | --child <ID>)
//        [--start <VID|current>] [--max N] [--no-autosaves]
//
// Env: FIGMA_TOKEN (File content: Read, File versions: Read).
//      See ../../references/rest-api-setup.md.

const API = "https://api.figma.com/v1";

// ---------------------------------------------------------------------------
// Args + helpers
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { autosaves: true, start: "current", max: 200 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") args.file = argv[++i];
    else if (a === "--node") args.node = argv[++i];
    else if (a === "--property") args.property = argv[++i];
    else if (a === "--child") args.child = argv[++i];
    else if (a === "--start") args.start = argv[++i];
    else if (a === "--max") args.max = parseInt(argv[++i], 10);
    else if (a === "--no-autosaves") args.autosaves = false;
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
    const err = new Error(`HTTP ${resp.status} for ${url}: ${body}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

const versionParam = (v) => (v && v !== "current" ? `&version=${encodeURIComponent(v)}` : "");

// Fetch a node at depth=2 for a given version (or HEAD). Returns the node doc or null.
async function fetchNodeDoc(fileKey, nodeId, versionId) {
  const url = `${API}/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&depth=2${versionParam(versionId)}`;
  try {
    const data = await getJson(url);
    return data?.nodes?.[nodeId]?.document ?? null;
  } catch (e) {
    // A pruned version (404) is tolerated: treat as "node not present here".
    if (e.status === 404) return null;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Target existence test
// ---------------------------------------------------------------------------
function findChildById(node, targetId) {
  if (!node) return false;
  if (node.id === targetId) return true;
  if (Array.isArray(node.children)) {
    for (const c of node.children) if (findChildById(c, targetId)) return true;
  }
  return false;
}

function targetExists(node, target) {
  if (!node) return false;
  if (target.property) return !!node?.componentPropertyDefinitions?.[target.property];
  if (target.child) return findChildById(node, target.child);
  return false;
}

// ---------------------------------------------------------------------------
// Build candidate version list: versions strictly OLDER than start, newest-first.
// ---------------------------------------------------------------------------
async function collectCandidateVersions(fileKey, startVer, lookback, includeAutosaves) {
  const collected = [];
  let cursor;
  // If starting from HEAD, every listed version is older than start.
  let foundStart = startVer === "current";
  for (let page = 0; page < 10 && collected.length < lookback; page++) {
    let resp;
    try {
      const url = `${API}/files/${fileKey}/versions?page_size=50${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`;
      resp = await getJson(url);
    } catch {
      break;
    }
    const versions = resp?.versions || [];
    if (versions.length === 0) break;
    for (const v of versions) {
      if (!foundStart) {
        // Skip everything up to and including the start version.
        if (v.id === startVer) foundStart = true;
        continue;
      }
      const isLabeled = v.label && v.label !== "";
      if (!includeAutosaves && !isLabeled) continue;
      collected.push(v);
      if (collected.length >= lookback) break;
    }
    if (collected.length >= lookback) break;
    if (!resp?.pagination?.next_page) break;
    const last = versions[versions.length - 1];
    if (!last?.id || last.id === cursor) break;
    cursor = last.id;
  }
  return collected;
}

// Best-effort author metadata lookup for a single version id.
async function lookupVersionMeta(fileKey, versionId) {
  let cursor;
  for (let page = 0; page < 4; page++) {
    let resp;
    try {
      const url = `${API}/files/${fileKey}/versions?page_size=50${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`;
      resp = await getJson(url);
    } catch {
      return null;
    }
    const versions = resp?.versions || [];
    if (versions.length === 0) return null;
    const hit = versions.find((v) => v.id === versionId);
    if (hit) return { label: hit.label || null, created_at: hit.created_at || null, user_handle: hit.user?.handle || null };
    if (!resp?.pagination?.next_page) return null;
    const last = versions[versions.length - 1];
    if (!last?.id || last.id === cursor) return null;
    cursor = last.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file || !args.node) {
    console.error("Usage: node blame-node.mjs --file <KEY_OR_URL> --node <ID> (--property <KEY> | --child <ID>) [--start <VID|current>] [--max N] [--no-autosaves]");
    process.exit(1);
  }
  const targets = [args.property, args.child].filter((t) => t !== undefined);
  if (targets.length !== 1) {
    console.error("Specify exactly one of --property or --child.");
    process.exit(1);
  }
  const fileKey = extractFileKey(args.file);
  const nodeId = args.node;
  const startVer = args.start;
  const lookback = Number.isFinite(args.max) ? args.max : 200;
  const includeAutosaves = args.autosaves;
  const target = { property: args.property, child: args.child };

  let probes = 0;

  // Step 1: confirm the target exists at start (we're asking "when introduced").
  const startNode = await fetchNodeDoc(fileKey, nodeId, startVer);
  probes++;
  if (!startNode) {
    console.error(`Node ${nodeId} not found at start version "${startVer}". Verify --node and --start.`);
    process.exit(1);
  }
  if (!targetExists(startNode, target)) {
    console.error(`Target was not found at start version "${startVer}". The search requires the target to exist at start (you're asking when it was INTRODUCED). To track something that was REMOVED, pick a --start where it still existed.`);
    process.exit(1);
  }

  // Resolve "current" to the file's actual version id so candidate collection
  // can skip past it correctly.
  let resolvedStart = startVer;
  if (startVer === "current") {
    try {
      const head = await getJson(`${API}/files/${fileKey}?depth=1`);
      probes++;
      resolvedStart = head?.version || "current";
    } catch {
      resolvedStart = "current";
    }
  }

  // Step 2: build candidate list (versions OLDER than start, newest-first).
  const versions = await collectCandidateVersions(fileKey, resolvedStart, lookback, includeAutosaves);

  // Step 3: binary search for the LARGEST index (oldest version) where the
  // target still exists. Index 0 = newest candidate, last = oldest scanned.
  let lo = 0;
  let hi = versions.length - 1;
  let oldestExistsIdx = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const midDoc = await fetchNodeDoc(fileKey, nodeId, versions[mid].id);
    probes++;
    const exists = targetExists(midDoc, target);
    if (exists) {
      // Target present this far back; the introduction is here or older.
      if (mid > oldestExistsIdx) oldestExistsIdx = mid;
      lo = mid + 1; // search older
    } else {
      hi = mid - 1; // search newer
    }
  }

  // Step 4: interpret the three outcomes.
  const notes = [];
  let introduced;
  let certainty;

  if (oldestExistsIdx === -1) {
    // Target exists at start but at none of the older candidates => introduced AT start.
    const lookupId = startVer === "current" ? resolvedStart : startVer;
    const meta = await lookupVersionMeta(fileKey, lookupId);
    introduced = {
      version_id: lookupId,
      label: meta?.label ?? null,
      created_at: meta?.created_at ?? startNode?.lastModified ?? null,
      user_handle: meta?.user_handle ?? null,
      is_labeled: !!(meta?.label && meta.label !== ""),
    };
    certainty = introduced.user_handle === "Figma" ? "system_attributed" : introduced.user_handle ? "exact" : "metadata_unavailable";
    if (certainty === "metadata_unavailable")
      notes.push("Introduced at the start version itself, but its author metadata wasn't found within the versions-list lookback. The introduction is real; the user just isn't attributable from REST data alone.");
  } else {
    const v = versions[oldestExistsIdx];
    introduced = {
      version_id: v.id,
      label: v.label || null,
      created_at: v.created_at,
      user_handle: v.user?.handle ?? null,
      is_labeled: !!(v.label && v.label !== ""),
    };
    if (oldestExistsIdx === versions.length - 1) {
      certainty = "exists_at_lookback_horizon";
      notes.push(`Target also exists at the oldest scanned version (${v.id}). The true introduction is older than the search range — increase --max (currently ${lookback}).`);
    } else if (introduced.user_handle === "Figma") {
      certainty = "system_attributed";
      notes.push("The introduction version was a system autosave (user_handle='Figma'). Re-run with --no-autosaves to snap to the nearest LABELED version containing the change.");
    } else {
      certainty = "exact";
    }
  }

  notes.push("Binary search assumes the target's existence is monotonic (added once, never removed). If it was added, removed, then re-added, the reported introduction point may differ from the original.");

  const result = {
    file_key: fileKey,
    node_id: nodeId,
    target: args.property ? { type: "component_property", name: args.property } : { type: "child_node", node_id: args.child },
    introduced_at: introduced,
    attribution_certainty: certainty,
    summary: {
      versions_in_search_range: versions.length,
      probes_made: probes,
      include_autosaves: includeAutosaves,
    },
    notes,
  };

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

main().catch((e) => {
  let hint = "";
  if (e.status === 403) hint = " Hint: ensure your PAT has both 'File content: Read' and 'File versions: Read'.";
  console.error(e.message + hint);
  process.exit(1);
});
