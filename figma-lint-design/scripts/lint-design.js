// figma-lint-design — WCAG 2.2 + design-system lint over a node tree.
//
// Run via the native Figma MCP `use_figma` tool (pass skillNames: "figma-lint-design").
// Plain JS, top-level await, returns JSON. Works on ANY Figma plan (Plugin API only).
// See ../../references/use-figma-conventions.md and ../references/lint-rules.md.

// ---- Inputs (edit these) ----
const NODE_ID = null;          // string node id, or null to lint the whole current page
const RULES = ['all'];         // 'all' | 'wcag' | 'design-system' | 'layout' | specific rule ids
const MAX_DEPTH = 10;          // how deep to walk the tree
const MAX_FINDINGS = 100;      // cap total findings (sets truncated:true when hit)

// ---- Color science helpers (sRGB → relative luminance → contrast ratio) ----
function linearize(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function luminance(r, g, b) { return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b); }
function contrastRatio(r1, g1, b1, r2, g2, b2) {
  const l1 = luminance(r1, g1, b1), l2 = luminance(r2, g2, b2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function rgbToHex(r, g, b) {
  const h = (n) => Math.round(n * 255).toString(16).padStart(2, '0').toUpperCase();
  return '#' + h(r) + h(g) + h(b);
}

// Walk up ancestors to the nearest solid fill (defaults to white).
function getEffectiveBg(node) {
  let cur = node.parent;
  while (cur) {
    try {
      if (cur.fills && cur.fills.length > 0) {
        for (let i = cur.fills.length - 1; i >= 0; i--) {
          const f = cur.fills[i];
          if (f.type === 'SOLID' && f.visible !== false) {
            return { r: f.color.r, g: f.color.g, b: f.color.b, opacity: f.opacity === undefined ? 1 : f.opacity };
          }
        }
      }
    } catch (e) { /* slot sublayer */ }
    cur = cur.parent;
  }
  return { r: 1, g: 1, b: 1, opacity: 1 };
}
function getFillColor(node) {
  try {
    const fills = node.fills;
    if (fills && fills.length) for (let i = fills.length - 1; i >= 0; i--)
      if (fills[i].type === 'SOLID' && fills[i].visible !== false) return { r: fills[i].color.r, g: fills[i].color.g, b: fills[i].color.b };
  } catch (e) { /* skip */ }
  return null;
}
function getStrokeColor(node) {
  try {
    const s = node.strokes;
    if (s && s.length) for (let i = s.length - 1; i >= 0; i--)
      if (s[i].type === 'SOLID' && s[i].visible !== false) return { r: s[i].color.r, g: s[i].color.g, b: s[i].color.b };
  } catch (e) { /* skip */ }
  return null;
}
// WCAG "large text": ≥24px, or ≥18.66px bold (700+)
function isLargeText(fontSize, fontWeight) {
  if (fontSize >= 24) return true;
  if (fontSize >= 18.66 && (fontWeight === 'Bold' || fontWeight === 'Black' || fontWeight === 'ExtraBold')) return true;
  return false;
}
function hasNonColorIndicator(node) {
  try {
    if (!node.children) return false;
    for (const child of node.children) {
      try {
        if (child.type === 'VECTOR' || child.type === 'BOOLEAN_OPERATION' || child.type === 'INSTANCE') return true;
        if (child.strokes && child.strokes.length) for (const st of child.strokes) if (st.visible !== false) return true;
      } catch (e) { /* skip */ }
    }
  } catch (e) { /* skip */ }
  return false;
}
const headingStyleRegex = /\bh(\d)\b|heading[\s-]*(\d)/i;
function getHeadingLevel(node) {
  try { const m = headingStyleRegex.exec(node.name); if (m) return parseInt(m[1] || m[2], 10); } catch (e) {}
  try {
    const fs = node.fontSize;
    if (typeof fs === 'number') {
      if (fs >= 40) return 1; if (fs >= 32) return 2; if (fs >= 24) return 3; if (fs >= 20) return 4; if (fs >= 18) return 5;
    }
  } catch (e) {}
  return 0;
}

// ---- Rule configuration ----
const allRuleIds = [
  'wcag-contrast', 'wcag-text-size', 'wcag-target-size', 'wcag-line-height',
  'wcag-non-text-contrast', 'wcag-color-only', 'wcag-focus-indicator',
  'wcag-letter-spacing', 'wcag-paragraph-spacing', 'wcag-image-alt',
  'wcag-heading-hierarchy', 'wcag-reflow', 'wcag-reading-order',
  'wcag-disabled-no-context', 'token-misuse',
  'hardcoded-color', 'no-text-style', 'default-name', 'detached-component',
  'no-autolayout', 'empty-container'
];
const ruleGroups = {
  all: allRuleIds,
  wcag: ['wcag-contrast', 'wcag-text-size', 'wcag-target-size', 'wcag-line-height', 'wcag-non-text-contrast',
    'wcag-color-only', 'wcag-focus-indicator', 'wcag-letter-spacing', 'wcag-paragraph-spacing', 'wcag-image-alt',
    'wcag-heading-hierarchy', 'wcag-reflow', 'wcag-reading-order', 'wcag-disabled-no-context'],
  'design-system': ['hardcoded-color', 'no-text-style', 'default-name', 'detached-component', 'token-misuse'],
  layout: ['no-autolayout', 'empty-container']
};
const severityMap = {
  'wcag-contrast': 'critical', 'wcag-target-size': 'critical', 'wcag-non-text-contrast': 'critical',
  'wcag-color-only': 'critical', 'wcag-focus-indicator': 'critical',
  'wcag-text-size': 'warning', 'wcag-letter-spacing': 'warning', 'wcag-image-alt': 'warning',
  'wcag-heading-hierarchy': 'warning', 'wcag-reflow': 'warning', 'wcag-reading-order': 'warning',
  'wcag-disabled-no-context': 'warning', 'wcag-line-height': 'info', 'wcag-paragraph-spacing': 'info',
  'token-misuse': 'warning', 'hardcoded-color': 'warning', 'no-text-style': 'warning',
  'default-name': 'warning', 'detached-component': 'warning', 'no-autolayout': 'warning', 'empty-container': 'info'
};
const wcagLevelMap = {
  'wcag-contrast': 'aa', 'wcag-target-size': 'aa', 'wcag-non-text-contrast': 'aa', 'wcag-color-only': 'a',
  'wcag-focus-indicator': 'aa', 'wcag-text-size': 'best-practice', 'wcag-line-height': 'best-practice',
  'wcag-letter-spacing': 'best-practice', 'wcag-paragraph-spacing': 'best-practice', 'wcag-image-alt': 'a',
  'wcag-heading-hierarchy': 'a', 'wcag-reflow': 'aa', 'wcag-reading-order': 'a', 'wcag-disabled-no-context': 'aa',
  'token-misuse': 'design-system', 'hardcoded-color': 'design-system', 'no-text-style': 'design-system',
  'default-name': 'design-system', 'detached-component': 'design-system', 'no-autolayout': 'design-system',
  'empty-container': 'design-system'
};
const ruleDescriptions = {
  'wcag-contrast': 'Text below WCAG AA contrast (4.5:1 normal, 3:1 large ≥24px or ≥18.5px bold) (1.4.3).',
  'wcag-text-size': 'Text below 12px — readability best practice (not a literal 1.4.4 failure).',
  'wcag-target-size': 'Interactive element smaller than 24x24px minimum target size (2.5.8).',
  'wcag-line-height': 'Line height below 1.5x font size — best practice (1.4.12 is about user overrides).',
  'wcag-non-text-contrast': 'UI component/border below 3:1 against adjacent color (1.4.11).',
  'wcag-color-only': 'State conveyed only by color, no icon/text/border (1.4.1).',
  'wcag-focus-indicator': 'Interactive component missing focus variant or visible focus indicator (2.4.7).',
  'wcag-letter-spacing': 'Negative letter spacing harms readability (1.4.12).',
  'wcag-paragraph-spacing': 'Paragraph spacing below 2x font size — best practice (1.4.12).',
  'wcag-image-alt': 'Image fill with no description for alt text; mark decorative if presentational (1.1.1).',
  'wcag-heading-hierarchy': 'Heading levels skip a level, e.g. H1 → H3 (1.3.1).',
  'wcag-reflow': 'Fixed-position frame without auto-layout; cannot reflow at 400% zoom (1.4.10).',
  'wcag-reading-order': 'Visual position does not match layer order (1.3.2).',
  'wcag-disabled-no-context': 'Disabled variant has no tooltip/helper/annotation explaining why (4.1.2).',
  'token-misuse': 'Variable name prefix mismatches usage (e.g. a bg/* token used as a text fill).',
  'hardcoded-color': 'Fill color not bound to a variable or style.',
  'no-text-style': 'Text node not using a text style.',
  'default-name': 'Node has a default Figma name (e.g. "Frame 1").',
  'detached-component': 'Frame uses component naming ("/") but is not a component or instance.',
  'no-autolayout': 'Frame with multiple children does not use auto-layout.',
  'empty-container': 'Frame has no children.'
};
const defaultNameRegex = /^(Frame|Rectangle|Ellipse|Line|Text|Group|Component|Instance|Vector|Polygon|Star|Section)(\s+\d+)?$/;
const interactiveNameRegex = /button|link|input|checkbox|radio|switch|toggle|tab|menu-item/i;

// ---- Resolve active rule set ----
const activeRuleSet = {};
for (const r of RULES) {
  if (ruleGroups[r]) for (const g of ruleGroups[r]) activeRuleSet[g] = true;
  else if (severityMap[r]) activeRuleSet[r] = true;
}

// ---- Resolve root node ----
let rootNode = NODE_ID ? await figma.getNodeByIdAsync(NODE_ID) : figma.currentPage;
if (!rootNode) throw new Error('Node not found: ' + NODE_ID);

// ---- Context for design-system rules ----
const variableNameById = {};
if (activeRuleSet['token-misuse']) {
  try { for (const v of await figma.variables.getLocalVariablesAsync()) variableNameById[v.id] = v.name; } catch (e) {}
}

// ---- Findings ----
const findings = {};
for (const id of allRuleIds) if (activeRuleSet[id]) findings[id] = [];
let totalFindings = 0, nodesScanned = 0, truncated = false;
const headingSequence = [];

function push(rule, obj) {
  if (totalFindings < MAX_FINDINGS) { findings[rule].push(obj); totalFindings++; }
  else truncated = true;
}

function walk(node, depth) {
  if (depth > MAX_DEPTH || truncated) return;
  nodesScanned++;
  let type, name, id;
  try { type = node.type; name = node.name; id = node.id; } catch (e) { return; }
  const isPage = type === 'PAGE', isSection = type === 'SECTION';

  // wcag-contrast (TEXT)
  if (activeRuleSet['wcag-contrast'] && type === 'TEXT' && !truncated) {
    try {
      const fills = node.fills;
      if (fills && fills.length) for (const f of fills) {
        if (f.type === 'SOLID' && f.visible !== false) {
          const fg = f.color, bg = getEffectiveBg(node);
          const ratio = contrastRatio(fg.r, fg.g, fg.b, bg.r, bg.g, bg.b);
          let fontSize = 16, fontWeight = null;
          try { fontSize = node.fontSize; } catch (e) {}
          try { fontWeight = node.fontWeight; } catch (e) {}
          if (typeof fontSize !== 'number') fontSize = 16;
          const required = isLargeText(fontSize, fontWeight) ? 3.0 : 4.5;
          const fgOp = f.opacity === undefined ? 1 : f.opacity;
          if (ratio < required) {
            const finding = { id, name, ratio: ratio.toFixed(1) + ':1', required: required.toFixed(1) + ':1', fg: rgbToHex(fg.r, fg.g, fg.b), bg: rgbToHex(bg.r, bg.g, bg.b) };
            if (fgOp < 1 || bg.opacity < 1) finding.approximate = true;
            push('wcag-contrast', finding);
          }
          break;
        }
      }
    } catch (e) {}
  }

  // wcag-text-size (TEXT < 12)
  if (activeRuleSet['wcag-text-size'] && type === 'TEXT' && !truncated) {
    try { const ts = node.fontSize; if (typeof ts === 'number' && ts < 12) push('wcag-text-size', { id, name, fontSize: ts }); } catch (e) {}
  }

  // wcag-target-size (interactive < 24)
  if (activeRuleSet['wcag-target-size'] && !isPage && !isSection && !truncated) {
    try {
      if (['FRAME', 'COMPONENT', 'INSTANCE', 'COMPONENT_SET'].includes(type) && interactiveNameRegex.test(name)) {
        const w = node.width, h = node.height;
        if ((typeof w === 'number' && w < 24) || (typeof h === 'number' && h < 24)) push('wcag-target-size', { id, name, width: w, height: h });
      }
    } catch (e) {}
  }

  // wcag-line-height (TEXT < 1.5x)
  if (activeRuleSet['wcag-line-height'] && type === 'TEXT' && !truncated) {
    try {
      const lh = node.lineHeight, fs = node.fontSize;
      let eff = null;
      if (lh && typeof fs === 'number' && typeof lh === 'object' && typeof lh.value === 'number') {
        if (lh.unit === 'PIXELS') eff = lh.value;
        else if (lh.unit === 'PERCENT') eff = fs * (lh.value / 100);
      }
      if (eff !== null && eff < 1.5 * fs) push('wcag-line-height', { id, name, lineHeight: eff, fontSize: fs, recommended: (1.5 * fs).toFixed(1) });
    } catch (e) {}
  }

  // wcag-non-text-contrast (interactive UI fill/stroke vs bg, 3:1)
  if (activeRuleSet['wcag-non-text-contrast'] && !isPage && !isSection && !truncated) {
    try {
      if (['FRAME', 'COMPONENT', 'INSTANCE', 'COMPONENT_SET'].includes(type) && interactiveNameRegex.test(name)) {
        const fill = getFillColor(node), stroke = getStrokeColor(node), bg = getEffectiveBg(node);
        if (fill) {
          const r = contrastRatio(fill.r, fill.g, fill.b, bg.r, bg.g, bg.b);
          if (r < 3.0) push('wcag-non-text-contrast', { id, name, ratio: r.toFixed(1) + ':1', required: '3.0:1', component: rgbToHex(fill.r, fill.g, fill.b), bg: rgbToHex(bg.r, bg.g, bg.b), element: 'fill' });
        }
        if (stroke && !truncated) {
          const r = contrastRatio(stroke.r, stroke.g, stroke.b, bg.r, bg.g, bg.b);
          if (r < 3.0) push('wcag-non-text-contrast', { id, name, ratio: r.toFixed(1) + ':1', required: '3.0:1', component: rgbToHex(stroke.r, stroke.g, stroke.b), bg: rgbToHex(bg.r, bg.g, bg.b), element: 'stroke' });
        }
      }
    } catch (e) {}
  }

  // wcag-color-only (state variants differ only by color)
  if (activeRuleSet['wcag-color-only'] && type === 'COMPONENT_SET' && !truncated) {
    try {
      const variants = node.children;
      if (variants && variants.length >= 2) {
        for (const variant of variants) {
          if (truncated) break;
          try {
            const vName = variant.name.toLowerCase();
            if (/(error|warning|danger|success|invalid|alert)/.test(vName) && !hasNonColorIndicator(variant)) {
              let def = null;
              for (let d = 0; d < variants.length; d++) {
                if (/(default|rest|idle|normal|base)/.test(variants[d].name.toLowerCase()) || d === 0) { def = variants[d]; break; }
              }
              if (def) {
                const vf = getFillColor(variant), df = getFillColor(def);
                if (vf && df && (vf.r !== df.r || vf.g !== df.g || vf.b !== df.b))
                  push('wcag-color-only', { id: variant.id, name: name + ' / ' + variant.name, variantColor: rgbToHex(vf.r, vf.g, vf.b), defaultColor: rgbToHex(df.r, df.g, df.b), suggestion: 'Add an icon, text label, or border to differentiate this state beyond color alone' });
              }
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
  }

  // wcag-focus-indicator (interactive component set missing focus variant / indicator)
  if (activeRuleSet['wcag-focus-indicator'] && type === 'COMPONENT_SET' && !truncated) {
    try {
      if (interactiveNameRegex.test(name)) {
        let focusNode = null;
        const variants = node.children || [];
        for (const v of variants) if (/focus|focused/.test(v.name.toLowerCase())) { focusNode = v; break; }
        if (!focusNode) {
          push('wcag-focus-indicator', { id, name, issue: 'missing-variant', suggestion: 'Add a focus/focused variant with a visible focus ring or outline' });
        } else {
          let hasEffect = false;
          try { for (const e2 of (focusNode.effects || [])) if (e2.visible !== false && (e2.type === 'DROP_SHADOW' || e2.type === 'INNER_SHADOW')) { hasEffect = true; break; } } catch (e) {}
          if (!getStrokeColor(focusNode) && !hasEffect)
            push('wcag-focus-indicator', { id: focusNode.id, name: name + ' / ' + focusNode.name, issue: 'no-visible-indicator', suggestion: 'Focus variant exists but has no visible border, outline, or shadow' });
        }
      }
    } catch (e) {}
  }

  // wcag-letter-spacing (negative)
  if (activeRuleSet['wcag-letter-spacing'] && type === 'TEXT' && !truncated) {
    try {
      const ls = node.letterSpacing;
      if (ls && typeof ls === 'object' && typeof ls.value === 'number' && ls.value < 0)
        push('wcag-letter-spacing', { id, name, letterSpacing: ls.value + (ls.unit === 'PERCENT' ? '%' : 'px') });
    } catch (e) {}
  }

  // wcag-paragraph-spacing (< 2x font size)
  if (activeRuleSet['wcag-paragraph-spacing'] && type === 'TEXT' && !truncated) {
    try {
      const ps = node.paragraphSpacing, fs = node.fontSize;
      if (typeof ps === 'number' && typeof fs === 'number' && ps > 0 && ps < 2 * fs)
        push('wcag-paragraph-spacing', { id, name, paragraphSpacing: ps, fontSize: fs, recommended: 2 * fs });
    } catch (e) {}
  }

  // wcag-image-alt (image fill without description)
  if (activeRuleSet['wcag-image-alt'] && !isPage && !isSection && !truncated) {
    try {
      let hasImage = false;
      for (const f of (node.fills || [])) if (f.type === 'IMAGE' && f.visible !== false) { hasImage = true; break; }
      if (hasImage) {
        let hasDesc = false; try { if (node.description && node.description.trim().length) hasDesc = true; } catch (e) {}
        const decorative = name.toLowerCase().indexOf('decorative') !== -1;
        if (!hasDesc && !decorative)
          push('wcag-image-alt', { id, name, suggestion: 'Add a description in the node\'s description field, or name it "decorative" if purely presentational' });
      }
    } catch (e) {}
  }

  // wcag-heading-hierarchy (collect; validated after walk)
  if (activeRuleSet['wcag-heading-hierarchy'] && type === 'TEXT' && !truncated) {
    try { const lvl = getHeadingLevel(node); if (lvl > 0) headingSequence.push({ level: lvl, id, name }); } catch (e) {}
  }

  // wcag-reflow (fixed-position frame, 3+ absolutely placed children)
  if (activeRuleSet['wcag-reflow'] && !isPage && !isSection && !truncated) {
    try {
      if ((type === 'FRAME' || type === 'COMPONENT') && node.children && node.children.length >= 3) {
        let layoutMode = 'NONE'; try { layoutMode = node.layoutMode; } catch (e) {}
        if (!layoutMode || layoutMode === 'NONE') {
          const xs = [], ys = [];
          for (let i = 0; i < Math.min(node.children.length, 10); i++) { try { xs.push(node.children[i].x); ys.push(node.children[i].y); } catch (e) {} }
          const ux = [...new Set(xs)], uy = [...new Set(ys)];
          if (xs.length >= 3 && ux.length > 2 && uy.length > 2)
            push('wcag-reflow', { id, name, childCount: node.children.length, suggestion: 'Convert to auto-layout so content can reflow at different viewport sizes' });
        }
      }
    } catch (e) {}
  }

  // wcag-reading-order (visual order vs layer order)
  if (activeRuleSet['wcag-reading-order'] && !isPage && !isSection && !truncated) {
    try {
      if (['FRAME', 'COMPONENT', 'INSTANCE'].includes(type) && node.children && node.children.length >= 2) {
        let layoutMode = 'NONE'; try { layoutMode = node.layoutMode; } catch (e) {}
        if (!layoutMode || layoutMode === 'NONE') {
          const positions = [];
          for (let i = 0; i < node.children.length; i++) { try { positions.push({ index: i, x: node.children[i].x, y: node.children[i].y }); } catch (e) {} }
          if (positions.length >= 2) {
            const visual = positions.slice().sort((a, b) => Math.abs(a.y - b.y) > 10 ? a.y - b.y : a.x - b.x);
            let mismatches = 0;
            for (let i = 0; i < visual.length; i++) if (visual[i].index !== i) mismatches++;
            if (mismatches > positions.length * 0.3 && mismatches >= 2)
              push('wcag-reading-order', { id, name, childCount: positions.length, mismatches, suggestion: 'Reorder layers to match visual top-to-bottom, left-to-right reading order' });
          }
        }
      }
    } catch (e) {}
  }

  // wcag-disabled-no-context (disabled variant without tooltip/helper/annotation)
  if (activeRuleSet['wcag-disabled-no-context'] && type === 'COMPONENT_SET' && !truncated) {
    try {
      const ctxRegex = /tooltip|helper|hint|description|message|caption|note|info|why|reason/i;
      for (const variant of (node.children || [])) {
        if (truncated) break;
        try {
          if (/(disabled|inactive)/i.test(variant.name || '')) {
            let hasCtx = false;
            for (const c of (variant.children || [])) {
              try {
                if (ctxRegex.test((c.name || '').toLowerCase())) { hasCtx = true; break; }
                for (const gc of (c.children || [])) if (/tooltip|helper|hint|description|message/i.test(gc.name || '')) { hasCtx = true; break; }
                if (hasCtx) break;
              } catch (e) {}
            }
            let hasAnnotation = false;
            try { if (/disabled.*tooltip|disabled.*helper|disabled.*hint|aria-disabled|why.*disabled|disabled.*reason/i.test((node.description || '').toLowerCase())) hasAnnotation = true; } catch (e) {}
            if (!hasCtx && !hasAnnotation)
              push('wcag-disabled-no-context', { id: variant.id, name: name + ' / ' + variant.name, suggestion: 'Disabled elements should stay focusable (aria-disabled, not HTML disabled). Add a tooltip or helper text explaining why.' });
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  // token-misuse (bg token as text fill, or text token as background)
  if (activeRuleSet['token-misuse'] && !isPage && !isSection && !truncated) {
    try {
      for (const f of (node.fills || [])) {
        if (f.type === 'SOLID' && f.visible !== false && f.boundVariables && f.boundVariables.color) {
          const vName = (variableNameById[f.boundVariables.color.id] || '').toLowerCase();
          if (!vName) continue;
          const isBgToken = /^(bg|background|surface|fill)[\/-]/.test(vName);
          const isTextToken = /^(text|fg|foreground|font)[\/-]/.test(vName);
          if (type === 'TEXT' && isBgToken)
            push('token-misuse', { id, name, variable: variableNameById[f.boundVariables.color.id], usage: 'text fill', expectedPrefix: 'text/*, fg/*, foreground/*', suggestion: 'Text uses a background/surface token as fill — likely misbound; use a text/foreground token.' });
          if (['FRAME', 'COMPONENT', 'INSTANCE', 'RECTANGLE'].includes(type) && isTextToken && !truncated)
            push('token-misuse', { id, name, variable: variableNameById[f.boundVariables.color.id], usage: 'background fill', expectedPrefix: 'bg/*, background/*, surface/*', suggestion: 'Container uses a text/foreground token as background — likely misbound; use a background/surface token.' });
        }
      }
    } catch (e) {}
  }

  // hardcoded-color (solid fill, no style or bound variable)
  if (activeRuleSet['hardcoded-color'] && !isPage && !isSection && !truncated) {
    try {
      const fills = node.fills;
      if (fills && fills.length) {
        let hasStyle = false; try { hasStyle = node.fillStyleId && node.fillStyleId !== ''; } catch (e) {}
        if (!hasStyle) for (const f of fills) {
          if (f.type === 'SOLID' && f.visible !== false) {
            let bound = false; try { if (f.boundVariables && f.boundVariables.color) bound = true; } catch (e) {}
            if (!bound) { push('hardcoded-color', { id, name, color: rgbToHex(f.color.r, f.color.g, f.color.b) }); break; }
          }
        }
      }
    } catch (e) {}
  }

  // no-text-style
  if (activeRuleSet['no-text-style'] && type === 'TEXT' && !truncated) {
    try { if (!(node.textStyleId && node.textStyleId !== '')) push('no-text-style', { id, name }); } catch (e) {}
  }

  // default-name
  if (activeRuleSet['default-name'] && !isPage && !truncated) {
    try { if (defaultNameRegex.test(name)) push('default-name', { id, name, type }); } catch (e) {}
  }

  // detached-component (frame named like a component)
  if (activeRuleSet['detached-component'] && type === 'FRAME' && !truncated) {
    try { if (name.indexOf('/') !== -1) push('detached-component', { id, name }); } catch (e) {}
  }

  // no-autolayout (2+ children, no auto-layout)
  if (activeRuleSet['no-autolayout'] && !isPage && !isSection && !truncated) {
    try {
      if (['FRAME', 'COMPONENT', 'COMPONENT_SET'].includes(type)) {
        const count = node.children ? node.children.length : 0;
        let layoutMode = 'NONE'; try { layoutMode = node.layoutMode; } catch (e) {}
        if (count >= 2 && (!layoutMode || layoutMode === 'NONE')) push('no-autolayout', { id, name, childCount: count });
      }
    } catch (e) {}
  }

  // empty-container
  if (activeRuleSet['empty-container'] && !isPage && !isSection && !truncated) {
    try { if (type === 'FRAME' && (!node.children || node.children.length === 0)) push('empty-container', { id, name }); } catch (e) {}
  }

  // recurse
  try { if (node.children) for (const c of node.children) { if (truncated) break; walk(c, depth + 1); } } catch (e) {}
}

walk(rootNode, 0);

// ---- Post-walk: heading hierarchy ----
if (activeRuleSet['wcag-heading-hierarchy'] && headingSequence.length >= 2 && !truncated) {
  let prev = 0;
  for (const h of headingSequence) {
    if (prev > 0 && h.level > prev + 1)
      push('wcag-heading-hierarchy', { id: h.id, name: h.name, level: h.level, previousLevel: prev, suggestion: 'Expected H' + (prev + 1) + ' but found H' + h.level + '. Do not skip heading levels.' });
    if (truncated) break;
    prev = h.level;
  }
}

// ---- Build response ----
const categories = [];
const summary = { critical: 0, warning: 0, info: 0, total: 0 };
for (const ruleId of allRuleIds) {
  if (!findings[ruleId] || findings[ruleId].length === 0) continue;
  const sev = severityMap[ruleId];
  categories.push({ rule: ruleId, severity: sev, wcagLevel: wcagLevelMap[ruleId] || null, count: findings[ruleId].length, description: ruleDescriptions[ruleId], nodes: findings[ruleId] });
  summary[sev] = (summary[sev] || 0) + findings[ruleId].length;
  summary.total += findings[ruleId].length;
}

const result = { rootNodeId: rootNode.id, rootNodeName: rootNode.name, nodesScanned, categories, summary };
if (truncated) result.warning = 'Showing first ' + MAX_FINDINGS + ' findings — narrow NODE_ID/RULES or raise MAX_FINDINGS.';
return result;
