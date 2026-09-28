import type { PreviewMode } from "../config.ts";
import type { Theme } from "../host.ts";
import {
	type Component,
	decodePrintableKey,
	matchesKey,
	type TUI,
	wrapTextWithAnsi,
} from "../host.ts";
import { createPromptDiff, type PromptDiff } from "./diff.ts";
import { renderPromptDiffView } from "./diff-render.ts";
import { overlayFrame, sanitizeInline, wrapPlainText } from "./frame.ts";
import { bindingLabel, keyHint, matchesBinding } from "./keys.ts";
import { clampViewportOffset, sliceViewport } from "./viewport.ts";

function rawKeyHint(key: string, description: string): string {
	return `${key} ${description}`;
}

export type ReviewAction =
	| "accept"
	| "edit"
	| "retry"
	| "model"
	| "context"
	| "previous"
	| "cancel";
export interface ReviewPosition {
	view: PreviewMode;
	offset: number;
}
type ReviewView = PreviewMode | "diff";

const PREVIEW_ROWS = 11;
const REVIEW_ACTION_BY_KEY: Readonly<Record<string, ReviewAction>> = {
	a: "accept",
	e: "edit",
	r: "retry",
	m: "model",
	q: "cancel",
	c: "context",
	b: "previous",
};

export interface PromptReviewOptions {
	original: string;
	optimized: string;
	initialView: PreviewMode;
	modelRef: string;
	contextSummary: string;
	warning?: string;
	hasPrevious?: boolean;
	position?: ReviewPosition;
	onAction: (action: ReviewAction) => void;
}

export class PromptReviewComponent implements Component {
	readonly width = 82;
	private view: ReviewView;
	private scrollOffset = 0;
	private renderedLineCount = 0;
	private readonly diff: PromptDiff;
	private changeOffsets: number[] = [];
	private previewRows = PREVIEW_ROWS;
	private lastWidth = 76;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly options: PromptReviewOptions,
	) {
		this.view = options.position?.view ?? options.initialView;
		this.scrollOffset = options.position?.offset ?? 0;
		this.diff = createPromptDiff(options.original, options.optimized);
	}

	handleInput(data: string): void {
		if (this.handleControlInput(data)) return;
		const key = (
			decodePrintableKey(data) ?? (data.length === 1 ? data : "")
		).toLowerCase();
		this.handleShortcutKey(key);
	}

	private handleControlInput(data: string): boolean {
		if (matchesBinding(data, "tui.select.cancel")) {
			this.options.onAction("cancel");
			return true;
		}
		if (matchesBinding(data, "tui.select.confirm")) {
			this.options.onAction("accept");
			return true;
		}
		if (matchesKey(data, "tab")) {
			this.cycleView();
			return true;
		}
		const step = this.scrollStep(data);
		if (step !== 0) {
			this.scrollBy(step);
			return true;
		}
		if (matchesKey(data, "home")) {
			this.setScrollOffset(0);
			return true;
		}
		if (matchesKey(data, "end")) {
			this.setScrollOffset(this.renderedLineCount);
			return true;
		}
		return false;
	}

	private scrollStep(data: string): number {
		if (matchesBinding(data, "tui.select.up")) return -1;
		if (matchesBinding(data, "tui.select.down")) return 1;
		if (matchesBinding(data, "tui.select.pageUp")) return -this.previewRows;
		if (matchesBinding(data, "tui.select.pageDown")) return this.previewRows;
		return 0;
	}

	private handleShortcutKey(key: string): void {
		if (key === "n" || key === "]" || key === "p" || key === "[") {
			this.jumpChange(key === "n" || key === "]" ? 1 : -1);
		} else if (key === "v") this.cycleView();
		else if (key === "d") this.setView("diff");
		else if (key === "o") this.setView("original");
		else {
			const action = REVIEW_ACTION_BY_KEY[key];
			if (action && (action !== "previous" || this.options.hasPrevious))
				this.options.onAction(action);
		}
	}

	private jumpChange(direction: number): void {
		const wasDiff = this.view === "diff";
		this.view = "diff";
		this.contentRows(this.lastWidth);
		const offsets = this.changeOffsets.map((offset) =>
			clampViewportOffset(offset, this.renderedLineCount, this.previewRows),
		);
		const target = !wasDiff
			? offsets[0]
			: direction > 0
				? (offsets.find((offset) => offset > this.scrollOffset) ?? offsets[0])
				: (offsets.findLast((offset) => offset < this.scrollOffset) ??
					offsets.at(-1));
		this.setScrollOffset(target ?? 0);
	}

	private cycleView(): void {
		if (this.view === "optimized") this.setView("diff");
		else if (this.view === "diff") this.setView("original");
		else this.setView("optimized");
	}

	private setView(view: ReviewView): void {
		this.view = view;
		this.scrollOffset = 0;
		this.tui.requestRender();
	}

	private scrollBy(delta: number): void {
		this.setScrollOffset(this.scrollOffset + delta);
	}

	private setScrollOffset(offset: number): void {
		this.scrollOffset = clampViewportOffset(
			offset,
			this.renderedLineCount,
			this.previewRows,
		);
		this.tui.requestRender();
	}

	private contentRows(width: number): string[] {
		if (this.view === "diff") {
			const rendered = renderPromptDiffView(this.diff, this.theme, width);
			this.changeOffsets = rendered.changeOffsets;
			this.renderedLineCount = rendered.rows.length;
			return rendered.rows;
		}

		const shown =
			this.view === "optimized"
				? this.options.optimized
				: this.options.original;
		return wrapPlainText(shown, width).map((line) =>
			this.theme.fg("text", line),
		);
	}

	private heading(): string {
		if (this.view === "diff") {
			const coarse = this.diff.coarse ? " · coarse comparison" : "";
			return `${this.theme.fg("accent", this.theme.bold("CHANGES"))}${this.theme.fg("dim", " · ")}${this.theme.fg("success", `+${this.diff.addedCharacters}`)}${this.theme.fg("dim", " / ")}${this.theme.fg("error", `-${this.diff.removedCharacters}`)}${this.theme.fg("dim", ` chars${coarse}`)}`;
		}
		const shown =
			this.view === "optimized"
				? this.options.optimized
				: this.options.original;
		const label =
			this.view === "optimized"
				? this.options.optimized === this.options.original
					? "ALREADY GOOD"
					: "CHISELED"
				: "ORIGINAL";
		return `${this.theme.fg("accent", this.theme.bold(label))}${this.theme.fg("dim", ` · ${shown.length.toLocaleString()} chars`)}`;
	}

	private tabLabel(): string {
		if (this.view === "optimized") return "compare";
		if (this.view === "diff") return "show original";
		return "show chiseled";
	}

	private wrappedRow(
		text: string,
		color: "muted" | "warning",
		width: number,
	): string[] {
		const safe = sanitizeInline(text);
		return wrapTextWithAnsi(this.theme.fg(color, safe), Math.max(1, width)).map(
			(line) => ` ${line}`,
		);
	}

	render(width: number): string[] {
		const inner = Math.max(10, width - 6);
		this.lastWidth = inner;
		this.previewRows = Math.max(
			3,
			Math.min(20, Math.floor((this.tui.terminal?.rows ?? 42) * 0.84) - 24),
		);
		const content = this.contentRows(inner);
		this.renderedLineCount = content.length;
		const viewport = sliceViewport(
			content,
			this.scrollOffset,
			this.previewRows,
		);
		this.scrollOffset = viewport.offset;
		if (this.options.position) {
			this.options.position.view = this.view;
			this.options.position.offset = this.scrollOffset;
		}

		const body = [
			` ${this.theme.fg("accent", this.theme.bold("✦ Fresh off the Chisel"))}`,
			...this.wrappedRow(`Model: ${this.options.modelRef}`, "muted", inner),
			...this.wrappedRow(
				`Context supplied: ${this.options.contextSummary}`,
				"muted",
				inner,
			),
			...this.wrappedRow(
				"Still unsent · Enter replaces your draft; nothing gets submitted",
				"muted",
				inner,
			),
			...(this.options.warning
				? this.wrappedRow(this.options.warning, "warning", inner)
				: []),
			"",
			` ${this.heading()}`,
			"",
			...viewport.items.map((line) => `  ${line}`),
		];

		if (viewport.hasOverflow) {
			const first = viewport.offset + 1;
			const last = viewport.offset + viewport.items.length;
			body.push(
				` ${this.theme.fg("muted", `Rows ${first}–${last} of ${viewport.total} · ${bindingLabel("tui.select.up")}${bindingLabel("tui.select.down")} or ${bindingLabel("tui.select.pageUp")}/${bindingLabel("tui.select.pageDown")} scroll`)}`,
			);
		}

		const primary = `${keyHint("tui.select.confirm", "use this")}  ${rawKeyHint("e", "tune it")}  ${rawKeyHint("tab", this.tabLabel())}`;
		const secondary = `${rawKeyHint("r", "another pass")}  ${rawKeyHint("c", "context")}  ${rawKeyHint("m", "switch model")}${this.options.hasPrevious ? "  b previous candidate" : ""}`;
		const exit = keyHint("tui.select.cancel", "keep original");
		const primaryRows = wrapTextWithAnsi(
			this.theme.fg("accent", primary),
			inner,
		).map((line) => ` ${line}`);
		const secondaryRows = wrapTextWithAnsi(
			this.theme.fg("muted", secondary),
			inner,
		).map((line) => ` ${line}`);
		const exitRows = wrapTextWithAnsi(this.theme.fg("muted", exit), inner).map(
			(line) => ` ${line}`,
		);
		body.push(
			"",
			...primaryRows,
			...secondaryRows,
			...(this.view === "diff"
				? this.wrappedRow(
						"n/p next/previous change · d changes · o original",
						"muted",
						inner,
					)
				: []),
			...exitRows,
		);

		return overlayFrame(this.theme, width, body, true);
	}

	invalidate(): void {}
}
