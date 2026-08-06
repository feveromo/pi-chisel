import { rawKeyHint, type Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	decodeKittyPrintable,
	matchesKey,
	type TUI,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { PreviewMode } from "../config.ts";
import { createPromptDiff, type PromptDiff } from "./diff.ts";
import { renderPromptDiffRows } from "./diff-render.ts";
import { overlayFrame, sanitizeInline, wrapPlainText } from "./frame.ts";
import { clampViewportOffset, sliceViewport } from "./viewport.ts";

export type ReviewAction = "accept" | "edit" | "retry" | "model" | "cancel";
type ReviewView = PreviewMode | "diff";

const PREVIEW_ROWS = 11;
const SCROLL_KEYS = [
	["up", -1],
	["down", 1],
	["pageUp", -PREVIEW_ROWS],
	["pageDown", PREVIEW_ROWS],
] as const;
const REVIEW_ACTION_BY_KEY: Readonly<Record<string, ReviewAction>> = {
	a: "accept",
	e: "edit",
	r: "retry",
	m: "model",
	q: "cancel",
};

export interface PromptReviewOptions {
	original: string;
	optimized: string;
	initialView: PreviewMode;
	modelRef: string;
	contextSummary: string;
	warning?: string;
	onAction: (action: ReviewAction) => void;
}

export class PromptReviewComponent implements Component {
	readonly width = 82;
	private view: ReviewView;
	private scrollOffset = 0;
	private renderedLineCount = 0;
	private readonly diff: PromptDiff;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly options: PromptReviewOptions,
	) {
		this.view = options.initialView;
		this.diff = createPromptDiff(options.original, options.optimized);
	}

	handleInput(data: string): void {
		if (this.handleControlInput(data)) return;
		const key = (
			decodeKittyPrintable(data) ?? (data.length === 1 ? data : "")
		).toLowerCase();
		this.handleShortcutKey(key);
	}

	private handleControlInput(data: string): boolean {
		if (matchesKey(data, "escape")) {
			this.options.onAction("cancel");
			return true;
		}
		if (matchesKey(data, "enter")) {
			this.options.onAction("accept");
			return true;
		}
		if (matchesKey(data, "tab")) {
			this.cycleView();
			return true;
		}
		for (const [key, delta] of SCROLL_KEYS) {
			if (!matchesKey(data, key)) continue;
			this.scrollBy(delta);
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

	private handleShortcutKey(key: string): void {
		if (key === "v") this.cycleView();
		else if (key === "d") this.setView("diff");
		else if (key === "o") this.setView("original");
		else {
			const action = REVIEW_ACTION_BY_KEY[key];
			if (action) this.options.onAction(action);
		}
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
			PREVIEW_ROWS,
		);
		this.tui.requestRender();
	}

	private contentRows(width: number): string[] {
		if (this.view === "diff")
			return renderPromptDiffRows(this.diff, this.theme, width);

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
		const label = this.view === "optimized" ? "CHISELED" : "ORIGINAL";
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
		const content = this.contentRows(inner);
		this.renderedLineCount = content.length;
		const viewport = sliceViewport(content, this.scrollOffset, PREVIEW_ROWS);
		this.scrollOffset = viewport.offset;

		const body = [
			` ${this.theme.fg("accent", this.theme.bold("✦ Fresh off the Chisel"))}`,
			...this.wrappedRow(`Model: ${this.options.modelRef}`, "muted", inner),
			...this.wrappedRow(
				`Grounded in: ${this.options.contextSummary}`,
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
				` ${this.theme.fg("muted", `Rows ${first}–${last} of ${viewport.total} · ↑↓ or PgUp/PgDn scroll`)}`,
			);
		}

		const primary = `${rawKeyHint("enter", "use this")}  ${rawKeyHint("e", "tune it")}  ${rawKeyHint("tab", this.tabLabel())}`;
		const secondary = `${rawKeyHint("r", "another pass")}  ${rawKeyHint("m", "switch model")}`;
		const exit = rawKeyHint("esc", "keep original");
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
		body.push("", ...primaryRows, ...secondaryRows, ...exitRows);

		return overlayFrame(this.theme, width, body, true);
	}

	invalidate(): void {}
}
