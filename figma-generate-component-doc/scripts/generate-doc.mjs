#!/usr/bin/env node
// generate-doc.mjs — deterministic Figma component → Markdown doc generator.
//
// Ports the section generators from figma-console-mcp's src/core/design-code-tools.ts
// (cleanVariantName, parseComponentDescription, generate{Overview,Anatomy,StatesAndVariants,
// VisualSpecs,Typography,ContentGuidelines,Implementation,Accessibility,DesignAnnotations,
// Parity,Changelog}Section) so the SAME collected JSON always yields IDENTICAL Markdown —
// no model freehanding.
//
// Input is the JSON emitted by collect-component-data.js (run via use_figma):
//   { nodeId, name, type, description, descriptionMarkdown, fileUrl?, anatomyTree,
//     variantData[], typography[], spacingTokens[], componentProperties{variants,booleans,textProps},
//     annotations{ node[], children[] } }
//
// Optional --code-info JSON carries the CodeDocInfo shape (props, importStatement, sourceFiles,
// baseComponent, changelog, etc.) and unlocks the Implementation, Parity, and Changelog sections.
//
// Usage:
//   node generate-doc.mjs <collected.json> [--code-info <codeInfo.json>] [--out <file.md>] \
//        [--frontmatter] [--system <name>] [--file-url <url>]
//
// Dependency-free. Node 18+. ESM.

import { readFileSync, writeFileSync } from "node:fs";

// ============================================================================
// CLI parsing
// ============================================================================

function parseArgs(argv) {
	const args = { _: [], frontmatter: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--frontmatter") args.frontmatter = true;
		else if (a === "--code-info") args.codeInfo = argv[++i];
		else if (a === "--out") args.out = argv[++i];
		else if (a === "--system") args.system = argv[++i];
		else if (a === "--file-url") args.fileUrl = argv[++i];
		else args._.push(a);
	}
	return args;
}

// ============================================================================
// Shared helpers (ported)
// ============================================================================

/** Clean a raw Figma variant name like "Type=Image, Size=12" into "Image / 12". */
export function cleanVariantName(rawName) {
	const pairs = String(rawName || "").match(/(\w[\w\s]*)=([^,]+)/g);
	if (!pairs || pairs.length === 0) return rawName;
	const values = pairs.map((p) => {
		const eqIdx = p.indexOf("=");
		return p.slice(eqIdx + 1).trim();
	});
	return values.join(" / ");
}

/** Detect if a node name is a Figma variant pattern like "Variant=Default, State=Hover". */
function isVariantName(name) {
	return /^[A-Za-z]+=.+,.+[A-Za-z]+=/.test(String(name || ""));
}

/** Sanitize a component name for use as a file path. */
export function sanitizeComponentName(name) {
	return String(name || "")
		.replace(/[^a-zA-Z0-9-_ ]/g, "")
		.replace(/\s+/g, "-")
		.trim();
}

// ============================================================================
// Description parser (ported from parseComponentDescription)
// ============================================================================

export function parseComponentDescription(description) {
	const result = {
		overview: "",
		whenToUse: [],
		whenNotToUse: [],
		contentGuidelines: [],
		accessibilityNotes: [],
		additionalNotes: [],
	};

	if (!description) return result;

	const inlineHeaderPatterns = [
		/(?<=[\w.)!?])(When\s+to\s+Use)/gi,
		/(?<=[\w.)!?])(When\s+NOT\s+to\s+Use)/gi,
		/(?<=[\w.)!?])(When\s+to\s+Not\s+Use)/gi,
		/(?<=[\w.)!?])(Don'?t\s+Use)/gi,
		/(?<=[\w.)!?])(Accessibility)/gi,
		/(?<=[\w.)!?])(Content\s+Requirements?)/gi,
		/(?<=[\w.)!?])(Content\s+Guidelines?)/gi,
		/(?<=[\w.)!?])(Writing\s+Guidelines?)/gi,
		/(?<=[\w.)!?])(Variants\b)/gi,
	];
	let normalized = description.replace(/\r\n/g, "\n");
	for (const pattern of inlineHeaderPatterns) {
		normalized = normalized.replace(pattern, "\n$1");
	}

	const lines = normalized.split("\n");

	let currentSection = "overview";
	let currentContentHeading = "";
	const overviewLines = [];

	const plainTextHeaders = [
		{ pattern: /^when\s+to\s+use$/i, section: "when_to_use" },
		{ pattern: /^when\s+not\s+to\s+use$/i, section: "when_not_to_use" },
		{ pattern: /^when\s+to\s+not\s+use$/i, section: "when_not_to_use" },
		{ pattern: /^don'?t\s+use$/i, section: "when_not_to_use" },
		{ pattern: /^do\s+not\s+use$/i, section: "when_not_to_use" },
		{ pattern: /^accessibility$/i, section: "accessibility" },
		{ pattern: /^a11y$/i, section: "accessibility" },
		{ pattern: /^content\s*(requirements|guidelines)?$/i, section: "content", getHeading: true },
		{ pattern: /^writing\s*(guidelines)?$/i, section: "content", getHeading: true },
		{ pattern: /^copy\s*(guidelines)?$/i, section: "content", getHeading: true },
		{ pattern: /^variants$/i, section: "other" },
	];

	const propertyDocPattern = /[–-]\s*Purpose\s*$/i;

	for (const line of lines) {
		const trimmed = line.trim();

		const markdownHeaderMatch = trimmed.match(/^(?:\*\*|###?\s*)(.+?)(?:\*\*)?$/);
		const headerText = markdownHeaderMatch ? markdownHeaderMatch[1].trim().replace(/\*\*/g, "") : null;

		const rawTextForPropertyCheck = headerText || trimmed;
		if (propertyDocPattern.test(rawTextForPropertyCheck)) {
			currentSection = "other";
			continue;
		}

		let plainMatch = null;
		if (!headerText) {
			for (const ph of plainTextHeaders) {
				if (ph.pattern.test(trimmed)) {
					plainMatch = { section: ph.section, heading: ph.getHeading ? trimmed : "" };
					break;
				}
			}
		}

		const effectiveHeader = headerText || (plainMatch ? plainMatch.heading : null) || null;
		const isHeader = headerText !== null || plainMatch !== null;

		if (isHeader) {
			if (plainMatch) {
				if (plainMatch.section === "content" && plainMatch.heading) {
					currentContentHeading = plainMatch.heading;
					result.contentGuidelines.push({ heading: plainMatch.heading, items: [] });
				}
				currentSection = plainMatch.section;
				continue;
			}

			const lower = (effectiveHeader || "").toLowerCase();
			if (lower.includes("when to use") && !lower.includes("not")) {
				currentSection = "when_to_use";
				continue;
			} else if (lower.includes("when not to use") || lower.includes("when to not use") || lower.includes("don't use") || lower.includes("do not use")) {
				currentSection = "when_not_to_use";
				continue;
			} else if (lower.includes("accessibility") || lower.includes("a11y") || lower.includes("aria")) {
				currentSection = "accessibility";
				continue;
			} else if (lower.includes("content") || lower.includes("title text") || lower.includes("description text") || lower.includes("button label") || lower.includes("writing") || lower.includes("copy")) {
				currentSection = "content";
				currentContentHeading = effectiveHeader || "";
				result.contentGuidelines.push({ heading: effectiveHeader || "", items: [] });
				continue;
			} else if (currentSection === "overview") {
				currentSection = "other";
				if (lower.includes("title") || lower.includes("description") || lower.includes("label") || lower.includes("variant")) {
					currentSection = "content";
					currentContentHeading = effectiveHeader || "";
					result.contentGuidelines.push({ heading: effectiveHeader || "", items: [] });
					continue;
				}
			} else if (currentSection === "content") {
				currentContentHeading = effectiveHeader || "";
				result.contentGuidelines.push({ heading: effectiveHeader || "", items: [] });
				continue;
			}
		}

		if (!trimmed) continue;
		if (/^---+$/.test(trimmed)) continue;

		const bulletMatch = trimmed.match(/^[-*•]\s*(.+)/);
		const content = bulletMatch ? bulletMatch[1] : trimmed;

		switch (currentSection) {
			case "overview":
				overviewLines.push(content);
				break;
			case "when_to_use":
				result.whenToUse.push(content);
				break;
			case "when_not_to_use":
				result.whenNotToUse.push(content);
				break;
			case "content": {
				const last = result.contentGuidelines[result.contentGuidelines.length - 1];
				if (last) last.items.push(content);
				break;
			}
			case "accessibility":
				result.accessibilityNotes.push(content);
				break;
			case "other":
				result.additionalNotes.push(content);
				break;
		}
	}

	result.overview = overviewLines.join(" ").trim();
	return result;
}

// ============================================================================
// Section generators (ported, adapted to consume the collected JSON shape)
// ============================================================================

function generateFrontmatter(componentName, description, collected, fileUrl, codeInfo, canonicalSource) {
	const status = codeInfo?.changelog?.[0]
		? "stable"
		: (description || "").toLowerCase().includes("deprecated")
			? "deprecated"
			: "stable";
	const version = codeInfo?.changelog?.[0]?.version || "1.0.0";
	const tags = [componentName.toLowerCase()];
	if (collected.type === "COMPONENT_SET") tags.push("variants");
	const hasProps = collected.componentProperties &&
		((collected.componentProperties.variants || []).length +
			(collected.componentProperties.booleans || []).length +
			(collected.componentProperties.textProps || []).length) > 0;
	if (hasProps) tags.push("configurable");

	const lines = [
		"---",
		`title: ${componentName}`,
		`description: ${(description.split(/(?:When to Use|When NOT to Use|Variants|Content Requirements|Accessibility)/i)[0] || description).replace(/\n/g, " ").replace(/\s+/g, " ").trim() || `${componentName} component`}`,
		`status: ${status}`,
		`version: ${version}`,
		`category: components`,
		`tags: [${tags.join(", ")}]`,
		`figma: ${fileUrl}`,
	];

	if (codeInfo?.filePath) lines.push(`source: ${codeInfo.filePath}`);
	if (codeInfo?.packageName) lines.push(`package: ${codeInfo.packageName}`);
	if (canonicalSource) lines.push(`canonical: ${canonicalSource}`);

	lines.push(`lastUpdated: ${new Date().toISOString().split("T")[0]}`);
	lines.push("---");
	return lines.join("\n");
}

function generateOverviewSection(componentName, description, fileUrl, parsedDesc, codeInfo) {
	const lines = [`# ${componentName}`, ""];

	const links = [`**[Open in Figma](${fileUrl})**`];
	if (codeInfo?.filePath) links.push(`**[View Source](${codeInfo.filePath})**`);
	const storiesFile = (codeInfo?.sourceFiles || []).find(
		(f) => f.role.toLowerCase().includes("storybook") || f.role.toLowerCase().includes("stories") || f.path.includes(".stories."),
	);
	if (storiesFile) links.push(`**[Storybook](${storiesFile.path})**`);
	lines.push(links.join(" | "));
	lines.push("");

	lines.push("## Overview");
	lines.push("");

	const overviewText = parsedDesc.overview || description?.split("\n")[0] || `The ${componentName} component.`;
	lines.push(overviewText);
	lines.push("");

	if (codeInfo?.baseComponent) {
		const baseLink = codeInfo.baseComponent.url
			? `[${codeInfo.baseComponent.name}](${codeInfo.baseComponent.url})`
			: codeInfo.baseComponent.name;
		if (codeInfo.baseComponent.description) {
			lines.push(`Built on ${baseLink}, ${codeInfo.baseComponent.description}`);
		} else {
			lines.push(`Built on ${baseLink}.`);
		}
		lines.push("");
	}

	if (parsedDesc.whenToUse.length > 0) {
		lines.push("### When to Use");
		lines.push("");
		for (const item of parsedDesc.whenToUse) lines.push(`- ${item}`);
		lines.push("");
	}

	if (parsedDesc.whenNotToUse.length > 0) {
		lines.push("### When NOT to Use");
		lines.push("");
		for (const item of parsedDesc.whenNotToUse) lines.push(`- ${item}`);
		lines.push("");
	}

	return lines.join("\n");
}

function generateAnatomySection(collected) {
	const lines = ["", "## Component Anatomy", ""];

	const variantNames = (collected.variantData || []).map((v) => v.variantName);
	if (collected.type === "COMPONENT_SET" && variantNames.length > 0) {
		lines.push(`**${variantNames.length} variants:**`);
		for (const name of variantNames) lines.push(`- ${cleanVariantName(name || "Unknown")}`);
		lines.push("");
	}

	lines.push("### Design Structure (Figma)");
	lines.push("");

	const tree = collected.anatomyTree || "";
	lines.push("```");
	lines.push(tree);
	lines.push("```");
	lines.push("");

	return lines.join("\n");
}

function generateStatesAndVariantsSection(collected) {
	const cp = collected.componentProperties || {};
	const variants = cp.variants || [];
	const booleans = cp.booleans || [];
	const textProps = cp.textProps || [];
	const variantData = collected.variantData || [];

	if (variants.length === 0 && booleans.length === 0 && textProps.length === 0) return "";

	const lines = ["", "## Variants", ""];

	// Variant matrix with per-variant color data
	if (variants.length > 0 && variantData.length > 0) {
		lines.push("### Variant Matrix");
		lines.push("");

		const hasIcons = variantData.some((v) => (v.icons || []).length > 0);
		const hasFills = variantData.some((v) => (v.fills || []).length > 0);

		if (hasFills || hasIcons) {
			const headerParts = ["Variant", "Background"];
			if (hasIcons) headerParts.push("Icon");
			headerParts.push("Text/Icon Color");
			lines.push("| " + headerParts.join(" | ") + " |");

			const separatorParts = ["--------", "----------"];
			if (hasIcons) separatorParts.push("----");
			separatorParts.push("---------------");
			lines.push("|" + separatorParts.join("|") + "|");

			for (const vd of variantData) {
				const displayName = cleanVariantName(vd.variantName);

				const bgFill = (vd.fills || [])[0];
				const bgVal = bgFill
					? (bgFill.variableName ? `\`${bgFill.variableName}\` (${bgFill.hex})` : bgFill.hex)
					: "—";

				const textColor = (vd.textColors || [])[0] || (vd.strokes || [])[0];
				const textVal = textColor
					? (textColor.variableName ? `\`${textColor.variableName}\` (${textColor.hex})` : textColor.hex)
					: "—";

				const rowParts = [`**${displayName}**`, bgVal];
				if (hasIcons) {
					const icon = (vd.icons || [])[0]?.name || "—";
					rowParts.push(icon);
				}
				rowParts.push(textVal);
				lines.push("| " + rowParts.join(" | ") + " |");
			}
			lines.push("");
		}

		if (hasIcons) {
			lines.push("### Icon Mapping");
			lines.push("");
			lines.push("| Variant | Figma Icon Instance |");
			lines.push("|---------|---------------------|");
			for (const vd of variantData) {
				const displayName = cleanVariantName(vd.variantName);
				const icon = (vd.icons || [])[0]?.name || "—";
				lines.push(`| ${displayName} | ${icon} |`);
			}
			lines.push("");
		}
	} else if (variants.length > 0) {
		lines.push("| Variant | Values | Default |");
		lines.push("|---------|--------|---------|");
		for (const v of variants) {
			lines.push(`| ${v.name} | ${(v.values || []).join(", ")} | ${v.defaultValue} |`);
		}
		lines.push("");
	}

	if (booleans.length > 0 || textProps.length > 0) {
		lines.push("### Configurable Properties");
		lines.push("");
		lines.push("| Property | Type | Default | Description |");
		lines.push("|----------|------|---------|-------------|");

		for (const v of variants) {
			lines.push(`| **${v.name}** | \`${(v.values || []).map((val) => `"${val}"`).join(" \\| ")}\` | \`"${v.defaultValue}"\` | Changes visual treatment |`);
		}
		for (const b of booleans) {
			lines.push(`| **${b.name}** | \`boolean\` | \`${b.defaultValue}\` | Shows/hides ${b.name.toLowerCase()} element |`);
		}
		for (const t of textProps) {
			lines.push(`| **${t.name}** | \`string\` | \`"${t.defaultValue}"\` | Sets ${t.name.toLowerCase()} content |`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

function generateVisualSpecsSection(collected) {
	const lines = ["", "## Token Specification", ""];
	const variantData = collected.variantData || [];

	if (variantData.length > 0) {
		lines.push("### Color Tokens");
		lines.push("");
		lines.push("| Element | Figma Variable | Value |");
		lines.push("|---------|---------------|-------|");

		for (const vd of variantData) {
			const nameMatch = vd.variantName.match(/Variant=([^,]+)/i);
			const displayName = nameMatch ? nameMatch[1].trim() : vd.variantName;

			lines.push(`| **${displayName}** | | |`);

			for (const fill of (vd.fills || [])) {
				const varName = fill.variableName;
				lines.push(`| Background | ${varName ? `\`${varName}\`` : "—"} | ${fill.hex} |`);
			}
			for (const text of (vd.textColors || [])) {
				const varName = text.variableName;
				lines.push(`| Text (${text.nodeName}) | ${varName ? `\`${varName}\`` : "—"} | ${text.hex} |`);
			}
			for (const stroke of (vd.strokes || [])) {
				const varName = stroke.variableName;
				lines.push(`| Stroke | ${varName ? `\`${varName}\`` : "—"} | ${stroke.hex} |`);
			}
		}
		lines.push("");
	}

	const spacingTokens = collected.spacingTokens || [];
	if (spacingTokens.length > 0) {
		lines.push("### Spacing Tokens");
		lines.push("");
		lines.push("| Property | Figma Variable | Value |");
		lines.push("|----------|---------------|-------|");
		for (const token of spacingTokens) {
			const varDisplay = token.variableName ? `\`${token.variableName}\`` : "—";
			lines.push(`| ${token.property} | ${varDisplay} | ${token.value}px |`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

function generateTypographySection(collected) {
	const textStyles = collected.typography || [];
	if (textStyles.length === 0) return "";

	const lines = ["", "## Typography", ""];
	lines.push("| Element | Font | Weight | Size | Line Height | Letter Spacing |");
	lines.push("|---------|------|--------|------|-------------|----------------|");

	const seen = new Set();
	for (const ts of textStyles) {
		const weight = ts.fontWeight ?? 400;
		const weightName = ts.fontWeightName || String(weight);
		const size = ts.fontSize ?? "";
		const lineHeight = ts.lineHeight ?? size;
		const letterSpacing = ts.letterSpacing ?? 0;
		const key = `${ts.fontFamily}:${weight}:${size}:${lineHeight}`;
		if (seen.has(key)) continue;
		seen.add(key);
		lines.push(
			`| ${ts.nodeName} | ${ts.fontFamily} | ${weightName} (${weight}) | ${size}px | ${lineHeight}px | ${letterSpacing === 0 ? "0" : `${letterSpacing}px`} |`,
		);
	}
	lines.push("");

	return lines.join("\n");
}

function generateContentGuidelinesSection(parsedDesc) {
	if (parsedDesc.contentGuidelines.length === 0 && parsedDesc.additionalNotes.length === 0) return "";

	const lines = ["", "## Content Guidelines", ""];

	for (const section of parsedDesc.contentGuidelines) {
		lines.push(`### ${section.heading}`);
		lines.push("");
		for (const item of section.items) lines.push(`- ${item}`);
		lines.push("");
	}

	if (parsedDesc.additionalNotes.length > 0 && parsedDesc.contentGuidelines.length === 0) {
		for (const note of parsedDesc.additionalNotes) lines.push(`- ${note}`);
		lines.push("");
	}

	return lines.join("\n");
}

function generateImplementationSection(codeInfo) {
	if (!codeInfo) return "";

	const lines = ["", "## Implementation", ""];

	if (codeInfo.sourceFiles && codeInfo.sourceFiles.length > 0) {
		lines.push("### Source Files");
		lines.push("");
		lines.push("| File | Role | Variants |");
		lines.push("|------|------|----------|");
		for (const sf of codeInfo.sourceFiles) {
			lines.push(`| \`${sf.path}\` | ${sf.role} | ${sf.variants ?? "—"} |`);
		}
		lines.push("");
	}

	if (codeInfo.importStatement) {
		lines.push("### Import");
		lines.push("");
		lines.push("```tsx");
		lines.push(codeInfo.importStatement);
		lines.push("```");
		lines.push("");
	}

	if (codeInfo.variantDefinition) {
		lines.push("### Variant Definition");
		lines.push("");
		lines.push("```tsx");
		lines.push(codeInfo.variantDefinition);
		lines.push("```");
		lines.push("");
	}

	if (codeInfo.props && codeInfo.props.length > 0) {
		lines.push("### Component API");
		lines.push("");
		lines.push("| Prop | Type | Default | Description |");
		lines.push("|------|------|---------|-------------|");
		for (const p of codeInfo.props) {
			lines.push(
				`| \`${p.name}\` | \`${p.type.replace(/\|/g, "\\|")}\` | ${p.defaultValue ? `\`${p.defaultValue}\`` : "—"} | ${p.description ?? "—"} |`,
			);
		}
		lines.push("");
	}

	if (codeInfo.subComponents && codeInfo.subComponents.length > 0) {
		for (const sub of codeInfo.subComponents) {
			lines.push(`#### ${sub.name}`);
			lines.push("");
			if (sub.description) {
				lines.push(sub.description);
				lines.push("");
			}
			if (sub.element) {
				lines.push(`Renders a \`<${sub.element}>\`${sub.dataSlot ? ` with \`data-slot="${sub.dataSlot}"\`` : ""}.`);
				lines.push("");
			}
			if (sub.props && sub.props.length > 0) {
				lines.push("| Prop | Type | Default | Description |");
				lines.push("|------|------|---------|-------------|");
				for (const p of sub.props) {
					lines.push(
						`| \`${p.name}\` | \`${p.type.replace(/\|/g, "\\|")}\` | ${p.defaultValue ? `\`${p.defaultValue}\`` : "—"} | ${p.description ?? "—"} |`,
					);
				}
				lines.push("");
			}
		}
	}

	if (codeInfo.events && codeInfo.events.length > 0) {
		lines.push("### Events");
		lines.push("");
		lines.push("| Event | Payload | Description |");
		lines.push("|-------|---------|-------------|");
		for (const e of codeInfo.events) {
			lines.push(`| ${e.name} | ${e.payload ?? "—"} | ${e.description ?? "—"} |`);
		}
		lines.push("");
	}

	if (codeInfo.slots && codeInfo.slots.length > 0) {
		lines.push("### Slots");
		lines.push("");
		for (const s of codeInfo.slots) {
			lines.push(`- **${s.name}**: ${s.description ?? ""}`);
		}
		lines.push("");
	}

	if (codeInfo.usageExamples && codeInfo.usageExamples.length > 0) {
		lines.push("### Usage Examples");
		lines.push("");
		for (const ex of codeInfo.usageExamples) {
			lines.push(`#### ${ex.title}`);
			lines.push("");
			lines.push(`\`\`\`${ex.language || "tsx"}`);
			lines.push(ex.code);
			lines.push("```");
			lines.push("");
		}
	}

	return lines.join("\n");
}

function generateAccessibilitySection(collected, parsedDesc) {
	const lines = ["", "## Accessibility", ""];

	if (parsedDesc.accessibilityNotes.length > 0) {
		for (const note of parsedDesc.accessibilityNotes) lines.push(`- ${note}`);
		lines.push("");
	} else {
		const description = collected.descriptionMarkdown || collected.description || "";
		if (description.toLowerCase().includes("aria") || description.toLowerCase().includes("accessibility")) {
			const descLines = description.split("\n");
			for (const line of descLines) {
				const lower = line.toLowerCase();
				if (lower.includes("aria") || lower.includes("accessibility") || lower.includes("screen reader") || lower.includes("keyboard") || lower.includes("focus") || lower.includes("wcag") || lower.includes("contrast")) {
					lines.push(`- ${line.trim().replace(/^[-*•]\s*/, "")}`);
				}
			}
			if (lines.length > 2) {
				lines.push("");
			} else {
				lines.push("_Accessibility mentions found in description but not in structured format. Review the component description for details._");
				lines.push("");
			}
		} else {
			lines.push("_No accessibility annotations found in Figma. Add annotations to the component description._");
			lines.push("");
		}
	}

	return lines.join("\n");
}

function generateDesignAnnotationsSection(collected) {
	// Annotations on the node itself (the source generator reads node.annotations).
	const annotations = (collected.annotations && collected.annotations.node) || [];

	if (annotations.length === 0) {
		return [
			"",
			"## Design Annotations",
			"",
			"_No design annotations found on this node. Designers can add annotations in Dev Mode to specify animation timings, easing curves, interaction behaviors, and other implementation details._",
			"_Use `figma_get_annotations` with `include_children=true` to check child nodes for annotations._",
			"",
		].join("\n");
	}

	const lines = ["", "## Design Annotations", ""];
	lines.push(`Found **${annotations.length}** annotation(s) on this component:`, "");

	for (let i = 0; i < annotations.length; i++) {
		const ann = annotations[i];
		const num = i + 1;

		const categoryLabel = ann.categoryName ? ` (${ann.categoryName})` : (ann.categoryId ? ` (category: ${ann.categoryId})` : "");
		lines.push(`### Annotation ${num}${categoryLabel}`);
		lines.push("");

		if (ann.labelMarkdown) {
			lines.push(ann.labelMarkdown);
			lines.push("");
		} else if (ann.label) {
			lines.push(ann.label);
			lines.push("");
		}

		if (ann.properties && ann.properties.length > 0) {
			lines.push("**Pinned Properties:**");
			for (const prop of ann.properties) lines.push(`- \`${prop.type}\``);
			lines.push("");
		}
	}

	return lines.join("\n");
}

function generateParitySection(collected, codeInfo) {
	const lines = ["", "## Design-Code Parity", ""];

	const figmaVariantsRaw = new Map(); // lowercase → original name
	if (collected.type === "COMPONENT_SET") {
		for (const vd of (collected.variantData || [])) {
			const name = vd.variantName || "";
			const match = name.match(/Variant=([^,]+)/i) || name.match(/^([^,=]+)/);
			if (match) {
				const raw = match[1].trim();
				figmaVariantsRaw.set(raw.toLowerCase(), raw);
			}
		}
	}

	const codeVariantsRaw = new Map(); // lowercase → original name
	if (codeInfo.props) {
		const variantProp = codeInfo.props.find((p) => p.name.toLowerCase() === "variant");
		if (variantProp?.type) {
			const matches = variantProp.type.match(/["']([^"']+)["']/g);
			if (matches) {
				for (const m of matches) {
					const raw = m.replace(/["']/g, "");
					codeVariantsRaw.set(raw.toLowerCase(), raw);
				}
			}
		}
	}

	if (figmaVariantsRaw.size > 0 || codeVariantsRaw.size > 0) {
		const allKeys = new Set([...figmaVariantsRaw.keys(), ...codeVariantsRaw.keys()]);

		lines.push("### Variant Coverage");
		lines.push("");
		lines.push("| Variant | In Figma | In Code | Status |");
		lines.push("|---------|----------|---------|--------|");

		for (const key of allKeys) {
			const figmaName = figmaVariantsRaw.get(key);
			const codeName = codeVariantsRaw.get(key);
			const displayName = figmaName || codeName || key;
			const inFigma = figmaVariantsRaw.has(key);
			const inCode = codeVariantsRaw.has(key);
			let status;
			if (inFigma && inCode) status = "In sync";
			else if (inFigma && !inCode) status = "Figma-only — needs code variant";
			else status = "Code-only — needs Figma variant";
			lines.push(`| ${displayName} | ${inFigma ? "Yes" : "**No**"} | ${inCode ? "Yes" : "**No**"} | ${status} |`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

function generateChangelogSection(codeInfo) {
	if (!codeInfo?.changelog || codeInfo.changelog.length === 0) return "";

	const lines = ["", "## Changelog", ""];
	lines.push("| Version | Date | Changes |");
	lines.push("|---------|------|---------|");
	for (const entry of codeInfo.changelog) {
		lines.push(`| ${entry.version} | ${entry.date} | ${entry.changes} |`);
	}
	lines.push("");

	return lines.join("\n");
}

// ============================================================================
// Orchestrator (mirrors figma_generate_component_doc assembly order)
// ============================================================================

export function generateComponentDoc(collected, options = {}) {
	const { codeInfo = null, includeFrontmatter = false, fileUrl: fileUrlOverride } = options;

	const componentName = collected.name || "Component";
	const description = collected.descriptionMarkdown || collected.description || "";

	// fileUrl: explicit override → collected.fileUrl + node-id → placeholder
	let fileUrl;
	if (fileUrlOverride) {
		fileUrl = fileUrlOverride;
	} else if (collected.fileUrl) {
		const nodeParam = collected.nodeId ? `?node-id=${String(collected.nodeId).replace(":", "-")}` : "";
		fileUrl = collected.fileUrl.includes("node-id") ? collected.fileUrl : `${collected.fileUrl}${nodeParam}`;
	} else {
		fileUrl = "https://www.figma.com/file/UNKNOWN";
	}

	const parsedDesc = parseComponentDescription(description);

	const hasCodeInfo = codeInfo !== undefined && codeInfo !== null;
	const hasFigmaData = collected.type === "COMPONENT" || collected.type === "COMPONENT_SET";
	const canonicalSource = hasFigmaData && hasCodeInfo ? "reconciled" : hasCodeInfo ? "code" : "figma";

	const parts = [];

	if (includeFrontmatter) {
		parts.push(generateFrontmatter(componentName, description, collected, fileUrl, codeInfo, canonicalSource));
		parts.push("");
	}

	parts.push(generateOverviewSection(componentName, description, fileUrl, parsedDesc, codeInfo));

	const anatomySection = generateAnatomySection(collected);
	if (anatomySection.trim()) parts.push(anatomySection);

	const variantsSection = generateStatesAndVariantsSection(collected);
	if (variantsSection) parts.push(variantsSection);

	parts.push(generateVisualSpecsSection(collected));

	const typoSection = generateTypographySection(collected);
	if (typoSection) parts.push(typoSection);

	const contentSection = generateContentGuidelinesSection(parsedDesc);
	if (contentSection) parts.push(contentSection);

	if (codeInfo) parts.push(generateImplementationSection(codeInfo));

	parts.push(generateAccessibilitySection(collected, parsedDesc));

	parts.push(generateDesignAnnotationsSection(collected));

	if (hasCodeInfo && hasFigmaData && codeInfo) {
		const paritySection = generateParitySection(collected, codeInfo);
		if (paritySection) parts.push(paritySection);
	}

	if (codeInfo?.changelog) parts.push(generateChangelogSection(codeInfo));

	return parts.join("\n");
}

// ============================================================================
// CLI entry
// ============================================================================

function main() {
	const args = parseArgs(process.argv.slice(2));
	const inputPath = args._[0];

	if (!inputPath) {
		console.error("Usage: node generate-doc.mjs <collected.json> [--code-info <codeInfo.json>] [--out <file.md>] [--frontmatter] [--system <name>] [--file-url <url>]");
		process.exit(1);
	}

	let collected;
	try {
		collected = JSON.parse(readFileSync(inputPath, "utf8"));
	} catch (e) {
		console.error(`Failed to read/parse collected JSON at ${inputPath}: ${e.message}`);
		process.exit(1);
	}

	let codeInfo = null;
	if (args.codeInfo) {
		try {
			codeInfo = JSON.parse(readFileSync(args.codeInfo, "utf8"));
		} catch (e) {
			console.error(`Failed to read/parse code-info JSON at ${args.codeInfo}: ${e.message}`);
			process.exit(1);
		}
	}

	const markdown = generateComponentDoc(collected, {
		codeInfo,
		includeFrontmatter: args.frontmatter,
		fileUrl: args.fileUrl,
	});

	if (args.out) {
		writeFileSync(args.out, markdown, "utf8");
		const sanitized = sanitizeComponentName(collected.name || "component");
		console.error(`Wrote ${markdown.length} bytes to ${args.out} (component: ${sanitized})`);
	} else {
		process.stdout.write(markdown);
	}
}

// Only run main when invoked directly (not when imported for tests).
if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
