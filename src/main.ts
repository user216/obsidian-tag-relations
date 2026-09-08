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
import { remapManualLinks } from "./links";
import { EditOutcome, TagEditor, validateTagName } from "./edit";
import { NoteCreator } from "./newNote";
import { formatDateTime } from "./datetime";
import { NewNoteModal } from "./newNoteModal";
import { ImportRelationsModal } from "./transferModals";
import {
	RelationPayload,
	buildExport,
	serializeExport,
} from "./transfer";
import { TagGroups } from "./groups";
import { LEVEL_LABELS } from "./types";
import { MAX_PINNED, togglePinned } from "./levels";
import {
	RelationStore,
	countRemovable,
	describeRemovable,
	removableRelations,
	withoutAllRelations,
	withoutMembership,
	withoutRelation,
} from "./relations";
import {
	ConfirmEditModal,
	ConfirmRelationModal,
	RenameTagModal,
	TagChoiceModal,
} from "./editModals";

export default class TagRelationsPlugin extends Plugin {
	settings: TagRelationsSettings = { ...DEFAULT_SETTINGS };
	graph = new TagGraph();
	editor!: TagEditor;
	noteCreator!: NoteCreator;

	/** Vault edits arrive in bursts; rebuild once the dust settles. */
	rebuildGraphDebounced = debounce(() => this.rebuildGraph(), 900, true);

	async onload(): Promise<void> {
		await this.loadSettings();

		this.editor = new TagEditor(this.app, () => ({
			caseSensitive: this.settings.caseSensitive,
			addLocation: this.settings.addTagLocation,
		}));

		this.noteCreator = new NoteCreator(this.app, () => ({
			titleFormat: this.settings.newNoteTitleFormat,
			timeZone: this.settings.newNoteTimeZone,
			folder: this.settings.newNoteFolder,
			applySelectedTags: this.settings.newNoteApplySelectedTags,
			openAfterCreate: this.settings.newNoteOpenAfterCreate,
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
			name: "Horizontal link two tags",
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
			id: "create-new-note",
			name: "Create a new note",
			callback: () => this.promptCreateNote(this.selectionFromViews()),
		});
		this.addCommand({
			id: "export-relations",
			name: "Export relations to a file",
			callback: () => void this.exportRelationsToFile(),
		});
		this.addCommand({
			id: "copy-relations",
			name: "Copy relations to the clipboard",
			callback: () => void this.copyRelationsToClipboard(),
		});
		this.addCommand({
			id: "import-relations",
			name: "Import relations",
			callback: () => this.promptImportRelations(),
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
		if (!Array.isArray(this.settings.groupLinks)) this.settings.groupLinks = [];
		if (!Array.isArray(this.settings.pinnedTags)) this.settings.pinnedTags = [];
		if (!Array.isArray(this.settings.collapsedGroups)) {
			this.settings.collapsedGroups = [];
		}
		if (!Array.isArray(this.settings.bookmarkLinks)) {
			this.settings.bookmarkLinks = [];
		}
		if (!Array.isArray(this.settings.bookmarkRoots)) {
			this.settings.bookmarkRoots = [];
		}
		if (!Array.isArray(this.settings.collapsedSections)) {
			this.settings.collapsedSections = [];
		}
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
			groupLinks: this.settings.groupLinks,
			showGroupConnections: this.settings.showGroupConnections,
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
			new Notice("A tag cannot be linked to itself.");
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

		// A pair can be both grouped and linked — they are different claims,
		// and both are kept. But containment is what the views draw, so the
		// new link would appear to do nothing. Say so rather than let it look
		// like the action failed.
		const groups = new TagGroups(this.settings.groupLinks);
		const contains = groups.contains(tagA, tagB) || groups.contains(tagB, tagA);
		if (contains) {
			new Notice(
				`Linked ${tagLabel(tagA)} ↔ ${tagLabel(tagB)}. They are already grouped, so the views will keep showing the group relationship — the link is stored and reappears if you ungroup them.`,
				8000
			);
			return;
		}
		new Notice(`Linked ${tagLabel(tagA)} ↔ ${tagLabel(tagB)}`);
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

	// --- Groups -----------------------------------------------------------

	/**
	 * Put `child` inside `parent`. The depth rule lives in TagGroups; this
	 * reports its refusal rather than silently dropping the request.
	 */
	async addToGroup(parent: string, child: string): Promise<void> {
		const groups = new TagGroups(this.settings.groupLinks);
		const result = groups.add(parent, child);
		if (!result.ok) {
			new Notice(result.reason ?? "That grouping is not allowed.");
			return;
		}
		this.settings.groupLinks = groups.all;
		await this.saveSettings();
		this.rebuildGraph();
		new Notice(`${tagLabel(child)} is now inside ${tagLabel(parent)}.`);
	}

	async removeFromGroup(parent: string, child: string): Promise<void> {
		const groups = new TagGroups(this.settings.groupLinks);
		if (!groups.remove(parent, child)) return;
		this.settings.groupLinks = groups.all;
		await this.saveSettings();
		this.rebuildGraph();
		new Notice(`${tagLabel(child)} removed from ${tagLabel(parent)}.`);
	}

	/** Pick a tag — existing or new — to place inside `parent`. */
	promptAddToGroup(parent: string): void {
		const groups = new TagGroups(this.settings.groupLinks);
		const candidates = this.allKnownTags().filter(
			(tag) => groups.canAdd(parent, tag).ok
		);
		if (candidates.length === 0) {
			new Notice(`Nothing can be added to ${tagLabel(parent)} right now.`);
			return;
		}
		const subtitles = new Map<string, string>();
		for (const tag of candidates) {
			const level = groups.levelOf(tag);
			if (level !== "simple") subtitles.set(tag, `brings its own members`);
		}
		new TagChoiceModal(
			this.app,
			candidates,
			`Put which tag inside ${tagLabel(parent)}?`,
			(tag) => void this.addToGroup(parent, tag),
			{ subtitles }
		).open();
	}

	/**
	 * The other direction: pick the tag that should *contain* `child`.
	 *
	 * This is the flow you want when you are looking at a tag and know where
	 * it belongs. Typing a name that does not exist creates the main-tag on
	 * the spot, so a new group needs no separate "create" step — the graph
	 * already materialises tags that carry no notes.
	 */
	promptPutInsideGroup(child: string): void {
		const groups = new TagGroups(this.settings.groupLinks);
		const candidates = this.allKnownTags().filter(
			(tag) => groups.canAdd(tag, child).ok
		);
		const subtitles = new Map<string, string>();
		for (const tag of candidates) {
			const level = groups.levelOf(tag);
			const members = groups.childrenOf(tag).length;
			if (members > 0) {
				subtitles.set(
					tag,
					`${LEVEL_LABELS[level].toLowerCase()} · ${members} member${
						members === 1 ? "" : "s"
					}`
				);
			}
		}
		const childLevel = groups.levelOf(child);
		const becomes =
			childLevel === "simple"
				? ""
				: " — it keeps its members and becomes a sub-tag";
		new TagChoiceModal(
			this.app,
			candidates,
			`Put ${tagLabel(child)} inside which main-tag?${becomes}`,
			(parent) => void this.addToGroup(parent, child),
			{ subtitles }
		).open();
	}

	async togglePinnedTag(tag: string): Promise<void> {
		const result = togglePinned(this.settings.pinnedTags, tag);
		if (!result.changed) {
			new Notice(result.reason ?? `Only ${MAX_PINNED} tags can be pinned.`);
			return;
		}
		this.settings.pinnedTags = result.pinned;
		await this.saveSettings();
		this.refreshViews();
	}

	// --- Bookmarks ---------------------------------------------------------

	/**
	 * Bookmarks reuse the group structure wholesale — same DAG, same
	 * three-level invariant, same rename handling — but in their own store.
	 * They deliberately create no graph edges: a bookmark says "keep this
	 * within reach", not "these two tags are related", so it is navigation
	 * rather than a claim about the vault.
	 */
	bookmarks(): TagGroups {
		return new TagGroups(this.settings.bookmarkLinks);
	}

	isBookmarked(tag: string): boolean {
		if (this.settings.bookmarkRoots.includes(tag)) return true;
		const marks = this.bookmarks();
		return marks.hasParents(tag) || marks.hasChildren(tag);
	}

	async toggleBookmark(tag: string): Promise<void> {
		if (this.isBookmarked(tag)) {
			this.settings.bookmarkRoots = this.settings.bookmarkRoots.filter(
				(other) => other !== tag
			);
			const marks = this.bookmarks();
			if (marks.removeTag(tag)) this.settings.bookmarkLinks = marks.all;
			await this.saveSettings();
			this.refreshViews();
			new Notice(`Removed ${tagLabel(tag)} from bookmarks.`);
			return;
		}
		this.settings.bookmarkRoots.push(tag);
		await this.saveSettings();
		this.refreshViews();
		new Notice(`Bookmarked ${tagLabel(tag)}.`);
	}

	/** Put a tag inside a bookmark folder, creating the nesting. */
	async addToBookmark(parent: string, child: string): Promise<void> {
		const marks = this.bookmarks();
		const result = marks.add(parent, child);
		if (!result.ok) {
			new Notice(result.reason ?? "That bookmark nesting is not allowed.");
			return;
		}
		this.settings.bookmarkLinks = marks.all;
		// A tag held by a bookmark folder no longer needs its own top-level
		// entry; it is reachable through the folder.
		this.settings.bookmarkRoots = this.settings.bookmarkRoots.filter(
			(tag) => tag !== child
		);
		if (!this.settings.bookmarkRoots.includes(parent) && !marks.hasParents(parent)) {
			this.settings.bookmarkRoots.push(parent);
		}
		await this.saveSettings();
		this.refreshViews();
		new Notice(`${tagLabel(child)} bookmarked under ${tagLabel(parent)}.`);
	}

	promptBookmarkInside(child: string): void {
		const marks = this.bookmarks();
		const candidates = this.allKnownTags().filter(
			(tag) => tag !== child && marks.canAdd(tag, child).ok
		);
		if (candidates.length === 0) {
			new Notice("There is nowhere to file that bookmark right now.");
			return;
		}
		new TagChoiceModal(
			this.app,
			candidates,
			`Bookmark ${tagLabel(child)} under…`,
			(parent) => void this.addToBookmark(parent, child)
		).open();
	}

	async removeFromBookmark(parent: string, child: string): Promise<void> {
		const marks = this.bookmarks();
		if (!marks.remove(parent, child)) return;
		this.settings.bookmarkLinks = marks.all;
		await this.saveSettings();
		this.refreshViews();
	}

	/** Top-level bookmark entries, in the order they were added. */
	bookmarkTopLevel(): string[] {
		const marks = this.bookmarks();
		const roots = this.settings.bookmarkRoots.filter(
			(tag) => !marks.hasParents(tag)
		);
		for (const tag of marks.mainGroups()) {
			if (!roots.includes(tag)) roots.push(tag);
		}
		return roots;
	}

	// --- Export and import -------------------------------------------------

	/** The portable half of the plugin's data: everything not in your notes. */
	private relationPayload(): RelationPayload {
		return {
			horizontalLinks: this.settings.manualLinks,
			groupLinks: this.settings.groupLinks,
			pinnedTags: this.settings.pinnedTags,
		};
	}

	exportJson(): string {
		return serializeExport(
			buildExport(this.relationPayload(), this.manifest.version)
		);
	}

	/** Write an export into the vault, where it syncs and can be found again. */
	async exportRelationsToFile(): Promise<void> {
		const payload = this.relationPayload();
		const total =
			payload.horizontalLinks.length +
			payload.groupLinks.length +
			payload.pinnedTags.length;
		if (total === 0) {
			new Notice("Nothing to export yet — no links, groups or pins.");
			return;
		}
		const stamp = formatDateTime(new Date(), "YYYYMMDD-HHmmss", "");
		const path = `tag-relations-export-${stamp}.json`;
		try {
			await this.app.vault.create(path, this.exportJson());
			new Notice(
				`Exported ${payload.horizontalLinks.length} link(s), ${payload.groupLinks.length} group membership(s) and ${payload.pinnedTags.length} pin(s) to ${path}`
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Could not write the export — ${message}`);
			console.error("Tag Relations: export failed", error);
		}
	}

	async copyRelationsToClipboard(): Promise<void> {
		await navigator.clipboard.writeText(this.exportJson());
		new Notice("Relations copied to the clipboard as JSON.");
	}

	promptImportRelations(): void {
		new ImportRelationsModal(this.app, {
			current: this.relationPayload(),
			maxPinned: MAX_PINNED,
			onApply: (payload) => void this.applyImported(payload),
		}).open();
	}

	private async applyImported(payload: RelationPayload): Promise<void> {
		this.settings.manualLinks = payload.horizontalLinks;
		this.settings.groupLinks = payload.groupLinks;
		this.settings.pinnedTags = payload.pinnedTags;
		await this.saveSettings();
		this.rebuildGraph();
		new Notice(
			`Imported: ${payload.horizontalLinks.length} link(s), ${payload.groupLinks.length} group membership(s), ${payload.pinnedTags.length} pin(s).`
		);
	}

	// --- Removing relations ------------------------------------------------

	/** The stored relations, in the shape the pure helpers expect. */
	private relationStore(): RelationStore {
		return {
			manualLinks: this.settings.manualLinks,
			groupLinks: this.settings.groupLinks,
		};
	}

	removableRelationCount(tag: string): number {
		return countRemovable(tag, this.relationStore());
	}

	private async applyRelationStore(next: RelationStore): Promise<void> {
		this.settings.manualLinks = next.manualLinks;
		this.settings.groupLinks = next.groupLinks;
		await this.saveSettings();
		this.rebuildGraph();
	}

	/** Pick one relation of `tag` to remove, whatever kind it is. */
	promptRemoveRelation(tag: string): void {
		const relations = removableRelations(tag, this.relationStore());
		if (relations.length === 0) {
			new Notice(
				`${tagLabel(tag)} has no removable relations. Relations from shared notes come from your notes, not from this plugin.`
			);
			return;
		}
		const subtitles = new Map<string, string>();
		for (const relation of relations) {
			subtitles.set(relation.other, describeRemovable(relation));
		}
		new TagSuggestModal(
			this.app,
			relations.map((relation) => relation.other),
			`Remove ${tagLabel(tag)}'s relation to…`,
			(other) => void this.removeRelation(tag, other),
			subtitles
		).open();
	}

	async removeRelation(tag: string, other: string): Promise<void> {
		await this.applyRelationStore(
			withoutRelation(tag, other, this.relationStore())
		);
		new Notice(`Removed the relation between ${tagLabel(tag)} and ${tagLabel(other)}.`);
	}

	/** Drop every removable relation this tag has, after confirming. */
	promptRemoveAllRelations(tag: string): void {
		const relations = removableRelations(tag, this.relationStore());
		const total = countRemovable(tag, this.relationStore());
		if (total === 0) {
			new Notice(`${tagLabel(tag)} has no removable relations.`);
			return;
		}
		new ConfirmRelationModal(this.app, {
			title: `Remove all relations of ${tagLabel(tag)}`,
			summary: `${total} relation${total === 1 ? "" : "s"} to ${
				relations.length
			} tag${relations.length === 1 ? "" : "s"} will be removed.`,
			// Said explicitly because it is the obvious next question, and the
			// answer is reassuring: nothing here touches note content.
			note: "Only horizontal links and group membership are removed — both live in this plugin's data, not in your notes. Relations that come from two tags sharing a note are left alone; those would need the tag removed from the notes themselves.",
			lines: relations.map(
				(relation) => `${tagLabel(relation.other)} — ${describeRemovable(relation)}`
			),
			confirmLabel: "Remove all",
			onConfirm: () => void this.removeAllRelations(tag),
		}).open();
	}

	async removeAllRelations(tag: string): Promise<void> {
		const total = countRemovable(tag, this.relationStore());
		await this.applyRelationStore(withoutAllRelations(tag, this.relationStore()));
		new Notice(
			`Removed ${total} relation${total === 1 ? "" : "s"} from ${tagLabel(tag)}.`
		);
	}

	/** Take a tag out of one specific main-tag or sub-tag. */
	promptTakeOutOfGroup(tag: string): void {
		const parents = new TagGroups(this.settings.groupLinks).parentsOf(tag);
		if (parents.length === 0) {
			new Notice(`${tagLabel(tag)} is not inside anything.`);
			return;
		}
		if (parents.length === 1) {
			void this.removeFromGroup(parents[0], tag);
			return;
		}
		const groups = new TagGroups(this.settings.groupLinks);
		const subtitles = new Map<string, string>();
		for (const parent of parents) {
			subtitles.set(parent, LEVEL_LABELS[groups.levelOf(parent)].toLowerCase());
		}
		new TagSuggestModal(
			this.app,
			parents,
			`Take ${tagLabel(tag)} out of…`,
			(parent) => void this.removeFromGroup(parent, tag),
			subtitles
		).open();
	}

	/** Remove exactly one membership, used by the in-place control in the groups view. */
	async removeMembership(tag: string, parent: string): Promise<void> {
		await this.applyRelationStore(
			withoutMembership(tag, parent, this.relationStore())
		);
		new Notice(`${tagLabel(tag)} taken out of ${tagLabel(parent)}.`);
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
		this.remapGroupsAndPins(from, to);
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

	/**
	 * Create a timestamped note, optionally carrying the given tags. Returns
	 * silently on failure; NoteCreator has already told the user why.
	 */
	/**
	 * Entry point for the button and the command: ask which tags the note
	 * should carry, then create it. The dialog starts from the current
	 * selection, so the common case is still one keystroke away — Enter on an
	 * empty box creates immediately.
	 */
	promptCreateNote(selection: string[] = []): void {
		const applySelection = this.settings.newNoteApplySelectedTags;
		const initial = applySelection ? selection : [];
		if (!this.settings.newNotePromptForTags) {
			void this.createNote(initial);
			return;
		}
		new NewNoteModal(this.app, {
			initialTags: initial,
			allTags: this.allKnownTags(),
			previewTitle: () => this.noteCreator.previewTitle(),
			onCreate: (tags) => void this.createNote(tags, { force: true }),
		}).open();
	}

	/**
	 * `force` writes the given tags even when "apply the selected tags" is
	 * off — the dialog's list is an explicit choice, not the selection
	 * leaking in, so that setting should not veto it.
	 */
	async createNote(
		tags: string[] = [],
		options: { force?: boolean } = {}
	): Promise<void> {
		const result = await this.noteCreator.create(tags, options.force === true);
		if (!result) return;
		if (result.tags.length > 0) {
			new Notice(
				`Created ${result.file.basename} with ${result.tags.length} tag${
					result.tags.length === 1 ? "" : "s"
				}.`
			);
			// The new note carries tags, so the graph is now out of date.
			this.rebuildGraphDebounced();
		} else {
			new Notice(`Created ${result.file.basename}.`);
		}
	}

	/** The selection of the first open view, for commands invoked outside one. */
	private selectionFromViews(): string[] {
		for (const view of this.views()) {
			if (view.selection.length > 0) return view.selection.slice();
		}
		return [];
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

	/** Group membership and pins follow a rename, like manual links do. */
	private remapGroupsAndPins(from: string, to: string): void {
		const groups = new TagGroups(this.settings.groupLinks);
		if (groups.renameTag(from, to)) this.settings.groupLinks = groups.all;

		const marks = this.bookmarks();
		if (marks.renameTag(from, to)) this.settings.bookmarkLinks = marks.all;
		if (this.settings.bookmarkRoots.includes(from)) {
			this.settings.bookmarkRoots = Array.from(
				new Set(this.settings.bookmarkRoots.map((tag) => (tag === from ? to : tag)))
			);
		}

		const pins = this.settings.pinnedTags;
		if (pins.includes(from)) {
			const renamed = pins.map((tag) => (tag === from ? to : tag));
			// A rename can merge two pins into one.
			this.settings.pinnedTags = Array.from(new Set(renamed));
		}
	}

	/** Keep manual connections pointing at a tag that was just renamed. */
	private remapManualLinks(
		from: string,
		to: string,
		includeNested: boolean
	): void {
		this.settings.manualLinks = remapManualLinks(
			this.settings.manualLinks,
			from,
			to,
			includeNested,
			this.settings.caseSensitive
		);
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
		new TagSuggestModal(this.app, tags, "Horizontal link: pick the first tag", (first) => {
			new TagSuggestModal(
				this.app,
				tags.filter((tag) => tag !== first),
				`Horizontal link: ${tagLabel(first)} to…`,
				(second) => void this.addManualLink(first, second)
			).open();
		}).open();
	}
}
