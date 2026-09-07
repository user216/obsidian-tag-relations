/**
 * Pan-and-zoom surface for the DOM-based views.
 *
 * The mind-map draws to a canvas and owns its own camera; the cloud, groups
 * and tree views are real DOM so they can keep inline renaming, text
 * selection and the FLIP animation. Rather than rewriting them onto canvas,
 * this wraps their content in a CSS-transformed layer: the browser still lays
 * the tags out normally, and the transform moves and scales the result.
 *
 * `transform-origin: 0 0` keeps the arithmetic simple — a point in content
 * space maps to `point * scale + offset` on screen, so the wheel handler can
 * hold the point under the cursor still with two lines of algebra.
 */
export interface PanZoomState {
	scale: number;
	x: number;
	y: number;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 5;

export class PanZoom {
	/** The clipping viewport; the caller fills `content`. */
	readonly viewport: HTMLElement;
	readonly content: HTMLElement;

	private state: PanZoomState = { scale: 1, x: 0, y: 0 };
	private panning = false;
	private moved = false;
	private last = { x: 0, y: 0 };
	private onChange: (state: PanZoomState) => void;

	constructor(
		parent: HTMLElement,
		options: { onChange?: (state: PanZoomState) => void } = {}
	) {
		this.onChange = options.onChange ?? (() => undefined);
		this.viewport = parent.createDiv({ cls: "tr-panzoom" });
		this.content = this.viewport.createDiv({ cls: "tr-panzoom-content" });

		this.viewport.addEventListener("wheel", this.onWheel, { passive: false });
		this.viewport.addEventListener("pointerdown", this.onPointerDown);
		this.viewport.addEventListener("pointermove", this.onPointerMove);
		this.viewport.addEventListener("pointerup", this.onPointerUp);
		this.viewport.addEventListener("pointercancel", this.onPointerUp);
	}

	destroy(): void {
		this.viewport.remove();
	}

	get scale(): number {
		return this.state.scale;
	}

	/** True when the pointer travelled far enough to count as a pan, not a click. */
	get didPan(): boolean {
		return this.moved;
	}

	setScale(scale: number): void {
		this.state.scale = clampScale(scale);
		this.apply();
	}

	reset(): void {
		this.state = { scale: 1, x: 0, y: 0 };
		this.apply();
	}

	/** Restore a persisted zoom without disturbing the pan offset. */
	restoreScale(scale: number): void {
		this.state.scale = clampScale(scale);
		this.apply();
	}

	zoomBy(factor: number): void {
		// Zoom about the middle of the viewport, which is what a button implies.
		const rect = this.viewport.getBoundingClientRect();
		this.zoomAt(this.state.scale * factor, rect.width / 2, rect.height / 2);
	}

	/** Scale the content to fit, then centre it. */
	fit(): void {
		const view = this.viewport.getBoundingClientRect();
		const inner = this.content.scrollWidth;
		const innerHeight = this.content.scrollHeight;
		if (inner <= 0 || innerHeight <= 0 || view.width <= 0) return;

		const scale = clampScale(
			Math.min(view.width / inner, view.height / innerHeight, 1)
		);
		this.state.scale = scale;
		this.state.x = Math.max(0, (view.width - inner * scale) / 2);
		this.state.y = 0;
		this.apply();
	}

	private zoomAt(nextScale: number, px: number, py: number): void {
		const scale = clampScale(nextScale);
		if (scale === this.state.scale) return;
		// Hold the content point under (px, py) still across the scale change.
		const contentX = (px - this.state.x) / this.state.scale;
		const contentY = (py - this.state.y) / this.state.scale;
		this.state.scale = scale;
		this.state.x = px - contentX * scale;
		this.state.y = py - contentY * scale;
		this.apply();
	}

	private apply(): void {
		this.content.style.transform = `translate(${this.state.x}px, ${this.state.y}px) scale(${this.state.scale})`;
		this.onChange({ ...this.state });
	}

	private onWheel = (event: WheelEvent): void => {
		// Plain scrolling should still scroll; only zoom on the usual modifier,
		// matching how editors and browsers behave.
		if (!event.ctrlKey && !event.metaKey) return;
		event.preventDefault();
		const rect = this.viewport.getBoundingClientRect();
		const factor = Math.exp(-event.deltaY * 0.0015);
		this.zoomAt(
			this.state.scale * factor,
			event.clientX - rect.left,
			event.clientY - rect.top
		);
	};

	private onPointerDown = (event: PointerEvent): void => {
		// Only drag from empty space, so clicking a tag still selects it.
		if (event.button !== 0) return;
		if (event.target !== this.viewport && event.target !== this.content) return;
		this.panning = true;
		this.moved = false;
		this.last = { x: event.clientX, y: event.clientY };
		this.viewport.addClass("is-panning");
		this.viewport.setPointerCapture(event.pointerId);
	};

	private onPointerMove = (event: PointerEvent): void => {
		if (!this.panning) return;
		const dx = event.clientX - this.last.x;
		const dy = event.clientY - this.last.y;
		if (Math.abs(dx) > 2 || Math.abs(dy) > 2) this.moved = true;
		this.state.x += dx;
		this.state.y += dy;
		this.last = { x: event.clientX, y: event.clientY };
		this.apply();
	};

	private onPointerUp = (event: PointerEvent): void => {
		if (!this.panning) return;
		this.panning = false;
		this.viewport.removeClass("is-panning");
		if (this.viewport.hasPointerCapture(event.pointerId)) {
			this.viewport.releasePointerCapture(event.pointerId);
		}
	};
}

export function clampScale(scale: number): number {
	if (!Number.isFinite(scale)) return 1;
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}
