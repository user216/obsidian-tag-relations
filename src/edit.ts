import { App, TFile, TagCache } from "obsidian";
import { normalizeTag } from "./graph";

/** Where a newly assigned tag is written. */
export type AddLocation = "frontmatter" | "inline";

export interface FileEditPreview {
	path: string;
	/** Matching tags in the note body. */
	inline: number;
	/** Matching tags in the YAML frontmatter. */
	frontmatter: number;
}

export interface EditPlan {
	files: FileEditPreview[];
	occurrences: number;
}

export interface EditOutcome {
	filesChanged: number;
	occurrences: number;
	errors: Array<{ path: string; message: string }>;
}

export interface EditorOptions {
	caseSensitive: boolean;
	addLocation: AddLocation;
}

/** Frontmatter keys Obsidian reads tags from. */
const FRONTMATTER_KEYS = ["tags", "tag"];

/**
 * Applies tag edits to the vault.
 *
 * Every operation is planned before it is applied — a plan is derived purely
 * from the metadata cache (no file reads), so the UI can show exactly what
 * will change before anything is written.
 *
 * Writes go through `vault.process` (atomic read-modify-write) for note bodies
 * and `fileManager.processFrontMatter` for YAML, rather than reading and
 * writing separately. Body edits use the cache's recorded offsets but verify
 * the text at each offset before touching it, so a stale cache skips the hit
 * instead of corrupting the note.
 */
export class TagEditor {
	private app: App;
	private options: () => EditorOptions;

	constructor(app: App, options: () => EditorOptions) {
		this.app = app;
		this.options = options;
	}

	// --- Planning ---------------------------------------------------------

	planRename(from: string, to: string, includeNested: boolean): EditPlan {
		return this.planFor((tag) =>
			this.matches(tag, from, includeNested) ? renameTo(tag, from, to) : null
		);
	}

	/** Notes among `paths` that do not already carry `tag`. */
	planAssign(tag: string, paths: string[]): EditPlan {
		const files: FileEditPreview[] = [];
		for (const path of paths) {
			const file = this.fileAt(path);
			if (!file) continue;
			if (this.tagsOf(file).some((existing) => this.same(existing, tag))) continue;
			files.push({ path, inline: 0, frontmatter: 0 });
		}
		return { files, occurrences: files.length };
	}

	planUnassign(tag: string, paths: string[], includeNested: boolean): EditPlan {
		const scope = new Set(paths);
		return this.planFor(
			(candidate) => (this.matches(candidate, tag, includeNested) ? "" : null),
			scope
		);
	}

	/**
	 * Walk every note (or just `scope`), asking `transform` what each tag
	 * should become: a replacement tag, "" to remove it, or null to leave it.
	 */
	private planFor(
		transform: (tag: string) => string | null,
		scope?: Set<string>
	): EditPlan {
		const files: FileEditPreview[] = [];
		let occurrences = 0;
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (scope && !scope.has(file.path)) continue;
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache) continue;

			let inline = 0;
			for (const hit of cache.tags ?? []) {
				if (transform(hit.tag) !== null) inline++;
			}
			let frontmatter = 0;
			for (const entry of frontmatterTags(cache.frontmatter)) {
				if (transform(entry.normalized) !== null) frontmatter++;
			}
			if (inline + frontmatter > 0) {
				files.push({ path: file.path, inline, frontmatter });
				occurrences += inline + frontmatter;
			}
		}
		files.sort((a, b) => a.path.localeCompare(b.path));
		return { files, occurrences };
	}

	/** Every note carrying `tag` (and its nested children, when asked). */
	filesWithTag(tag: string, includeNested: boolean): string[] {
		const paths: string[] = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (this.tagsOf(file).some((t) => this.matches(t, tag, includeNested))) {
				paths.push(file.path);
			}
		}
		return paths.sort((a, b) => a.localeCompare(b));
	}

	// --- Applying ---------------------------------------------------------

	async applyRename(
		from: string,
		to: string,
		includeNested: boolean
	): Promise<EditOutcome> {
		return this.applyTransform(
			(tag) =>
				this.matches(tag, from, includeNested) ? renameTo(tag, from, to) : null,
			this.planRename(from, to, includeNested)
		);
	}

	async applyUnassign(
		tag: string,
		paths: string[],
		includeNested: boolean
	): Promise<EditOutcome> {
		return this.applyTransform(
			(candidate) => (this.matches(candidate, tag, includeNested) ? "" : null),
			this.planUnassign(tag, paths, includeNested)
		);
	}

	async applyAssign(tag: string, paths: string[]): Promise<EditOutcome> {
		const outcome: EditOutcome = {
			filesChanged: 0,
			occurrences: 0,
			errors: [],
		};
		const location = this.options().addLocation;
		for (const preview of this.planAssign(tag, paths).files) {
			const file = this.fileAt(preview.path);
			if (!file) continue;
			try {
				if (location === "frontmatter") {
					await this.app.fileManager.processFrontMatter(file, (fm) => {
						addToFrontmatter(fm, tag);
					});
				} else {
					await this.app.vault.process(file, (data) => appendInline(data, tag));
				}
				outcome.filesChanged++;
				outcome.occurrences++;
			} catch (error) {
				outcome.errors.push({
					path: preview.path,
					message: error instanceof Error ? error.message : String(error),
				});
			}
		}
		return outcome;
	}

	private async applyTransform(
		transform: (tag: string) => string | null,
		plan: EditPlan
	): Promise<EditOutcome> {
		const outcome: EditOutcome = {
			filesChanged: 0,
			occurrences: 0,
			errors: [],
		};

		for (const preview of plan.files) {
			const file = this.fileAt(preview.path);
			if (!file) continue;
			// Snapshot the cache before writing: body offsets must come from the
			// same state the file is in when vault.process reads it.
			const cache = this.app.metadataCache.getFileCache(file);
			const hits = (cache?.tags ?? []).filter(
				(hit) => transform(hit.tag) !== null
			);

			let changed = 0;
			try {
				if (hits.length > 0) {
					await this.app.vault.process(file, (data) => {
						const result = rewriteBody(data, hits, transform);
						changed += result.changed;
						return result.content;
					});
				}
				if (preview.frontmatter > 0) {
					await this.app.fileManager.processFrontMatter(file, (fm) => {
						changed += rewriteFrontmatter(fm, transform);
					});
				}
				if (changed > 0) {
					outcome.filesChanged++;
					outcome.occurrences += changed;
				}
			} catch (error) {
				outcome.errors.push({
					path: preview.path,
					message: error instanceof Error ? error.message : String(error),
				});
			}
		}
		return outcome;
	}

	// --- Helpers ----------------------------------------------------------

	private fileAt(path: string): TFile | null {
		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? file : null;
	}

	/** Every tag on a file, normalised, from both body and frontmatter. */
	private tagsOf(file: TFile): string[] {
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache) return [];
		const tags = (cache.tags ?? []).map((hit) => hit.tag);
		for (const entry of frontmatterTags(cache.frontmatter)) {
			tags.push(entry.normalized);
		}
		return tags;
	}

	private fold(tag: string): string {
		return this.options().caseSensitive ? tag : tag.toLowerCase();
	}

	private same(a: string, b: string): boolean {
		return this.fold(a) === this.fold(b);
	}

	/** Does `tag` equal `target`, or sit nested beneath it? */
	private matches(tag: string, target: string, includeNested: boolean): boolean {
		const t = this.fold(tag);
		const target_ = this.fold(target);
		if (t === target_) return true;
		return includeNested && t.startsWith(target_ + "/");
	}
}

/** `#a/b` renamed from `#a` to `#x` becomes `#x/b`. */
function renameTo(tag: string, from: string, to: string): string {
	return tag.length === from.length ? to : to + tag.slice(from.length);
}

interface FrontmatterTagEntry {
	/** Always "#"-prefixed, for comparison. */
	normalized: string;
}

function frontmatterTags(fm: unknown): FrontmatterTagEntry[] {
	const entries: FrontmatterTagEntry[] = [];
	if (!fm || typeof fm !== "object") return entries;
	const record = fm as Record<string, unknown>;
	for (const key of FRONTMATTER_KEYS) {
		for (const raw of splitFrontmatterValue(record[key])) {
			entries.push({ normalized: normalizeTag(raw, true) });
		}
	}
	return entries;
}

/** Frontmatter tags may be a list, or one string of comma/space separated tags. */
function splitFrontmatterValue(value: unknown): string[] {
	if (typeof value === "string") {
		return value
			.split(/[,\s]+/)
			.map((part) => part.trim())
			.filter((part) => part.length > 0);
	}
	if (Array.isArray(value)) {
		return value
			.filter((item): item is string => typeof item === "string")
			.map((item) => item.trim())
			.filter((item) => item.length > 0);
	}
	return [];
}

/**
 * Rewrite matching tags in the frontmatter object in place, preserving each
 * entry's original shape — a list stays a list, and an entry written without
 * a leading "#" keeps that form.
 */
export function rewriteFrontmatter(
	fm: Record<string, unknown>,
	transform: (tag: string) => string | null
): number {
	let total = 0;
	for (const key of FRONTMATTER_KEYS) {
		const value = fm[key];
		if (value === undefined || value === null) continue;
		const wasArray = Array.isArray(value);
		const parts = splitFrontmatterValue(value);
		if (parts.length === 0) continue;

		// Counted per key, so an untouched key is never rewritten (which would
		// silently reshape a string value into a list).
		let changed = 0;
		const next: string[] = [];
		for (const part of parts) {
			const hadHash = part.startsWith("#");
			const replacement = transform(normalizeTag(part, true));
			if (replacement === null) {
				next.push(part);
				continue;
			}
			changed++;
			if (replacement === "") continue; // removed
			next.push(hadHash ? replacement : replacement.replace(/^#/, ""));
		}
		if (changed === 0) continue;
		total += changed;

		if (next.length === 0) delete fm[key];
		else if (wasArray) fm[key] = next;
		else fm[key] = next.join(", ");
	}
	return total;
}

function addToFrontmatter(fm: Record<string, unknown>, tag: string): void {
	const bare = tag.replace(/^#/, "");
	const existing = fm["tags"];
	if (Array.isArray(existing)) {
		existing.push(bare);
		return;
	}
	if (typeof existing === "string" && existing.trim().length > 0) {
		fm["tags"] = splitFrontmatterValue(existing).concat(bare);
		return;
	}
	fm["tags"] = [bare];
}

/** Append a tag on its own line at the end of the note. */
function appendInline(data: string, tag: string): string {
	const trimmed = data.replace(/\s+$/, "");
	return trimmed.length === 0 ? `${tag}\n` : `${trimmed}\n\n${tag}\n`;
}

/**
 * Replace tags in the note body using the cache's offsets, walking backwards
 * so earlier offsets stay valid. Each hit is verified against the live text
 * first — a stale cache entry is skipped rather than overwriting the wrong
 * span. Lines left empty by a removal are dropped.
 */
export function rewriteBody(
	content: string,
	hits: TagCache[],
	transform: (tag: string) => string | null
): { content: string; changed: number } {
	const ordered = hits
		.slice()
		.sort((a, b) => b.position.start.offset - a.position.start.offset);

	let result = content;
	let changed = 0;
	const touched: number[] = [];

	for (const hit of ordered) {
		const start = hit.position.start.offset;
		const end = hit.position.end.offset;
		if (start < 0 || end > result.length || start >= end) continue;
		// Guard against a stale cache pointing at text that is no longer this tag.
		if (result.slice(start, end) !== hit.tag) continue;
		const replacement = transform(hit.tag);
		if (replacement === null) continue;

		result = result.slice(0, start) + replacement + result.slice(end);
		changed++;
		if (replacement === "") touched.push(start);
	}

	if (touched.length > 0) result = dropBlankedLines(result, touched);
	return { content: result, changed };
}

/**
 * After removing tags, drop any line that is now only whitespace. Only lines
 * a removal actually touched are considered, so unrelated blank lines the
 * author wrote are left alone.
 */
function dropBlankedLines(content: string, offsets: number[]): string {
	const lines = content.split("\n");
	const starts: number[] = [];
	let cursor = 0;
	for (const line of lines) {
		starts.push(cursor);
		cursor += line.length + 1;
	}

	const doomed = new Set<number>();
	for (const offset of offsets) {
		// Binary search would be overkill; note line counts are small.
		let index = 0;
		for (let i = 0; i < starts.length; i++) {
			if (starts[i] <= offset) index = i;
			else break;
		}
		if (lines[index] !== undefined && lines[index].trim() === "") {
			doomed.add(index);
		}
	}
	if (doomed.size === 0) return content;
	return lines.filter((_, index) => !doomed.has(index)).join("\n");
}

/**
 * Obsidian tags allow letters, digits, underscore, hyphen and slash, and must
 * contain at least one non-digit.
 */
export function validateTagName(raw: string): {
	ok: boolean;
	tag?: string;
	error?: string;
} {
	const trimmed = raw.trim().replace(/^#/, "");
	if (trimmed.length === 0) return { ok: false, error: "Tag name is empty." };
	if (/\s/.test(trimmed)) {
		return { ok: false, error: "Tags cannot contain spaces." };
	}
	if (!/^[\p{L}\p{N}_\-/]+$/u.test(trimmed)) {
		return {
			ok: false,
			error: "Only letters, digits, underscore, hyphen and / are allowed.",
		};
	}
	if (!/[\p{L}_\-/]/u.test(trimmed)) {
		return { ok: false, error: "A tag cannot be only digits." };
	}
	if (trimmed.startsWith("/") || trimmed.endsWith("/") || trimmed.includes("//")) {
		return { ok: false, error: "Misplaced / in the tag name." };
	}
	return { ok: true, tag: "#" + trimmed };
}
