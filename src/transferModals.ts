import { App, Modal, Notice, Setting, TFile } from "obsidian";
import { TagSuggestModal } from "./modals";
import { ImportPlan, MergeMode, parseImport, planImport } from "./transfer";
import type { RelationPayload } from "./transfer";

/**
 * Paste or load an export file, see exactly what it would change, then apply.
 *
 * Import is shown as a plan before it runs for the same reason tag edits are
 * (ADR 0006): the user is handing the plugin a file they may not have written
 * themselves, and "what is this about to do to my structure" deserves an
 * answer before rather than after.
 */
export class ImportRelationsModal extends Modal {
	private current: RelationPayload;
	private maxPinned: number;
	private onApply: (payload: RelationPayload) => void;

	private text = "";
	private mode: MergeMode = "merge";
	private textArea!: HTMLTextAreaElement;
	private reportEl!: HTMLElement;
	private applyButton: HTMLButtonElement | null = null;

	constructor(
		app: App,
		options: {
			current: RelationPayload;
			maxPinned: number;
			onApply: (payload: RelationPayload) => void;
		}
	) {
		super(app);
		this.current = options.current;
		this.maxPinned = options.maxPinned;
		this.onApply = options.onApply;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("tr-modal");
		contentEl.createEl("h3", { text: "Import relations" });
		contentEl.createDiv({
			cls: "tr-modal-note",
			text: "Paste an exported file, or load one from your vault. Only horizontal links, group membership and pins are imported — tags and shared-note relations come from your notes and are already there.",
		});

		new Setting(contentEl)
			.setName("Load from the vault")
			.setDesc("Pick a .json file already in this vault.")
			.addButton((button) =>
				button.setButtonText("Choose a file…").onClick(() => this.pickFile())
			);

		this.textArea = contentEl.createEl("textarea", {
			cls: "tr-import-textarea",
			attr: { placeholder: "Paste the contents of an export file here…" },
		});
		this.textArea.addEventListener("input", () => {
			this.text = this.textArea.value;
			this.renderReport();
		});

		new Setting(contentEl)
			.setName("How to apply it")
			.addDropdown((dd) =>
				dd
					.addOption("merge", "Merge — keep what is here, add what is missing")
					.addOption("replace", "Replace — discard what is here first")
					.setValue(this.mode)
					.onChange((value) => {
						this.mode = value as MergeMode;
						this.renderReport();
					})
			);

		this.reportEl = contentEl.createDiv({ cls: "tr-modal-preview" });

		new Setting(contentEl)
			.addButton((button) =>
				button.setButtonText("Cancel").onClick(() => this.close())
			)
			.addButton((button) => {
				this.applyButton = button.buttonEl;
				button
					.setButtonText("Import")
					.setCta()
					.onClick(() => this.apply());
			});

		this.renderReport();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private pickFile(): void {
		const files = this.app.vault
			.getFiles()
			.filter((file) => file.extension === "json")
			.map((file) => file.path)
			.sort((a, b) => a.localeCompare(b));
		if (files.length === 0) {
			new Notice("No .json files found in this vault.");
			return;
		}
		new TagSuggestModal(this.app, files, "Which file?", (path) => {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) return;
			void this.app.vault.read(file).then((content) => {
				this.text = content;
				this.textArea.value = content;
				this.renderReport();
			});
		}).open();
	}

	/** The current plan, or null when the text is unusable. */
	private currentPlan(): ImportPlan | null {
		if (this.text.trim().length === 0) return null;
		const parsed = parseImport(this.text);
		if (!parsed.ok || !parsed.payload) return null;
		return planImport(this.current, parsed.payload, this.mode, this.maxPinned);
	}

	private renderReport(): void {
		this.reportEl.empty();
		if (this.text.trim().length === 0) {
			this.reportEl.createDiv({
				cls: "tr-modal-note",
				text: "Nothing pasted yet.",
			});
			this.setEnabled(false);
			return;
		}

		const parsed = parseImport(this.text);
		if (!parsed.ok || !parsed.payload) {
			this.reportEl.createDiv({
				cls: "tr-modal-error",
				text: parsed.error ?? "That file could not be read.",
			});
			this.setEnabled(false);
			return;
		}
		for (const warning of parsed.warnings) {
			this.reportEl.createDiv({ cls: "tr-modal-warning", text: warning });
		}

		const plan = planImport(
			this.current,
			parsed.payload,
			this.mode,
			this.maxPinned
		);
		const parts = [
			`${plan.addedLinks} horizontal link${plan.addedLinks === 1 ? "" : "s"}`,
			`${plan.addedGroups} group membership${plan.addedGroups === 1 ? "" : "s"}`,
			`${plan.addedPins} pin${plan.addedPins === 1 ? "" : "s"}`,
		];
		this.reportEl.createDiv({
			cls: "tr-modal-summary",
			text:
				this.mode === "replace"
					? `Everything currently stored will be discarded, then ${parts.join(", ")} added.`
					: `Will add ${parts.join(", ")}.`,
		});

		if (plan.rejectedGroups.length > 0) {
			this.reportEl.createDiv({
				cls: "tr-modal-warning",
				text: `${plan.rejectedGroups.length} group membership(s) cannot be applied without breaking the three-level rule, and will be skipped.`,
			});
			const list = this.reportEl.createDiv({ cls: "tr-modal-files" });
			for (const rejected of plan.rejectedGroups.slice(0, 50)) {
				list.createDiv({ cls: "tr-modal-file" }).createSpan({
					cls: "tr-modal-file-path",
					text: `${rejected.link.parent} → ${rejected.link.child}: ${rejected.reason}`,
				});
			}
		}
		if (plan.droppedPins > 0) {
			this.reportEl.createDiv({
				cls: "tr-modal-warning",
				text: `${plan.droppedPins} pin(s) skipped — the pin limit is already reached.`,
			});
		}

		this.setEnabled(true);
	}

	private setEnabled(enabled: boolean): void {
		if (this.applyButton) this.applyButton.disabled = !enabled;
	}

	private apply(): void {
		const plan = this.currentPlan();
		if (!plan) return;
		this.close();
		this.onApply(plan.result);
	}
}
