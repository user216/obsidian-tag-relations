import { App, FuzzySuggestModal, FuzzyMatch } from "obsidian";
import { tagLabel } from "./graph";

/** Fuzzy picker over a list of tags, used for focusing and for connecting tags. */
export class TagSuggestModal extends FuzzySuggestModal<string> {
	private tags: string[];
	private onPick: (tag: string) => void;
	private subtitles: Map<string, string>;

	constructor(
		app: App,
		tags: string[],
		placeholder: string,
		onPick: (tag: string) => void,
		subtitles?: Map<string, string>
	) {
		super(app);
		this.tags = tags;
		this.onPick = onPick;
		this.subtitles = subtitles ?? new Map();
		this.setPlaceholder(placeholder);
	}

	getItems(): string[] {
		return this.tags;
	}

	getItemText(item: string): string {
		return tagLabel(item);
	}

	renderSuggestion(match: FuzzyMatch<string>, el: HTMLElement): void {
		super.renderSuggestion(match, el);
		const subtitle = this.subtitles.get(match.item);
		if (subtitle) {
			el.createDiv({ cls: "tr-suggest-note", text: subtitle });
		}
	}

	onChooseItem(item: string): void {
		this.onPick(item);
	}
}
