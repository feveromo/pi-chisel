import { getSettingsListTheme, type Theme } from "@oh-my-pi/pi-coding-agent";
import {
	Container,
	decodePrintableKey,
	type KeybindingsConfig,
	matchesKey,
	type SettingItem,
	SettingsList,
	Spacer,
	Text,
	type TUI,
} from "@oh-my-pi/pi-tui";
import type { OptimizerConfig } from "../config.ts";
import { sanitizeInline } from "./frame.ts";

export type SettingsAction = "close" | "model" | "shortcut";

export interface SettingsResult {
	action: SettingsAction;
	config: OptimizerConfig;
	resolvedKeybindings: KeybindingsConfig;
}

export class OptimizerSettingsComponent extends Container {
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
		super();
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
				description: "How boldly Chisel may reshape the draft",
				currentValue: config.intensity,
				values: ["light", "standard", "strong"],
			},
			{
				id: "previewMode",
				label: "Review opens on",
				description: "The review can always toggle between both versions",
				currentValue: config.previewMode,
				values: ["optimized", "original"],
			},
		];

		this.addChild(new Text(theme.fg("borderAccent", "─".repeat(40)), 0, 0));
		this.addChild(
			new Text(theme.fg("accent", theme.bold("  ✦ Pi Chisel settings")), 0, 0),
		);
		this.addChild(
			new Text(
				theme.fg("muted", `  Model: ${sanitizeInline(modelLabel)}`),
				0,
				0,
			),
		);
		this.addChild(
			new Text(theme.fg("muted", `  Shortcut: ${config.shortcut}`), 0, 0),
		);
		this.addChild(new Spacer(1));

		this.settingsList = new SettingsList(
			items,
			8,
			getSettingsListTheme(),
			(id, value) => {
				if (id === "contextMode")
					this.working.contextMode = value as OptimizerConfig["contextMode"];
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
					"  m choose model · k change shortcut · esc save and close",
				),
				0,
				0,
			),
		);
		this.addChild(new Text(theme.fg("borderAccent", "─".repeat(40)), 0, 0));

		this.finish = (action: SettingsAction) =>
			done({ action, config: this.working, resolvedKeybindings });
	}

	private readonly finish: (action: SettingsAction) => void;

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) {
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
