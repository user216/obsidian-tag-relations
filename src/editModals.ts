import { App, Modal, Setting, SuggestModal, setIcon } from "obsidian";
import { tagLabel } from "./graph";
import { EditPlan, TagEditor, validateTagName } from "./edit";

/**
 * Pick an existing tag, or type a name that does not exist yet to create it.
 * This is what makes "assign more existing or new tags" one gesture rather
 * than two separate flows.
 */
interface TagChoice {
	tag: string;
	isNew: boolean;
	subtitle?: string;
}

export class TagChoiceModal extends SuggestModal<TagChoice> {
	private tags: string[];
	private onPick: (tag: string, isNew: boolean) => void;
	private subtitles: Map<string, string>;
	private allowNew: boolean;

	constructor(
		app: App,
		tags: string[],
		placeholder: string,
		onPick: (tag: string, isNew: boolean) => void,
		options?: { subtitles?: Map<string, string>; allowNew?: boolean }
	) {
		super(app);
		this.tags = tags;
		this.onPick = onPick;
		this.subtitles = options?.subtitles ?? new Map();
		this.allowNew = options?.allowNew ?? true;
		this.setPlaceholder(placeholder);
		this.limit = 50;
	}

	getSuggestions(query: string): TagChoice[] {
		const needle = query.trim().toLowerCase().replace(/^#/, "");
		const matches = this.tags
			.filter((tag) => tagLabel(tag).toLowerCase().includes(needle))
			.map((tag) => ({
				tag,
				isNew: false,
				subtitle: this.subtitles.get(tag),
			}));

		if (!this.allowNew || needle.length === 0) return matches;

		const validation = validateTagName(needle);
		const exists = this.tags.some(
			(tag) => tag.toLowerCase() === validation.tag?.toLowerCase()
		);
		if (validation.ok && validation.tag && !exists) {
			// Offer creation first so a deliberate new name is one Enter away.
			matches.unshift({
				tag: validation.tag,
				isNew: true,
				subtitle: "Create this new tag",
			});
		}
		return matches;
	}

	renderSuggestion(choice: TagChoice, el: HTMLElement): void {
		el.addClass("tr-choice");
		if (choice.isNew) {
			const icon = el.createSpan({ cls: "tr-choice-icon" });
			setIcon(icon, "plus");
		}
		const body = el.createDiv({ cls: "tr-choice-body" });
		body.createDiv({ cls: "tr-choice-name", text: tagLabel(choice.tag) });
		if (choice.subtitle) {
			body.createDiv({ cls: "tr-choice-sub", text: choice.subtitle });
		}
	}

	onChooseSuggestion(choice: TagChoice): void {
		this.onPick(choice.tag, choice.isNew);
	}
}

/**
 * Rename a tag across the vault. The plan is recomputed as you type, so the
 * blast radius is visible before the rename is applied.
 */
export class RenameTagModal extends Modal {
	private editor: TagEditor;
	private from: string;
	private value: string;
	private includeNested: boolean;
	private hasNested: boolean;
	private onDone: (to: string, includeNested: boolean) => void;

	private previewEl!: HTMLElement;
	private submitButton: HTMLButtonElement | null = null;

	constructor(
		app: App,
		editor: TagEditor,
		from: string,
		hasNested: boolean,
		onDone: (to: string, includeNested: boolean) => void
	) {
		super(app);
		this.editor = editor;
		this.from = from;
		this.value = tagLabel(from);
		this.hasNested = hasNested;
		this.includeNested = hasNested;
		this.onDone = onDone;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("tr-modal");
		contentEl.createEl("h3", { text: `Rename ${tagLabel(this.from)}` });

		new Setting(contentEl).setName("New name").addText((text) => {
			text.setValue(this.value).onChange((value) => {
				this.value = value;
				this.updatePreview();
			});
			text.inputEl.addClass("tr-rename-input");
			text.inputEl.select();
			text.inputEl.addEventListener("keydown", (event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					this.submit();
				}
			});
			window.setTimeout(() => text.inputEl.focus(), 0);
		});

		if (this.hasNested) {
			new Setting(contentEl)
				.setName("Also rename nested tags")
				.setDesc(`${tagLabel(this.from)}/child becomes newname/child.`)
				.addToggle((toggle) =>
					toggle.setValue(this.includeNested).onChange((value) => {
						this.includeNested = value;
						this.updatePreview();
					})
				);
		}

		this.previewEl = contentEl.createDiv({ cls: "tr-modal-preview" });

		new Setting(contentEl)
			.addButton((button) =>
				button.setButtonText("Cancel").onClick(() => this.close())
			)
			.addButton((button) => {
				this.submitButton = button.buttonEl;
				button
					.setButtonText("Rename")
					.setCta()
					.onClick(() => this.submit());
			});

		this.updatePreview();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private updatePreview(): void {
		this.previewEl.empty();
		const validation = validateTagName(this.value);
		if (!validation.ok || !validation.tag) {
			this.previewEl.createDiv({
				cls: "tr-modal-error",
				text: validation.error ?? "Invalid tag name.",
			});
			this.setEnabled(false);
			return;
		}
		if (validation.tag.toLowerCase() === this.from.toLowerCase()) {
			this.previewEl.createDiv({
				cls: "tr-modal-note",
				text: "That is the current name.",
			});
			this.setEnabled(false);
			return;
		}

		const plan = this.editor.planRename(
			this.from,
			validation.tag,
			this.includeNested
		);
		if (plan.files.length === 0) {
			this.previewEl.createDiv({
				cls: "tr-modal-note",
				text: "No notes carry this tag — nothing to rewrite.",
			});
			this.setEnabled(false);
			return;
		}

		const merging = this.editor
			.filesWithTag(validation.tag, false)
			.length > 0;
		this.previewEl.createDiv({
			cls: "tr-modal-summary",
			text: `${plan.occurrences} occurrence${
				plan.occurrences === 1 ? "" : "s"
			} across ${plan.files.length} note${plan.files.length === 1 ? "" : "s"}.`,
		});
		if (merging) {
			this.previewEl.createDiv({
				cls: "tr-modal-warning",
				text: `${tagLabel(validation.tag)} already exists — the two tags will be merged.`,
			});
		}
		renderFileList(this.previewEl, plan);
		this.setEnabled(true);
	}

	private setEnabled(enabled: boolean): void {
		if (this.submitButton) this.submitButton.disabled = !enabled;
	}

	private submit(): void {
		const validation = validateTagName(this.value);
		if (!validation.ok || !validation.tag) return;
		if (validation.tag.toLowerCase() === this.from.toLowerCase()) return;
		this.close();
		this.onDone(validation.tag, this.includeNested);
	}
}

/** Confirms a bulk write, showing exactly which notes will change. */
export class ConfirmEditModal extends Modal {
	private title: string;
	private summary: string;
	private plan: EditPlan;
	private confirmLabel: string;
	private destructive: boolean;
	private onConfirm: () => void;

	constructor(
		app: App,
		options: {
			title: string;
			summary: string;
			plan: EditPlan;
			confirmLabel: string;
			destructive?: boolean;
			onConfirm: () => void;
		}
	) {
		super(app);
		this.title = options.title;
		this.summary = options.summary;
		this.plan = options.plan;
		this.confirmLabel = options.confirmLabel;
		this.destructive = options.destructive ?? false;
		this.onConfirm = options.onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("tr-modal");
		contentEl.createEl("h3", { text: this.title });
		contentEl.createDiv({ cls: "tr-modal-summary", text: this.summary });

		if (this.plan.files.length === 0) {
			contentEl.createDiv({
				cls: "tr-modal-note",
				text: "Nothing to change.",
			});
			new Setting(contentEl).addButton((button) =>
				button.setButtonText("Close").onClick(() => this.close())
			);
			return;
		}

		contentEl.createDiv({
			cls: "tr-modal-warning",
			text: "This edits your notes. Bulk edits are not covered by Obsidian's undo — make sure you have a backup or version control.",
		});
		renderFileList(contentEl, this.plan);

		new Setting(contentEl)
			.addButton((button) =>
				button.setButtonText("Cancel").onClick(() => this.close())
			)
			.addButton((button) => {
				button.setButtonText(this.confirmLabel).onClick(() => {
					this.close();
					this.onConfirm();
				});
				if (this.destructive) button.setWarning();
				else button.setCta();
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

const FILE_LIST_CAP = 200;

function renderFileList(parent: HTMLElement, plan: EditPlan): void {
	const list = parent.createDiv({ cls: "tr-modal-files" });
	for (const file of plan.files.slice(0, FILE_LIST_CAP)) {
		const row = list.createDiv({ cls: "tr-modal-file" });
		row.createSpan({ cls: "tr-modal-file-path", text: file.path });
		const parts: string[] = [];
		if (file.inline > 0) parts.push(`${file.inline} in body`);
		if (file.frontmatter > 0) parts.push(`${file.frontmatter} in frontmatter`);
		if (parts.length > 0) {
			row.createSpan({ cls: "tr-modal-file-meta", text: parts.join(", ") });
		}
	}
	if (plan.files.length > FILE_LIST_CAP) {
		list.createDiv({
			cls: "tr-modal-file-more",
			text: `+ ${plan.files.length - FILE_LIST_CAP} more`,
		});
	}
}

/**
 * Confirms removing relations. Distinct from ConfirmEditModal because that
 * one is built around a list of *files* it will rewrite; this touches no
 * files at all, and saying so plainly is most of the point.
 */
export class ConfirmRelationModal extends Modal {
	private options: {
		title: string;
		summary: string;
		note?: string;
		lines: string[];
		confirmLabel: string;
		onConfirm: () => void;
	};

	constructor(
		app: App,
		options: {
			title: string;
			summary: string;
			note?: string;
			lines: string[];
			confirmLabel: string;
			onConfirm: () => void;
		}
	) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("tr-modal");
		contentEl.createEl("h3", { text: this.options.title });
		contentEl.createDiv({ cls: "tr-modal-summary", text: this.options.summary });
		if (this.options.note) {
			contentEl.createDiv({ cls: "tr-modal-note", text: this.options.note });
		}

		if (this.options.lines.length > 0) {
			const list = contentEl.createDiv({ cls: "tr-modal-files" });
			for (const line of this.options.lines.slice(0, 200)) {
				list.createDiv({ cls: "tr-modal-file" }).createSpan({
					cls: "tr-modal-file-path",
					text: line,
				});
			}
			if (this.options.lines.length > 200) {
				list.createDiv({
					cls: "tr-modal-file-more",
					text: `+ ${this.options.lines.length - 200} more`,
				});
			}
		}

		new Setting(contentEl)
			.addButton((button) =>
				button.setButtonText("Cancel").onClick(() => this.close())
			)
			.addButton((button) =>
				button
					.setButtonText(this.options.confirmLabel)
					.setWarning()
					.onClick(() => {
						this.close();
						this.options.onConfirm();
					})
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
