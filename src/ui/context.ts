import { referenceFromSources } from "../evidence.ts";
import type { Theme } from "../host.ts";
import {
	type Component,
	decodePrintableKey,
	matchesKey,
	type TUI,
	truncateLine,
} from "../host.ts";
import type { ContextSource } from "../request-builder.ts";
import { overlayFrame, sanitizeInline, wrapPlainText } from "./frame.ts";
import { bindingLabel, keyHint, matchesBinding } from "./keys.ts";
import { sliceViewport } from "./viewport.ts";

export interface ContextInspectorOptions {
	sources: readonly ContextSource[];
	selected: readonly ContextSource[];
	budget: number;
	modelRef: string;
	beforeFirstSend: boolean;
	/** Source IDs actually supplied for the candidate currently in review. */
	suppliedIds?: readonly string[];
	note?: string;
	onDone: (sources: ContextSource[] | undefined) => void;
}

export class ContextInspector implements Component {
	private readonly selected: Set<string>;
	private index = 0;
	private offset = 0;
	private warning = "";
	private previewRows = 7;
	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly options: ContextInspectorOptions,
	) {
		this.selected = new Set(options.selected.map((s) => s.id));
	}
	private selection(): ContextSource[] {
		return this.options.sources.filter((s) => this.selected.has(s.id));
	}
	handleInput(data: string): void {
		if (matchesBinding(data, "tui.select.cancel")) {
			this.options.onDone(undefined);
			return;
		}
		if (matchesBinding(data, "tui.select.confirm")) {
			this.options.onDone(this.selection());
			return;
		}
		const up = matchesBinding(data, "tui.select.up");
		if (up || matchesBinding(data, "tui.select.down")) {
			this.index = Math.max(
				0,
				Math.min(this.options.sources.length - 1, this.index + (up ? -1 : 1)),
			);
			this.offset = 0;
		} else if (matchesBinding(data, "tui.select.pageUp"))
			this.offset = Math.max(0, this.offset - this.previewRows);
		else if (matchesBinding(data, "tui.select.pageDown"))
			this.offset += this.previewRows;
		else if (matchesKey(data, "home")) this.offset = 0;
		else if (matchesKey(data, "end")) this.offset = Number.MAX_SAFE_INTEGER;
		else {
			const key = (decodePrintableKey(data) ?? data).toLowerCase();
			if (key === "0") this.selected.clear();
			else if (key === "t") {
				const index = this.options.sources.findIndex((s) => s.kind === "tool");
				if (index >= 0) {
					this.index = index;
					this.offset = 0;
				}
			} else if (matchesKey(data, "space")) {
				const source = this.options.sources[this.index];
				if (source) {
					if (this.selected.has(source.id)) this.selected.delete(source.id);
					else {
						const next = [...this.selection(), source];
						const toolTokens =
							referenceFromSources(next)?.tools?.estimatedTokens ?? 0;
						if (
							toolTokens > 512 ||
							next.filter((s) => s.kind === "tool").length > 3
						)
							this.warning = "At most 3 tool excerpts / 512 tokens per pass.";
						else if (
							(referenceFromSources(next)?.estimatedTokens ?? 0) >
							this.options.budget
						)
							this.warning = "Not enough room. Exclude another source first.";
						else {
							this.selected.add(source.id);
							this.warning = "";
						}
					}
				}
			}
		}
		this.tui.requestRender();
	}
	render(width: number): string[] {
		const inner = Math.max(10, width - 6);
		const theme = this.theme;
		const options = this.options;
		const source = options.sources[this.index];
		const tokens = referenceFromSources(this.selection())?.estimatedTokens ?? 0;
		const row = (s: string, color: "muted" | "warning" | "accent" = "muted") =>
			wrapPlainText(s, inner).map((line) => ` ${theme.fg(color, line)}`);
		const header = [
			...row(`Model: ${options.modelRef}`),
			...row(
				options.beforeFirstSend
					? "Nothing sent yet. Only checked excerpts will be supplied."
					: "Changing this cannot unsend earlier requests.",
			),
			...row(
				`${this.selected.size} sources · ~${tokens}/${options.budget} tokens · tools opt-in`,
			),
			...(options.suppliedIds
				? row(
						"Checks select the next pass; 'supplied' marks this candidate's context.",
					)
				: []),
			...(options.note ? row(options.note) : []),
		];
		const footer = [
			...row(
				this.warning ||
					"Source inclusion is not verification. Preview is display-sanitized.",
				this.warning ? "warning" : "muted",
			),
			...row(
				`${bindingLabel("tui.select.up")}${bindingLabel("tui.select.down")} source · space include/exclude · t tools · 0 none`,
			),
			...row(
				`${bindingLabel("tui.select.pageUp")}/${bindingLabel("tui.select.pageDown")} excerpt · ${keyHint("tui.select.confirm", "generate")} · ${keyHint("tui.select.cancel", "back")}`,
				"accent",
			),
		];
		const available = Math.max(
			5,
			Math.floor((this.tui.terminal?.rows ?? 42) * 0.84) -
				header.length -
				footer.length -
				5,
		);
		const listRows = Math.min(
			5,
			Math.max(1, Math.floor(available / 3)),
			options.sources.length,
		);
		const listStart = Math.max(
			0,
			Math.min(
				this.index - Math.floor(listRows / 2),
				options.sources.length - listRows,
			),
		);
		const list = options.sources
			.slice(listStart, listStart + listRows)
			.map((s, index) => {
				const selected = this.selected.has(s.id);
				const focused = listStart + index === this.index;
				return ` ${theme.fg(focused ? "accent" : "muted", truncateLine(`${focused ? "›" : " "} [${selected ? "x" : " "}] ${options.suppliedIds?.includes(s.id) ? "supplied · " : ""}${sanitizeInline(s.label)}${s.truncated ? " · excerpt" : ""}`, inner))}`;
			});
		this.previewRows = Math.max(2, available - list.length);
		const lines = wrapPlainText(
			source?.text ??
				"No eligible sources. Context mode none disables workspace, session, and tool evidence.",
			inner,
		);
		const viewport = sliceViewport(lines, this.offset, this.previewRows);
		this.offset = viewport.offset;
		return overlayFrame(
			theme,
			width,
			[
				...header,
				"",
				...list,
				...row(
					source
						? `Excerpt ${this.index + 1}/${options.sources.length} · rows ${viewport.offset + 1}–${viewport.offset + viewport.items.length}/${viewport.total}`
						: "Draft only",
				),
				...viewport.items.map((line) => ` ${theme.fg("text", line)}`),
				"",
				...footer,
			],
			true,
			{
				title: options.beforeFirstSend
					? "✦ Chisel · before sending"
					: "✦ Chisel · context for the next pass",
			},
		);
	}
	invalidate(): void {}
}
