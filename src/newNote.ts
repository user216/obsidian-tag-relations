import { App, Notice, TFile, TFolder, normalizePath } from "obsidian";
import { formatDateTime, sanitizeFileName } from "./datetime";
import { tagLabel } from "./graph";

export interface NewNoteOptions {
	titleFormat: string;
	timeZone: string;
	/** Vault-relative folder; empty means Obsidian's configured location. */
	folder: string;
	applySelectedTags: boolean;
	openAfterCreate: boolean;
}

export interface NewNoteResult {
	file: TFile;
	/** Tags written into the new note's frontmatter, "#"-prefixed. */
	tags: string[];
}

/** Fallback when a format renders to nothing usable as a filename. */
const FALLBACK_TITLE = "Untitled";

/**
 * Creates timestamped notes, optionally pre-tagged with the current
 * selection.
 *
 * This is the plugin's second writer after TagEditor, but a far simpler one:
 * it only ever creates new files, never modifies existing ones, so it needs
 * none of the plan/verify machinery that editing does.
 */
export class NoteCreator {
	private app: App;
	private options: () => NewNoteOptions;

	constructor(app: App, options: () => NewNoteOptions) {
		this.app = app;
		this.options = options;
	}

	/** The filename this would produce right now, without creating anything. */
	previewTitle(now = new Date()): string {
		const options = this.options();
		return titleFor(options.titleFormat, options.timeZone, now);
	}

	async create(selectedTags: string[] = []): Promise<NewNoteResult | null> {
		const options = this.options();
		const tags = options.applySelectedTags ? selectedTags.slice() : [];

		try {
			const folder = await this.resolveFolder(options.folder);
			const title = titleFor(options.titleFormat, options.timeZone);
			const path = await this.availablePath(folder, title);

			const file = await this.app.vault.create(path, noteBody(tags));
			if (options.openAfterCreate) {
				await this.app.workspace.getLeaf(false).openFile(file);
			}
			return { file, tags };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Tag Relations: could not create the note — ${message}`);
			console.error("Tag Relations: note creation failed", error);
			return null;
		}
	}

	/**
	 * Where the note goes. An explicit folder setting wins and is created if
	 * missing; otherwise Obsidian's own "default location for new notes"
	 * preference is honoured via getNewFileParent.
	 */
	private async resolveFolder(configured: string): Promise<string> {
		const trimmed = configured.trim().replace(/^\/+|\/+$/g, "");
		if (!trimmed) {
			const active = this.app.workspace.getActiveFile();
			const parent = this.app.fileManager.getNewFileParent(active?.path ?? "");
			return parent?.path ?? "";
		}

		const path = normalizePath(trimmed);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFolder) return path;
		if (existing) {
			// A file already occupies that path; fall back rather than fail.
			new Notice(
				`Tag Relations: "${path}" is a file, not a folder. Using the default location.`
			);
			return "";
		}
		await this.app.vault.createFolder(path);
		return path;
	}

	/**
	 * `<folder>/<title>.md`, suffixed if taken. Two notes created inside the
	 * same minute collide under the default format, so this is routine rather
	 * than an edge case.
	 */
	private async availablePath(folder: string, title: string): Promise<string> {
		const base = folder ? `${folder}/${title}` : title;
		const first = normalizePath(`${base}.md`);
		if (!this.app.vault.getAbstractFileByPath(first)) return first;

		for (let suffix = 1; suffix < 1000; suffix++) {
			const candidate = normalizePath(`${base}-${suffix}.md`);
			if (!this.app.vault.getAbstractFileByPath(candidate)) return candidate;
		}
		throw new Error(`Too many notes already named like "${title}".`);
	}
}

/** Format, then make the result safe as a filename. */
export function titleFor(
	format: string,
	timeZone: string,
	now = new Date()
): string {
	const formatted = formatDateTime(now, format, timeZone);
	const safe = sanitizeFileName(formatted);
	return safe.length > 0 ? safe : FALLBACK_TITLE;
}

/** Frontmatter carrying the given tags, or an empty note when there are none. */
export function noteBody(tags: string[]): string {
	if (tags.length === 0) return "";
	const unique = Array.from(new Set(tags.map(tagLabel))).filter(
		(tag) => tag.length > 0
	);
	if (unique.length === 0) return "";
	return ["---", "tags:", ...unique.map((tag) => `  - ${tag}`), "---", "", ""].join(
		"\n"
	);
}
