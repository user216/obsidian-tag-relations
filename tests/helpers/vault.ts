import { TFile } from "obsidian";

/**
 * An in-memory stand-in for an Obsidian vault, good enough to exercise
 * TagEditor end to end: it stores note text, derives a metadata cache from it
 * (inline tag positions plus frontmatter), and implements the two write APIs
 * the editor uses.
 *
 * The tag scanner here is an approximation of Obsidian's parser, not a
 * reimplementation of it — it deliberately skips fenced code blocks and
 * `#` headings, which is what the real parser does and what the editor
 * depends on. Tests that care about parser fidelity say so explicitly.
 */
export class MockVault {
	files = new Map<string, string>();

	constructor(files: Record<string, string> = {}) {
		for (const [path, content] of Object.entries(files)) {
			this.files.set(path, content);
		}
	}

	read(path: string): string {
		const content = this.files.get(path);
		if (content === undefined) throw new Error(`No such file: ${path}`);
		return content;
	}

	/** The `app` object the plugin code expects. */
	get app(): any {
		const vault = this;
		return {
			vault: {
				getMarkdownFiles: () =>
					Array.from(vault.files.keys()).map((path) => vault.fileAt(path)),
				getAbstractFileByPath: (path: string) =>
					vault.files.has(path) ? vault.fileAt(path) : null,
				process: async (file: { path: string }, fn: (data: string) => string) => {
					const next = fn(vault.read(file.path));
					vault.files.set(file.path, next);
					return next;
				},
			},
			metadataCache: {
				getFileCache: (file: { path: string }) =>
					vault.files.has(file.path) ? parseCache(vault.read(file.path)) : null,
			},
			fileManager: {
				processFrontMatter: async (
					file: { path: string },
					fn: (fm: Record<string, unknown>) => void
				) => {
					const content = vault.read(file.path);
					const { frontmatter, body } = splitFrontmatter(content);
					const fm = frontmatter ? parseYaml(frontmatter) : {};
					fn(fm);
					vault.files.set(file.path, joinFrontmatter(fm, body));
				},
			},
		};
	}

	private fileAt(path: string): TFile {
		const file = new TFile();
		file.path = path;
		const name = path.slice(path.lastIndexOf("/") + 1);
		file.basename = name.replace(/\.md$/, "");
		return file;
	}
}

export function splitFrontmatter(content: string): {
	frontmatter: string | null;
	body: string;
} {
	if (!content.startsWith("---\n")) return { frontmatter: null, body: content };
	const end = content.indexOf("\n---", 3);
	if (end < 0) return { frontmatter: null, body: content };
	const after = content.indexOf("\n", end + 1);
	return {
		frontmatter: content.slice(4, end + 1),
		body: after < 0 ? "" : content.slice(after + 1),
	};
}

/** Minimal YAML: scalars, inline `[a, b]` lists, and `- item` block lists. */
export function parseYaml(text: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const lines = text.split("\n");
	let index = 0;
	while (index < lines.length) {
		const line = lines[index];
		index++;
		const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
		if (!match) continue;
		const [, key, rawValue] = match;
		const value = rawValue.trim();

		if (value.startsWith("[") && value.endsWith("]")) {
			result[key] = value
				.slice(1, -1)
				.split(",")
				.map((part) => part.trim())
				.filter((part) => part.length > 0);
			continue;
		}
		if (value.length > 0) {
			result[key] = value;
			continue;
		}
		// A bare key introduces a block list, if the next lines are items.
		const items: string[] = [];
		while (index < lines.length && /^\s*-\s+/.test(lines[index])) {
			items.push(lines[index].replace(/^\s*-\s+/, "").trim());
			index++;
		}
		result[key] = items;
	}
	return result;
}

export function joinFrontmatter(
	fm: Record<string, unknown>,
	body: string
): string {
	const keys = Object.keys(fm);
	if (keys.length === 0) return body;
	const lines: string[] = ["---"];
	for (const key of keys) {
		const value = fm[key];
		if (Array.isArray(value)) {
			lines.push(`${key}:`);
			for (const item of value) lines.push(`  - ${item}`);
		} else {
			lines.push(`${key}: ${String(value)}`);
		}
	}
	lines.push("---");
	return lines.join("\n") + "\n" + body;
}

/**
 * Derive a metadata cache from note text: inline tags with absolute offsets,
 * plus parsed frontmatter. Fenced code blocks and `# heading` lines are
 * skipped, mirroring how Obsidian decides what counts as a tag.
 */
export function parseCache(content: string): {
	tags: Array<{ tag: string; position: any }>;
	frontmatter?: Record<string, unknown>;
} {
	const { frontmatter, body } = splitFrontmatter(content);
	const bodyOffset = content.length - body.length;

	const tags: Array<{ tag: string; position: any }> = [];
	let inFence = false;
	let cursor = 0;
	for (const line of body.split("\n")) {
		const lineStart = cursor;
		cursor += line.length + 1;

		if (/^\s*```/.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		if (/^\s{0,3}#{1,6}\s/.test(line)) continue; // markdown heading, not a tag

		const pattern = /(^|[\s(\[])#([\p{L}\p{N}_\-/]+)/gu;
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(line)) !== null) {
			const start = lineStart + match.index + match[1].length;
			const tag = "#" + match[2];
			tags.push({
				tag,
				position: {
					start: { offset: bodyOffset + start, line: 0, col: 0 },
					end: { offset: bodyOffset + start + tag.length, line: 0, col: 0 },
				},
			});
		}
	}

	return {
		tags,
		frontmatter: frontmatter ? parseYaml(frontmatter) : undefined,
	};
}
