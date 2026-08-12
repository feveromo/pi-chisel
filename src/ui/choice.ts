import { getSelectListTheme, type Theme } from "@oh-my-pi/pi-coding-agent";
import {
	Container,
	decodePrintableKey,
	matchesKey,
	type SelectItem,
	SelectList,
	Spacer,
	Text,
	type TUI,
} from "@oh-my-pi/pi-tui";
import { accentBorder, sanitizeForDisplay, sanitizeInline } from "./frame.ts";

export interface ChoiceOption {
	value: string;
	label: string;
	description?: string;
	key?: string;
}

export class PromptChoiceComponent extends Container {
	readonly width = 72;
	private readonly list: SelectList;

	constructor(
		private readonly tui: TUI,
		theme: Theme,
		title: string,
		message: string,
		options: ChoiceOption[],
		done: (value: string | undefined) => void,
		escapeLabel = "cancel",
	) {
		super();
		this.addChild(accentBorder(theme));
		this.addChild(
			new Text(
				theme.fg("accent", theme.bold(`  ✦ ${sanitizeInline(title)}`)),
				0,
				0,
			),
		);
		this.addChild(
			new Text(theme.fg("text", `  ${sanitizeForDisplay(message)}`), 0, 0),
		);
		this.addChild(new Spacer(1));

		const items: SelectItem[] = options.map((option) => ({
			value: option.value,
			label: sanitizeInline(
				option.key ? `${option.label}  [${option.key}]` : option.label,
			),
			...(option.description
				? { description: sanitizeInline(option.description) }
				: {}),
		}));
		this.list = new SelectList(items, Math.min(items.length, 8), {
			...getSelectListTheme(),
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		});
		this.list.onSelect = (item) => done(item.value);
		this.list.onCancel = () => done(undefined);
		this.addChild(this.list);
		this.addChild(
			new Text(
				theme.fg(
					"dim",
					`  ↑↓ navigate · enter select · esc ${sanitizeInline(escapeLabel)}`,
				),
				0,
				0,
			),
		);
		this.addChild(accentBorder(theme));

		const quickKeys = new Map<string, string>();
		for (const option of options) {
			if (option.key) quickKeys.set(option.key.toLowerCase(), option.value);
		}
		this.quickSelect = (data: string) => {
			const key = (
				decodePrintableKey(data) ?? (data.length === 1 ? data : "")
			).toLowerCase();
			const value = quickKeys.get(key);
			if (value) done(value);
			return value !== undefined;
		};
	}

	private readonly quickSelect: (data: string) => boolean;

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) {
			this.list.onCancel?.();
			return;
		}
		if (this.quickSelect(data)) return;
		this.list.handleInput(data);
		this.tui.requestRender();
	}
}
