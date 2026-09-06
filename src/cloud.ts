import { setTooltip } from "obsidian";
import { ModeRenderer, ViewHost, scaleByCount } from "./host";
import { tagLabel } from "./graph";

interface PillRect {
	left: number;
	top: number;
}

/**
 * The tag cloud. Tag size encodes note count; selecting a tag highlights every
 * related tag by relation strength, dims the rest, and (optionally) re-groups
 * the cloud so related tags move to the front — animated with a FLIP pass so
 * the regrouping reads as movement rather than a redraw.
 */
export class CloudRenderer implements ModeRenderer {
	private container: HTMLElement;
	private host: ViewHost;
	private pills = new Map<string, HTMLElement>();

	constructor(container: HTMLElement, host: ViewHost) {
		this.host = host;
		this.container = container.createDiv({ cls: "tr-cloud" });
		this.container.addEventListener("click", (event) => {
			if (event.target === this.container) this.host.select(null);
		});
	}

	destroy(): void {
		this.pills.clear();
		this.container.remove();
	}

	render(): void {
		const { host } = this;
		const before = host.settings.animateRegroup ? this.measure() : null;

		const tags = host.visibleTags();
		const selected = host.selected;
		const grouped =
			selected !== null && host.settings.regroupOnSelect && tags.length > 1;

		this.pruneRemovedPills(tags);
		this.container.empty();

		if (tags.length === 0) {
			this.container.createDiv({
				cls: "tr-empty",
				text: host.filter
					? "No tags match this filter."
					: "No tags found in this vault yet.",
			});
			return;
		}

		if (grouped && selected) {
			const related: string[] = [];
			const unrelated: string[] = [];
			for (const tag of tags) {
				if (tag === selected) continue;
				(host.graph.isRelated(selected, tag) ? related : unrelated).push(tag);
			}
			// Inside the related group, strongest relations come first regardless
			// of the global sort — that ordering is the whole point of grouping.
			related.sort(
				(a, b) =>
					host.graph.strength(selected, b) - host.graph.strength(selected, a) ||
					a.localeCompare(b)
			);

			this.appendGroup("Selected", [selected]);
			this.appendGroup(`Related (${related.length})`, related);
			if (unrelated.length > 0) {
				this.appendGroup(`Unrelated (${unrelated.length})`, unrelated);
			}
		} else {
			for (const tag of tags) this.container.appendChild(this.pillFor(tag));
		}

		if (before) this.flip(before);
	}

	private appendGroup(label: string, tags: string[]): void {
		if (tags.length === 0) return;
		this.container.createDiv({ cls: "tr-cloud-group", text: label });
		for (const tag of tags) this.container.appendChild(this.pillFor(tag));
	}

	private pruneRemovedPills(tags: string[]): void {
		const live = new Set(tags);
		for (const tag of Array.from(this.pills.keys())) {
			if (!live.has(tag)) this.pills.delete(tag);
		}
	}

	/** Pills are reused across renders so FLIP can animate them between layouts. */
	private pillFor(tag: string): HTMLElement {
		const { host } = this;
		let pill = this.pills.get(tag);
		if (!pill) {
			pill = createSpan({ cls: "tr-pill" });
			pill.dataset.tag = tag;
			pill.addEventListener("click", (event) => {
				event.stopPropagation();
				host.select(host.selected === tag ? null : tag);
			});
			pill.addEventListener("dblclick", (event) => {
				event.stopPropagation();
				event.preventDefault();
				host.openTagSearch(tag);
			});
			pill.addEventListener("contextmenu", (event) => {
				event.preventDefault();
				host.openContextMenu(tag, event);
			});
			this.pills.set(tag, pill);
		}

		const node = host.graph.node(tag);
		const count = node?.count ?? 0;
		const size = scaleByCount(count, host.graph.maxCount);
		const { cloudMinFontSize, cloudMaxFontSize } = host.settings;
		pill.style.fontSize =
			(cloudMinFontSize + (cloudMaxFontSize - cloudMinFontSize) * size).toFixed(
				1
			) + "px";

		pill.empty();
		pill.createSpan({ cls: "tr-pill-name", text: tagLabel(tag) });
		pill.createSpan({ cls: "tr-pill-count", text: String(count) });

		const selected = host.selected;
		pill.toggleClass("is-selected", selected === tag);
		let related = false;
		let strength = 0;
		if (selected && selected !== tag) {
			const edge = host.graph.edgeBetween(selected, tag);
			if (edge) {
				related = true;
				strength = edge.weight;
				pill.toggleClass("is-manual", edge.manual);
			} else {
				pill.removeClass("is-manual");
			}
		} else {
			pill.removeClass("is-manual");
		}
		pill.toggleClass("is-related", related);
		pill.toggleClass(
			"is-dim",
			host.settings.dimUnrelated && selected !== null && !related && selected !== tag
		);
		// Drives border/background intensity in CSS.
		pill.style.setProperty("--tr-strength", strength.toFixed(3));

		setTooltip(pill, this.tooltipFor(tag, count, related, strength), {
			placement: "top",
		});
		return pill;
	}

	private tooltipFor(
		tag: string,
		count: number,
		related: boolean,
		strength: number
	): string {
		const lines = [`${tag} — ${count} note${count === 1 ? "" : "s"}`];
		const selected = this.host.selected;
		if (related && selected) {
			const edge = this.host.graph.edgeBetween(selected, tag);
			const pct = Math.round(strength * 100);
			if (edge?.manual) {
				lines.push(
					`Connected to ${selected} manually${edge.label ? ` — ${edge.label}` : ""}`
				);
			} else {
				lines.push(
					`${pct}% related to ${selected} · ${edge?.cooccur ?? 0} shared note${
						edge?.cooccur === 1 ? "" : "s"
					}`
				);
			}
		} else {
			const degree = this.host.graph.neighbors(tag).length;
			lines.push(`${degree} relation${degree === 1 ? "" : "s"}`);
		}
		return lines.join("\n");
	}

	private measure(): Map<string, PillRect> {
		const rects = new Map<string, PillRect>();
		for (const [tag, pill] of this.pills) {
			if (!pill.isConnected) continue;
			const box = pill.getBoundingClientRect();
			rects.set(tag, { left: box.left, top: box.top });
		}
		return rects;
	}

	/**
	 * First-Last-Invert-Play: pills are already at their new position, so we
	 * offset them back to where they were and let a transition carry them home.
	 */
	private flip(before: Map<string, PillRect>): void {
		const moved: HTMLElement[] = [];
		for (const [tag, pill] of this.pills) {
			const previous = before.get(tag);
			if (!previous || !pill.isConnected) continue;
			const box = pill.getBoundingClientRect();
			const dx = previous.left - box.left;
			const dy = previous.top - box.top;
			if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
			pill.style.transition = "none";
			pill.style.transform = `translate(${dx}px, ${dy}px)`;
			moved.push(pill);
		}
		if (moved.length === 0) return;
		// Force a reflow so the inverted position is committed before we animate.
		void this.container.offsetHeight;
		for (const pill of moved) {
			pill.style.transition = "transform 260ms cubic-bezier(0.2, 0, 0.2, 1)";
			pill.style.transform = "";
		}
		window.setTimeout(() => {
			for (const pill of moved) {
				pill.style.transition = "";
			}
		}, 300);
	}
}
