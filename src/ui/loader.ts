import {
	type Component,
	createProgressLoader,
	type Theme,
	type TUI,
	visibleWidth,
} from "../host.ts";
import { overlayFrame, sanitizeInline, wrapPlainText } from "./frame.ts";
import { keyHint } from "./keys.ts";

export class PromptOptimizationLoader implements Component {
	private readonly loader: ReturnType<typeof createProgressLoader>;

	constructor(
		tui: TUI,
		private readonly theme: Theme,
		private readonly modelRef: string,
		private readonly contextSummary: string,
		private readonly warning?: string,
	) {
		this.loader = createProgressLoader(
			tui,
			(text) => theme.fg("accent", text),
			(text) => theme.fg("text", text),
			"Shaping a sharper prompt…",
			["·", "○", "◌", "●", "◌", "○"],
		);
	}

	get signal(): AbortSignal {
		return this.loader.signal;
	}

	set onAbort(callback: (() => void) | undefined) {
		if (callback) this.loader.onAbort = callback;
		else delete this.loader.onAbort;
	}

	setProgress(characters: number): void {
		if (characters > 0)
			this.loader.setMessage(
				`Shaping a sharper prompt… ${characters.toLocaleString()} chars`,
			);
	}

	handleInput(data: string): void {
		this.loader.handleInput(data);
	}

	render(width: number): string[] {
		const inner = Math.max(10, width - 4);
		// Details hang under the status text, past the spinner and its space.
		const detail = (text: string, color: "muted" | "warning") =>
			wrapPlainText(sanitizeInline(text), Math.max(1, inner - 3)).map(
				(line) => `   ${this.theme.fg(color, line)}`,
			);
		// Host loaders lead with a blank row; the frame supplies that spacing.
		const status = this.loader
			.render(inner)
			.filter((line) => visibleWidth(line.trim()) > 0);
		return overlayFrame(
			this.theme,
			width,
			[
				...status,
				...detail(`Model: ${this.modelRef}`, "muted"),
				...detail(`Context supplied: ${this.contextSummary}`, "muted"),
				...(this.warning ? detail(this.warning, "warning") : []),
				"",
				` ${this.theme.fg("dim", keyHint("tui.select.cancel", "keep original"))}`,
			],
			true,
			{ title: "✦ Chisel · working" },
		);
	}

	invalidate(): void {
		this.loader.invalidate();
	}

	dispose(): void {
		this.loader.dispose();
	}
}
