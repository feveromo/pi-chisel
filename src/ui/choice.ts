import type { Theme } from "../host.ts";
import {
	decodePrintableKey,
	type SelectItem,
	SelectList,
	Spacer,
	selectListTheme,
	Text,
	type TUI,
} from "../host.ts";
import {
	FramedContainer,
	sanitizeForDisplay,
	sanitizeInline,
} from "./frame.ts";
import { bindingLabel, keyHint, matchesBinding } from "./keys.ts";

export interface ChoiceOption {
	value: string;
	label: string;
	description?: string;
	key?: string;
}

export class PromptChoiceComponent extends FramedContainer {
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
		super(theme, `✦ ${title}`);
		this.addChild(
			new Text(theme.fg("text", sanitizeForDisplay(message)), 0, 0),
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
		this.list = new SelectList(
			items,
			Math.min(items.length, 8),
			selectListTheme(theme),
		);
		this.list.onSelect = (item) => done(item.value);
		this.list.onCancel = () => done(undefined);
		this.addChild(this.list);
		this.addChild(
			new Text(
				theme.fg(
					"dim",
					`${bindingLabel("tui.select.up")}${bindingLabel("tui.select.down")} navigate · ${keyHint("tui.select.confirm", "select")} · ${keyHint("tui.select.cancel", sanitizeInline(escapeLabel))}`,
				),
				0,
				0,
			),
		);

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
		if (matchesBinding(data, "tui.select.cancel")) {
			this.list.onCancel?.();
			return;
		}
		if (this.quickSelect(data)) return;
		this.list.handleInput(data);
		this.tui.requestRender();
	}
}
