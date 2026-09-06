import { Notice, Plugin, TFile, WorkspaceLeaf, debounce } from "obsidian";
import {
	DEFAULT_SETTINGS,
	TagRelationsSettingTab,
	TagRelationsSettings,
	splitList,
} from "./settings";
import { TagGraph, normalizeTag, tagLabel } from "./graph";
import { TagRelationsView, VIEW_TYPE_TAG_RELATIONS } from "./view";
import { TagSuggestModal } from "./modals";
import { EditOutcome, TagEditor, validateTagName } from "./edit";
import {
	ConfirmEditModal,
	RenameTagModal,
	TagChoiceModal,
} from "./editModals";

export default class TagRelationsPlugin extends Plugin {
	settings: TagRelationsSettings = { ...DEFAULT_SETTINGS };
	graph = new TagGraph();
	editor!: TagEditor;

	/** Vault edits arrive in bursts; rebuild once the dust settles. */
	rebuildGraphDebounced = debounce(() => this.rebuildGraph(), 900, true);

	async onload(): Promise<void> {
		await this.loadSettings();

		this.editor = new TagEditor(this.app, () => ({
			caseSensitive: this.settings.caseSensitive,
			addLocation: this.settings.addTagLocation,
		}));

		this.registerView(
			VIEW_TYPE_TAG_RELATIONS,
			(leaf: WorkspaceLeaf) => new TagRelationsView(leaf, this)
		);

		this.addSettingTab(new TagRelationsSettingTab(this.app, this));

		this.addRibbonIcon("tags", "Tag relations", () => void this.activateView());

		this.addCommand({
			id: "open-tag-relations",
			name: "Open tag relations",
			callback: () => void this.activateView(),
		});
		this.addCommand({
			id: "open-tag-relations-sidebar",
			name: "Open tag relations in sidebar",
			callback: () => void this.activateView(true),
		});
		this.addCommand({
			id: "focus-tag",
			name: "Focus a tag",
			callback: () => this.promptFocusTag(),
		});
		this.addCommand({
			id: "connect-tags",
			name: "Connect two tags",
			callback: () => this.promptConnectTags(),
		});
		this.addCommand({
			id: "rename-tag",
			name: "Rename a tag",
			callback: () => {
				const tags = this.graph.tagList;
				if (tags.length === 0) {
					new Notice("No tags found in this vault yet.");
					return;
				}
				new TagSuggestModal(
					this.app,
					tags.slice().sort((a, b) => a.localeCompare(b)),
					"Rename which tag?",
					(tag) => this.promptRenameTag(tag)
				).open();
			},
		});
		this.addCommand({
			id: "add-tag-to-active-note",
			name: "Add a tag to the active note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) this.promptAssignTag([file.path], "this note");
				return true;
			},
		});
		this.addCommand({
			id: "remove-tag-from-active-note",
			name: "Remove a tag from the active note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (checking) return true;
				const tags = this.tagsOnFile(file);
				if (tags.length === 0) {
					new Notice("This note has no tags.");
					return true;
				}
				new TagSuggestModal(this.app, tags, "Remove which tag?", (tag) =>
					this.promptUnassignTag(tag, [file.path], "this note")
				).open();
				return true;
			},
		});
		this.addCommand({
			id: "rebuild-tag-graph",
			name: "Rescan vault for tags",
			callback: () => {
				this.rebuildGraph();
				new Notice(
					`Tag Relations: ${this.graph.nodes.size} tags, ${this.graph.edges.size} relations.`
				);
			},
		});

		this.app.workspace.onLayoutReady(() => this.rebuildGraph());

		this.registerEvent(
			this.app.metadataCache.on("changed", () => this.rebuildGraphDebounced())
		);
		this.registerEvent(
			this.app.metadataCache.on("resolved", () => this.rebuildGraphDebounced())
		);
		this.registerEvent(
			this.app.vault.on("delete", () => this.rebuildGraphDebounced())
		);
		this.registerEvent(
			this.app.vault.on("rename", () => this.rebuildGraphDebounced())
		);
	}

	onunload(): void {
		this.rebuildGraphDebounced.cancel();
	}

	async loadSettings(): Promise<void> {
		const stored = (await this.loadData()) as Partial<TagRelationsSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, stored ?? {});
		// Guard against a hand-edited or partially written data.json.
		if (!Array.isArray(this.settings.manualLinks)) this.settings.manualLinks = [];
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	rebuildGraph(): void {
		this.graph.build(this.app, {
			metric: this.settings.metric,
			minCooccurrence: this.settings.minCooccurrence,
			minWeight: this.settings.minWeight,
			caseSensitive: this.settings.caseSensitive,
			linkNestedTags: this.settings.linkNestedTags,
			excludedTags: splitList(this.settings.excludedTags),
			excludedFolders: splitList(this.settings.excludedFolders),
			manualLinks: this.settings.manualLinks,
		});
		for (const view of this.views()) view.onGraphChanged();
	}

	refreshViews(): void {
		for (const view of this.views()) view.requestRender();
	}

	private views(): TagRelationsView[] {
		return this.app.workspace
			.getLeavesOfType(VIEW_TYPE_TAG_RELATIONS)
			.map((leaf) => leaf.view)
			.filter((view): view is TagRelationsView => view instanceof TagRelationsView);
	}

	/** Every tag in the vault plus any tag named only by a manual connection. */
	allKnownTags(): string[] {
		const tags = new Set(this.graph.tagList);
		for (const link of this.settings.manualLinks) {
			tags.add(normalizeTag(link.a, this.settings.caseSensitive));
			tags.add(normalizeTag(link.b, this.settings.caseSensitive));
		}
		return Array.from(tags).sort((a, b) => a.localeCompare(b));
	}

	async addManualLink(a: string, b: string, label?: string): Promise<void> {
		const tagA = normalizeTag(a, this.settings.caseSensitive);
		const tagB = normalizeTag(b, this.settings.caseSensitive);
		if (tagA === tagB) {
			new Notice("A tag cannot be connected to itself.");
			return;
		}
		const exists = this.settings.manualLinks.some(
			(link) =>
				(link.a === tagA && link.b === tagB) ||
				(link.a === tagB && link.b === tagA)
		);
		if (exists) {
			new Notice(`${tagLabel(tagA)} and ${tagLabel(tagB)} are already connected.`);
			return;
		}
		this.settings.manualLinks.push({ a: tagA, b: tagB, label });
		await this.saveSettings();
		this.rebuildGraph();
		new Notice(`Connected ${tagLabel(tagA)} ↔ ${tagLabel(tagB)}`);
	}

	async removeManualLink(a: string, b: string): Promise<void> {
		const before = this.settings.manualLinks.length;
		this.settings.manualLinks = this.settings.manualLinks.filter(
			(link) => !((link.a === a && link.b === b) || (link.a === b && link.b === a))
		);
		if (this.settings.manualLinks.length === before) return;
		await this.saveSettings();
		this.rebuildGraph();
		new Notice(`Disconnected ${tagLabel(a)} ↔ ${tagLabel(b)}`);
	}

	// --- Editing ----------------------------------------------------------

	/** Rename a tag everywhere, previewing the blast radius first. */
	promptRenameTag(tag: string): void {
		const hasNested = this.graph.tagList.some((other) =>
			other.startsWith(tag + "/")
		);
		new RenameTagModal(
			this.app,
			this.editor,
			tag,
			hasNested,
			(to, includeNested) => void this.renameTag(tag, to, includeNested)
		).open();
	}

	/**
	 * Rename driven from an inline edit rather than the dialog: validate, then
	 * confirm if it touches more than one note, then apply.
	 */
	requestRename(from: string, to: string): void {
		const validation = validateTagName(to);
		if (!validation.ok || !validation.tag) {
			new Notice(validation.error ?? "Invalid tag name.");
			return;
		}
		const target = validation.tag;
		if (target.toLowerCase() === from.toLowerCase()) return;

		const includeNested = this.graph.tagList.some((other) =>
			other.startsWith(from + "/")
		);
		const plan = this.editor.planRename(from, target, includeNested);
		if (plan.files.length === 0) {
			new Notice(`No notes carry ${tagLabel(from)}.`);
			return;
		}
		const apply = () => void this.renameTag(from, target, includeNested);
		if (this.shouldConfirm(plan.files.length)) {
			new ConfirmEditModal(this.app, {
				title: `Rename ${tagLabel(from)} → ${tagLabel(target)}`,
				summary: `${plan.occurrences} occurrence${
					plan.occurrences === 1 ? "" : "s"
				} across ${plan.files.length} note${
					plan.files.length === 1 ? "" : "s"
				}${includeNested ? ", including nested tags" : ""}.`,
				plan,
				confirmLabel: "Rename",
				onConfirm: apply,
			}).open();
		} else {
			apply();
		}
	}

	async renameTag(
		from: string,
		to: string,
		includeNested: boolean
	): Promise<void> {
		const outcome = await this.editor.applyRename(from, to, includeNested);
		this.remapManualLinks(from, to, includeNested);
		await this.saveSettings();
		this.report(
			outcome,
			`Renamed ${tagLabel(from)} → ${tagLabel(to)}`
		);
		this.rebuildGraphDebounced();
	}

	/** Assign an existing or brand-new tag to a set of notes. */
	promptAssignTag(paths: string[], scopeLabel: string): void {
		if (paths.length === 0) {
			new Notice("No notes to tag.");
			return;
		}
		new TagChoiceModal(
			this.app,
			this.allKnownTags(),
			`Add a tag to ${scopeLabel} — type a new name to create one`,
			(tag) => {
				const plan = this.editor.planAssign(tag, paths);
				if (plan.files.length === 0) {
					new Notice(`Every one of those notes already has ${tagLabel(tag)}.`);
					return;
				}
				const apply = () => void this.assignTag(tag, paths);
				if (this.shouldConfirm(plan.files.length)) {
					new ConfirmEditModal(this.app, {
						title: `Add ${tagLabel(tag)}`,
						summary: `${tagLabel(tag)} will be added to ${
							plan.files.length
						} note${plan.files.length === 1 ? "" : "s"}, in the ${
							this.settings.addTagLocation === "frontmatter"
								? "frontmatter"
								: "note body"
						}.`,
						plan,
						confirmLabel: "Add tag",
						onConfirm: apply,
					}).open();
				} else {
					apply();
				}
			}
		).open();
	}

	async assignTag(tag: string, paths: string[]): Promise<void> {
		const outcome = await this.editor.applyAssign(tag, paths);
		this.report(outcome, `Added ${tagLabel(tag)}`);
		this.rebuildGraphDebounced();
	}

	/** Remove a tag from a set of notes (all notes carrying it, by default). */
	promptUnassignTag(tag: string, paths: string[], scopeLabel: string): void {
		const includeNested = this.graph.tagList.some((other) =>
			other.startsWith(tag + "/")
		);
		const plan = this.editor.planUnassign(tag, paths, includeNested);
		if (plan.files.length === 0) {
			new Notice(`No notes in ${scopeLabel} carry ${tagLabel(tag)}.`);
			return;
		}
		new ConfirmEditModal(this.app, {
			title: `Remove ${tagLabel(tag)}`,
			summary: `${plan.occurrences} occurrence${
				plan.occurrences === 1 ? "" : "s"
			} will be removed from ${plan.files.length} note${
				plan.files.length === 1 ? "" : "s"
			} in ${scopeLabel}${includeNested ? ", including nested tags" : ""}.`,
			plan,
			confirmLabel: "Remove tag",
			destructive: true,
			onConfirm: () => void this.unassignTag(tag, paths, includeNested),
		}).open();
	}

	async unassignTag(
		tag: string,
		paths: string[],
		includeNested: boolean
	): Promise<void> {
		const outcome = await this.editor.applyUnassign(tag, paths, includeNested);
		this.report(outcome, `Removed ${tagLabel(tag)}`);
		this.rebuildGraphDebounced();
	}

	/** Tags on one file, normalised, for the "remove from this note" picker. */
	tagsOnFile(file: TFile): string[] {
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache) return [];
		const found = new Set<string>();
		for (const hit of cache.tags ?? []) {
			found.add(normalizeTag(hit.tag, this.settings.caseSensitive));
		}
		const fm = cache.frontmatter as Record<string, unknown> | undefined;
		for (const key of ["tags", "tag"]) {
			const value = fm?.[key];
			const parts =
				typeof value === "string"
					? value.split(/[,\s]+/)
					: Array.isArray(value)
					? value.filter((v): v is string => typeof v === "string")
					: [];
			for (const part of parts) {
				const trimmed = part.trim();
				if (trimmed) {
					found.add(normalizeTag(trimmed, this.settings.caseSensitive));
				}
			}
		}
		return Array.from(found).sort((a, b) => a.localeCompare(b));
	}

	/** Every note carrying a tag — the default scope for a vault-wide edit. */
	notesWithTag(tag: string): string[] {
		const includeNested = this.graph.tagList.some((other) =>
			other.startsWith(tag + "/")
		);
		return this.editor.filesWithTag(tag, includeNested);
	}

	private shouldConfirm(fileCount: number): boolean {
		return this.settings.confirmBulkEdits && fileCount > 1;
	}

	private report(outcome: EditOutcome, action: string): void {
		if (outcome.errors.length > 0) {
			console.error("Tag Relations edit errors", outcome.errors);
			new Notice(
				`${action}: ${outcome.filesChanged} note${
					outcome.filesChanged === 1 ? "" : "s"
				} changed, ${outcome.errors.length} failed. See the console for details.`
			);
			return;
		}
		new Notice(
			`${action} in ${outcome.filesChanged} note${
				outcome.filesChanged === 1 ? "" : "s"
			}.`
		);
	}

	/** Keep manual connections pointing at a tag that was just renamed. */
	private remapManualLinks(
		from: string,
		to: string,
		includeNested: boolean
	): void {
		const fold = (tag: string) =>
			this.settings.caseSensitive ? tag : tag.toLowerCase();
		const remap = (tag: string): string => {
			const folded = fold(tag);
			const target = fold(from);
			if (folded === target) return to;
			if (includeNested && folded.startsWith(target + "/")) {
				return to + tag.slice(from.length);
			}
			return tag;
		};

		const seen = new Set<string>();
		const next: typeof this.settings.manualLinks = [];
		for (const link of this.settings.manualLinks) {
			const a = remap(link.a);
			const b = remap(link.b);
			// A rename can collapse a link onto itself, or duplicate another.
			if (fold(a) === fold(b)) continue;
			const key = [fold(a), fold(b)].sort().join(" ");
			if (seen.has(key)) continue;
			seen.add(key);
			next.push({ ...link, a, b });
		}
		this.settings.manualLinks = next;
	}

	async activateView(sidebar = false): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_TAG_RELATIONS);
		if (existing.length > 0) {
			await workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = sidebar
			? workspace.getRightLeaf(false)
			: workspace.getLeaf("tab");
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE_TAG_RELATIONS, active: true });
		await workspace.revealLeaf(leaf);
	}

	private promptFocusTag(): void {
		const tags = this.allKnownTags();
		if (tags.length === 0) {
			new Notice("No tags found in this vault yet.");
			return;
		}
		const subtitles = new Map<string, string>();
		for (const tag of tags) {
			const count = this.graph.countOf(tag);
			const degree = this.graph.neighbors(tag).length;
			subtitles.set(
				tag,
				`${count} note${count === 1 ? "" : "s"} · ${degree} relation${
					degree === 1 ? "" : "s"
				}`
			);
		}
		new TagSuggestModal(
			this.app,
			tags,
			"Focus a tag",
			(tag) => {
				void this.activateView().then(() => {
					for (const view of this.views()) view.select(tag, "replace");
				});
			},
			subtitles
		).open();
	}

	private promptConnectTags(): void {
		const tags = this.allKnownTags();
		if (tags.length < 2) {
			new Notice("Not enough tags in this vault to connect.");
			return;
		}
		new TagSuggestModal(this.app, tags, "Connect: pick the first tag", (first) => {
			new TagSuggestModal(
				this.app,
				tags.filter((tag) => tag !== first),
				`Connect ${tagLabel(first)} to…`,
				(second) => void this.addManualLink(first, second)
			).open();
		}).open();
	}
}
