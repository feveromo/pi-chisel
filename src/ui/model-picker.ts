import type { Api, Model } from "@earendil-works/pi-ai";
import { rawKeyHint, type Theme } from "@earendil-works/pi-coding-agent";
import {
	Container,
	type Focusable,
	fuzzyFilter,
	Input,
	matchesKey,
	Spacer,
	Text,
	type TUI,
} from "@earendil-works/pi-tui";
import type { OptimizerModelPreference } from "../config.ts";
import { accentBorder, sanitizeInline } from "./frame.ts";

export type ModelPickerResult =
	| { kind: "current" }
	| { kind: "pinned"; model: Model<Api> };

interface PickerEntry {
	result: ModelPickerResult;
	label: string;
	description: string;
	searchText: string;
	selected: boolean;
}

export class OptimizerModelPicker extends Container implements Focusable {
	readonly width = 82;
	private readonly searchInput = new Input();
	private readonly listContainer = new Container();
	private readonly allEntries: PickerEntry[];
	private filteredEntries: PickerEntry[];
	private selectedIndex = 0;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		currentModel: Model<Api> | undefined,
		availableModels: Model<Api>[],
		preference: OptimizerModelPreference | null,
		private readonly done: (result: ModelPickerResult | undefined) => void,
	) {
		super();
		const currentDescription = currentModel
			? `${sanitizeInline(currentModel.provider)}/${sanitizeInline(currentModel.id)} · follows future chat-model changes`
			: "No chat model is currently selected";
		this.allEntries = [
			{
				result: { kind: "current" },
				label: "Use current chat model",
				description: currentDescription,
				searchText: `current chat model ${currentDescription}`,
				selected: preference === null,
			},
			...[...availableModels]
				.sort((a, b) =>
					`${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`),
				)
				.map((model) => ({
					result: { kind: "pinned" as const, model },
					label: `${sanitizeInline(model.provider)}/${sanitizeInline(model.id)}`,
					description: sanitizeInline(model.name),
					searchText: sanitizeInline(
						`${model.provider} ${model.id} ${model.name}`,
					),
					selected:
						preference?.provider === model.provider &&
						preference?.id === model.id,
				})),
		];
		this.filteredEntries = this.allEntries;
		this.selectedIndex = Math.max(
			0,
			this.allEntries.findIndex((entry) => entry.selected),
		);

		this.addChild(accentBorder(theme));
		this.addChild(
			new Text(
				theme.fg("accent", theme.bold("  ✦ Choose Chisel's model")),
				0,
				0,
			),
		);
		this.addChild(
			new Text(theme.fg("muted", "  Your active chat model stays put."), 0, 0),
		);
		this.addChild(new Spacer(1));
		this.addChild(this.searchInput);
		this.addChild(new Spacer(1));
		this.addChild(this.listContainer);
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				theme.fg(
					"dim",
					`  Type to search · ${rawKeyHint("enter", "select")} · ${rawKeyHint("escape", "close")}`,
				),
				0,
				0,
			),
		);
		this.addChild(accentBorder(theme));
		this.updateList();
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) {
			this.done(undefined);
			return;
		}
		if (matchesKey(data, "enter")) {
			const entry = this.filteredEntries[this.selectedIndex];
			if (entry) this.done(entry.result);
			return;
		}
		if (matchesKey(data, "up")) {
			if (this.filteredEntries.length > 0) {
				this.selectedIndex =
					this.selectedIndex === 0
						? this.filteredEntries.length - 1
						: this.selectedIndex - 1;
			}
		} else if (matchesKey(data, "down")) {
			if (this.filteredEntries.length > 0) {
				this.selectedIndex =
					this.selectedIndex === this.filteredEntries.length - 1
						? 0
						: this.selectedIndex + 1;
			}
		} else {
			this.searchInput.handleInput(data);
			const query = this.searchInput.getValue();
			this.filteredEntries = query
				? fuzzyFilter(this.allEntries, query, (entry) => entry.searchText)
				: this.allEntries;
			this.selectedIndex = 0;
		}
		this.updateList();
		this.tui.requestRender();
	}

	private updateList(): void {
		this.listContainer.clear();
		const maxVisible = 10;
		const start = Math.max(
			0,
			Math.min(
				this.selectedIndex - Math.floor(maxVisible / 2),
				this.filteredEntries.length - maxVisible,
			),
		);
		const end = Math.min(start + maxVisible, this.filteredEntries.length);

		for (let index = start; index < end; index += 1) {
			const entry = this.filteredEntries[index];
			if (!entry) continue;
			const active = index === this.selectedIndex;
			const prefix = active ? this.theme.fg("accent", "→ ") : "  ";
			const label = active
				? this.theme.fg("accent", entry.label)
				: this.theme.fg("text", entry.label);
			const pinned = entry.selected ? this.theme.fg("success", " ✓") : "";
			this.listContainer.addChild(new Text(`${prefix}${label}${pinned}`, 0, 0));
			if (active)
				this.listContainer.addChild(
					new Text(this.theme.fg("muted", `    ${entry.description}`), 0, 0),
				);
		}

		if (this.filteredEntries.length === 0) {
			this.listContainer.addChild(
				new Text(
					this.theme.fg("warning", "  No matching authenticated models"),
					0,
					0,
				),
			);
		} else if (start > 0 || end < this.filteredEntries.length) {
			this.listContainer.addChild(
				new Text(
					this.theme.fg(
						"dim",
						`  (${this.selectedIndex + 1}/${this.filteredEntries.length})`,
					),
					0,
					0,
				),
			);
		}
	}
}
