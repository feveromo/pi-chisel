import {
	Container,
	createProgressLoader,
	Spacer,
	Text,
	type Theme,
	type TUI,
} from "../host.ts";
import { accentBorder, sanitizeInline } from "./frame.ts";
import { keyHint } from "./keys.ts";

export class PromptOptimizationLoader extends Container {
	private readonly loader: ReturnType<typeof createProgressLoader>;

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
			new Text(theme.fg("accent", theme.bold("  ✦ Pi Chisel at Work")), 0, 0),
		);
		this.addChild(new Spacer(1));
		this.loader = createProgressLoader(
			tui,
			(text) => theme.fg("accent", text),
			(text) => theme.fg("text", text),
			"Shaping a sharper prompt…",
			["·", "○", "◌", "●", "◌", "○"],
		);
		this.addChild(this.loader);
		this.addChild(
			new Text(theme.fg("muted", `  Model: ${sanitizeInline(modelRef)}`), 0, 0),
		);
		this.addChild(
			new Text(
				theme.fg(
					"muted",
					`  Context supplied: ${sanitizeInline(contextSummary)}`,
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
				theme.fg("dim", `  ${keyHint("tui.select.cancel", "keep original")}`),
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
				`Shaping a sharper prompt… ${characters.toLocaleString()} chars`,
			);
	}

	handleInput(data: string): void {
		this.loader.handleInput(data);
	}

	dispose(): void {
		this.loader.dispose();
	}
}
