import { keyHint, type Theme } from "@earendil-works/pi-coding-agent";
import {
	CancellableLoader,
	Container,
	Spacer,
	Text,
	type TUI,
} from "@earendil-works/pi-tui";
import { accentBorder, sanitizeInline } from "./frame.ts";

export class PromptBubbleLoader extends Container {
	private readonly loader: CancellableLoader;

	constructor(
		tui: TUI,
		theme: Theme,
		modelRef: string,
		contextSummary: string,
		warning?: string,
	) {
		super();
		this.addChild(accentBorder(theme));
		this.addChild(
			new Text(theme.fg("accent", theme.bold("  ✦ Prompt Bubble")), 0, 0),
		);
		this.addChild(new Spacer(1));
		this.loader = new CancellableLoader(
			tui,
			(text) => theme.fg("accent", text),
			(text) => theme.fg("text", text),
			"Polishing your prompt…",
			{ frames: ["·", "○", "◌", "●", "◌", "○"], intervalMs: 90 },
		);
		this.addChild(this.loader);
		this.addChild(
			new Text(
				theme.fg(
					"muted",
					`  ${sanitizeInline(modelRef)} · ${sanitizeInline(contextSummary)}`,
				),
				0,
				0,
			),
		);
		if (warning)
			this.addChild(
				new Text(theme.fg("warning", `  ${sanitizeInline(warning)}`), 0, 0),
			);
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				theme.fg("dim", `  ${keyHint("tui.select.cancel", "cancel")}`),
				0,
				0,
			),
		);
		this.addChild(accentBorder(theme));
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
				`Polishing your prompt… ${characters.toLocaleString()} chars`,
			);
	}

	handleInput(data: string): void {
		this.loader.handleInput(data);
	}

	dispose(): void {
		this.loader.dispose();
	}
}
