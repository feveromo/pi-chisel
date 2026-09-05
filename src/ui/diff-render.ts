import type { Theme } from "@oh-my-pi/pi-coding-agent";
import { wrapTextWithAnsi } from "@oh-my-pi/pi-tui";
import type { DiffPart, PromptDiff } from "./diff.ts";
import { sanitizeForDisplay } from "./frame.ts";

type DiffSide = "before" | "after";

function styleFragment(theme: Theme, part: DiffPart, fragment: string): string {
	if (!fragment) return "";
	if (part.kind === "added") return theme.fg("success", fragment);
	if (part.kind === "removed") return theme.fg("error", fragment);
	return theme.fg("text", fragment);
}

function logicalLines(
	diff: PromptDiff,
	side: DiffSide,
	theme: Theme,
): string[] {
	const lines = [""];
	for (const part of diff.parts) {
		if (side === "before" && part.kind === "added") continue;
		if (side === "after" && part.kind === "removed") continue;

		const safe = sanitizeForDisplay(part.text)
			.replaceAll("\r\n", "\n")
			.replaceAll("\r", "\n");
		const fragments = safe.split("\n");
		for (const [index, fragment] of fragments.entries()) {
			const lineIndex = lines.length - 1;
			lines[lineIndex] =
				(lines[lineIndex] ?? "") + styleFragment(theme, part, fragment);
			if (index < fragments.length - 1) lines.push("");
		}
	}
	return lines;
}

function sideRows(
	diff: PromptDiff,
	side: DiffSide,
	theme: Theme,
	width: number,
): string[] {
	const prefix = side === "before" ? "- " : "+ ";
	const prefixColor = side === "before" ? "error" : "success";
	const rows: string[] = [];
	for (const logicalLine of logicalLines(diff, side, theme)) {
		const wrapped = wrapTextWithAnsi(logicalLine, Math.max(1, width - 2));
		const fragments = wrapped.length > 0 ? wrapped : [""];
		for (const [index, fragment] of fragments.entries()) {
			const marker = index === 0 ? prefix : "  ";
			rows.push(`${theme.fg(prefixColor, marker)}${fragment}`);
		}
	}
	return rows;
}

function renderHunkRows(
	diff: PromptDiff,
	theme: Theme,
	width: number,
): string[] {
	return [
		theme.fg("dim", "--- original"),
		...sideRows(diff, "before", theme, width),
		theme.fg("dim", "+++ chiseled"),
		...sideRows(diff, "after", theme, width),
	];
}

export function promptDiffHunks(diff: PromptDiff): PromptDiff[] {
	if (diff.coarse) return [diff];
	const hunks: PromptDiff[] = [];
	let parts: DiffPart[] = [];
	let leading = "";
	const finish = () => {
		if (parts.some((p) => p.kind !== "equal")) hunks.push({ ...diff, parts });
		parts = [];
	};
	for (const part of diff.parts) {
		if (
			part.kind === "equal" &&
			(part.text.length > 160 || (part.text.match(/\n/g)?.length ?? 0) > 3)
		) {
			if (parts.length)
				parts.push({ kind: "equal", text: `${part.text.slice(0, 70)}…` });
			finish();
			leading = `…${part.text.slice(-70)}`;
		} else {
			if (!parts.length && leading) {
				parts.push({ kind: "equal", text: leading });
				leading = "";
			}
			parts.push(part);
		}
	}
	finish();
	return hunks;
}

export function renderPromptDiffView(
	diff: PromptDiff,
	theme: Theme,
	width: number,
): { rows: string[]; changeOffsets: number[] } {
	const hunks = promptDiffHunks(diff);
	const rows: string[] = [];
	const changeOffsets: number[] = [];
	for (const [index, hunk] of hunks.entries()) {
		changeOffsets.push(rows.length);
		rows.push(
			theme.fg("accent", `Change ${index + 1}/${hunks.length}`),
			...renderHunkRows(hunk, theme, width),
			"",
		);
	}
	if (!hunks.length)
		rows.push(theme.fg("muted", "Already good · no wording changes."));
	return { rows, changeOffsets };
}

export function renderPromptDiffRows(
	diff: PromptDiff,
	theme: Theme,
	width: number,
): string[] {
	return renderPromptDiffView(diff, theme, width).rows;
}
