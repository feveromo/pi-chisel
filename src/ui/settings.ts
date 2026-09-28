import type { OptimizerConfig } from "../config.ts";
import {
	decodePrintableKey,
	getSettingsListTheme,
	type KeybindingsConfig,
	type SettingItem,
	SettingsList,
	Spacer,
	Text,
	type Theme,
	type TUI,
} from "../host.ts";
import { FramedContainer, sanitizeInline } from "./frame.ts";
import { keyHint, matchesBinding } from "./keys.ts";

export type SettingsAction = "close" | "model" | "shortcut";

export interface SettingsResult {
	action: SettingsAction;
	config: OptimizerConfig;
	resolvedKeybindings: KeybindingsConfig;
}

export class OptimizerSettingsComponent extends FramedContainer {
	readonly width = 76;
	private readonly settingsList: SettingsList;
	private readonly working: OptimizerConfig;

	constructor(
		private readonly tui: TUI,
		theme: Theme,
		config: OptimizerConfig,
		modelLabel: string,
		resolvedKeybindings: KeybindingsConfig,
		done: (result: SettingsResult) => void,
	) {
		super(theme, "✦ Chisel · settings");
		this.working = structuredClone(config);
		const items: SettingItem[] = [
			{
				id: "contextMode",
				label: "Grounding context",
				description:
					"auto adapts workspace + session evidence; recent uses the full bounded session; none sends only the draft",
				currentValue: config.contextMode,
				values: ["auto", "recent", "none"],
			},
			{
				id: "inspectContext",
				label: "Inspect before sending",
				description:
					"Review exact sources before every request; tool excerpts always require explicit selection",
				currentValue: config.inspectContext ? "on" : "off",
				values: ["off", "on"],
			},
			{
				id: "contextTokenBudget",
				label: "Context token budget",
				description:
					"Maximum combined workspace and session evidence; the draft is never truncated",
				currentValue: String(config.contextTokenBudget),
				values: ["512", "1024", "1800", "2048", "4096", "8192"],
			},
			{
				id: "intensity",
				label: "Editing intensity",
				description:
					"light cleans up; standard clarifies; strong builds out rough ideas with useful detail",
				currentValue: config.intensity,
				values: ["light", "standard", "strong"],
			},
			{
				id: "previewMode",
				label: "Review opens on",
				description: "Start on the rewrite, original, or focused changes",
				currentValue: config.previewMode,
				values: ["optimized", "diff", "original"],
			},
		];

		this.addChild(
			new Text(theme.fg("muted", `Model: ${sanitizeInline(modelLabel)}`), 0, 0),
		);
		this.addChild(
			new Text(theme.fg("muted", `Shortcut: ${config.shortcut}`), 0, 0),
		);
		this.addChild(new Spacer(1));

		this.settingsList = new SettingsList(
			items,
			8,
			getSettingsListTheme(),
			(id, value) => {
				if (id === "contextMode")
					this.working.contextMode = value as OptimizerConfig["contextMode"];
				else if (id === "inspectContext")
					this.working.inspectContext = value === "on";
				else if (id === "contextTokenBudget")
					this.working.contextTokenBudget = Number(value);
				else if (id === "intensity")
					this.working.intensity = value as OptimizerConfig["intensity"];
				else if (id === "previewMode")
					this.working.previewMode = value as OptimizerConfig["previewMode"];
			},
			() =>
				done({ action: "close", config: this.working, resolvedKeybindings }),
		);
		this.addChild(this.settingsList);
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				theme.fg(
					"dim",
					`m choose model · k change shortcut · ${keyHint("tui.select.cancel", "save and close")}`,
				),
				0,
				0,
			),
		);

		this.finish = (action: SettingsAction) =>
			done({ action, config: this.working, resolvedKeybindings });
	}

	private readonly finish: (action: SettingsAction) => void;

	handleInput(data: string): void {
		if (matchesBinding(data, "tui.select.cancel")) {
			this.finish("close");
			return;
		}
		const key = (
			decodePrintableKey(data) ?? (data.length === 1 ? data : "")
		).toLowerCase();
		if (key === "m") {
			this.finish("model");
			return;
		}
		if (key === "k") {
			this.finish("shortcut");
			return;
		}
		this.settingsList.handleInput(data);
		this.tui.requestRender();
	}
}
