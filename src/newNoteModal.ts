import { App, Modal, Setting, setIcon, setTooltip } from "obsidian";
import { tagLabel } from "./graph";
import { TagSuggestion, tagSuggestions } from "./tagSuggest";

export interface NewNoteModalOptions {
	/** Tags the note starts with — usually the current selection. */
	initialTags: string[];
	/** Every tag that could be picked. */
	allTags: string[];
	/** The filename the note would get right now, recomputed as it is shown. */
	previewTitle(): string;
	onCreate(tags: string[]): void;
}

/**
 * A render cap, not a visible count — the list scrolls, so this only exists
 * so a vault with thousands of tags does not build thousands of rows on every
 * keystroke. Anything beyond this is reachable by typing to narrow instead.
 */
const MAX_RENDERED_SUGGESTIONS = 200;

/**
 * The new-note dialog: choose any number of tags, then create.
 *
 * Obsidian's own `SuggestModal` closes as soon as something is chosen, which
 * is right for picking one thing and wrong for building a list. So this is a
 * plain `Modal` with its own input and suggestion list, keeping the same
 * "type a name that does not exist to create it" behaviour via the shared
 * `tagSuggestions` helper.
 *
 * The keyboard path is the point — arrow keys move, Enter adds, Backspace on
 * an empty input takes the last tag back off, and Ctrl/Cmd+Enter creates from
 * anywhere — so a note can be tagged and made without touching the mouse.
 */
export class NewNoteModal extends Modal {
	private options: NewNoteModalOptions;
	private chosen: string[];
	private query = "";
	/** Index into the currently rendered suggestions, or -1 for none. */
	private highlighted = 0;
	private suggestions: TagSuggestion[] = [];

	private chipsEl!: HTMLElement;
	private inputEl!: HTMLInputElement;
	private listEl!: HTMLElement;
	private previewEl!: HTMLElement;

	constructor(app: App, options: NewNoteModalOptions) {
		super(app);
		this.options = options;
		// De-duplicated, but order preserved: the selection order is meaningful.
		this.chosen = Array.from(new Set(options.initialTags));
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("tr-modal");
		contentEl.addClass("tr-new-note-modal");
		contentEl.createEl("h3", { text: "New note" });

		this.previewEl = contentEl.createDiv({ cls: "tr-new-note-preview" });

		this.chipsEl = contentEl.createDiv({ cls: "tr-chips tr-new-note-chips" });

		const search = contentEl.createDiv({ cls: "tr-new-note-search" });
		setIcon(search.createSpan({ cls: "tr-search-icon" }), "search");
		this.inputEl = search.createEl("input", {
			cls: "tr-search-input",
			type: "text",
			placeholder: "Type to find a tag, or a new name to create one…",
		});
		this.inputEl.addEventListener("input", () => {
			this.query = this.inputEl.value;
			this.highlighted = 0;
			this.renderSuggestions();
		});
		this.inputEl.addEventListener("keydown", (event) => this.onKeyDown(event));

		this.listEl = contentEl.createDiv({ cls: "tr-new-note-suggestions" });

		new Setting(contentEl)
			.addButton((button) =>
				button.setButtonText("Cancel").onClick(() => this.close())
			)
			.addButton((button) =>
				button
					.setButtonText("Create note")
					.setCta()
					.onClick(() => this.submit())
			);

		this.renderPreview();
		this.renderChips();
		this.renderSuggestions();
		window.setTimeout(() => this.inputEl.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderPreview(): void {
		this.previewEl.empty();
		this.previewEl.createSpan({
			cls: "tr-preview-label",
			text: "Will create: ",
		});
		this.previewEl.createSpan({
			cls: "tr-preview-value",
			text: `${this.options.previewTitle()}.md`,
		});
		const count = this.chosen.length;
		this.previewEl.createSpan({
			cls: "tr-new-note-count",
			text:
				count === 0
					? " · no tags"
					: ` · ${count} tag${count === 1 ? "" : "s"}`,
		});
	}

	private renderChips(): void {
		this.chipsEl.empty();
		this.chipsEl.toggleClass("is-empty", this.chosen.length === 0);
		if (this.chosen.length === 0) {
			this.chipsEl.createDiv({
				cls: "tr-new-note-empty",
				text: "No tags yet — the note will be created untagged.",
			});
			return;
		}
		for (const tag of this.chosen) {
			const chip = this.chipsEl.createDiv({ cls: "tr-chip" });
			chip.createSpan({ cls: "tr-chip-name", text: tagLabel(tag) });
			const remove = chip.createSpan({ cls: "tr-chip-remove" });
			setIcon(remove, "x");
			setTooltip(remove, `Remove ${tagLabel(tag)}`, { placement: "top" });
			remove.addEventListener("click", () => this.removeTag(tag));
		}
	}

	private renderSuggestions(): void {
		this.suggestions = tagSuggestions(this.query, this.options.allTags, {
			exclude: this.chosen,
			limit: MAX_RENDERED_SUGGESTIONS,
		});
		this.listEl.empty();

		if (this.suggestions.length === 0) {
			this.listEl.createDiv({
				cls: "tr-new-note-empty",
				text:
					this.query.trim().length === 0
						? "Every tag is already added."
						: "No match, and that is not a usable tag name.",
			});
			return;
		}

		this.highlighted = Math.min(
			Math.max(this.highlighted, 0),
			this.suggestions.length - 1
		);

		this.suggestions.forEach((suggestion, index) => {
			const row = this.listEl.createDiv({ cls: "tr-new-note-suggestion" });
			row.toggleClass("is-highlighted", index === this.highlighted);
			if (suggestion.isNew) {
				const icon = row.createSpan({ cls: "tr-choice-icon" });
				setIcon(icon, "plus");
			}
			row.createSpan({
				cls: "tr-choice-name",
				text: tagLabel(suggestion.tag),
			});
			if (suggestion.isNew) {
				row.createSpan({ cls: "tr-choice-sub", text: "new tag" });
			}
			row.addEventListener("click", () => this.addTag(suggestion.tag));
			row.addEventListener("mouseenter", () => {
				this.highlighted = index;
				this.updateHighlight();
			});
		});
	}

	/** Cheaper than a full re-render when only the highlight moved. */
	private updateHighlight(): void {
		const rows = Array.from(
			this.listEl.querySelectorAll<HTMLElement>(".tr-new-note-suggestion")
		);
		rows.forEach((row, index) =>
			row.toggleClass("is-highlighted", index === this.highlighted)
		);
		rows[this.highlighted]?.scrollIntoView({ block: "nearest" });
	}

	private addTag(tag: string): void {
		if (!this.chosen.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
			this.chosen.push(tag);
		}
		// Cleared so the next tag can be typed straight away, which is what
		// makes adding several in a row feel like one gesture.
		this.query = "";
		this.inputEl.value = "";
		this.highlighted = 0;
		this.renderPreview();
		this.renderChips();
		this.renderSuggestions();
		this.inputEl.focus();
	}

	private removeTag(tag: string): void {
		this.chosen = this.chosen.filter((existing) => existing !== tag);
		this.renderPreview();
		this.renderChips();
		this.renderSuggestions();
		this.inputEl.focus();
	}

	private onKeyDown(event: KeyboardEvent): void {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			this.highlighted = Math.min(
				this.highlighted + 1,
				this.suggestions.length - 1
			);
			this.updateHighlight();
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			this.highlighted = Math.max(this.highlighted - 1, 0);
			this.updateHighlight();
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			// Ctrl/Cmd+Enter always creates, even mid-typing.
			if (event.ctrlKey || event.metaKey) {
				this.submit();
				return;
			}
			const suggestion = this.suggestions[this.highlighted];
			if (suggestion) this.addTag(suggestion.tag);
			// An empty box with nothing to add means "I am done".
			else if (this.query.trim().length === 0) this.submit();
			return;
		}
		if (
			event.key === "Backspace" &&
			this.query.length === 0 &&
			this.chosen.length > 0
		) {
			event.preventDefault();
			this.removeTag(this.chosen[this.chosen.length - 1]);
		}
	}

	private submit(): void {
		// Whatever is still in the box was typed on purpose. Discarding it
		// silently loses the tag the user thought they were adding — which is
		// especially easy to hit with a brand-new name, where the only thing
		// on screen is a "create this" row they may reasonably expect the
		// Create button to honour.
		this.commitPending();
		const tags = this.chosen.slice();
		this.close();
		this.options.onCreate(tags);
	}

	/** Add whatever the box currently points at, if anything. */
	private commitPending(): void {
		if (this.query.trim().length === 0) return;
		const pending =
			this.suggestions[this.highlighted] ?? this.suggestions[0] ?? null;
		if (pending) this.addTag(pending.tag);
	}
}
