type DiffPartKind = "equal" | "added" | "removed";

export interface DiffPart {
	kind: DiffPartKind;
	text: string;
}

export interface PromptDiff {
	parts: DiffPart[];
	addedCharacters: number;
	removedCharacters: number;
	coarse: boolean;
}

const DEFAULT_MAX_DIFF_CELLS = 120_000;

function tokenize(text: string): string[] {
	return text.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]+/gu) ?? [];
}

function appendPart(parts: DiffPart[], kind: DiffPartKind, text: string): void {
	if (!text) return;
	const previous = parts.at(-1);
	if (previous?.kind === kind) previous.text += text;
	else parts.push({ kind, text });
}

function summarize(parts: DiffPart[], coarse: boolean): PromptDiff {
	let addedCharacters = 0;
	let removedCharacters = 0;
	for (const part of parts) {
		if (part.kind === "added") addedCharacters += part.text.length;
		else if (part.kind === "removed") removedCharacters += part.text.length;
	}
	return { parts, addedCharacters, removedCharacters, coarse };
}

function replacementDiff(
	before: string,
	after: string,
	coarse: boolean,
): PromptDiff {
	const parts: DiffPart[] = [];
	appendPart(parts, "removed", before);
	appendPart(parts, "added", after);
	return summarize(parts, coarse);
}

function buildLcsRows(
	beforeTokens: string[],
	afterTokens: string[],
): number[][] {
	const rows = Array.from({ length: beforeTokens.length + 1 }, () =>
		Array<number>(afterTokens.length + 1).fill(0),
	);
	for (
		let beforeIndex = beforeTokens.length - 1;
		beforeIndex >= 0;
		beforeIndex -= 1
	) {
		const row = rows[beforeIndex];
		const nextRow = rows[beforeIndex + 1];
		if (!row || !nextRow) continue;
		for (
			let afterIndex = afterTokens.length - 1;
			afterIndex >= 0;
			afterIndex -= 1
		) {
			row[afterIndex] =
				beforeTokens[beforeIndex] === afterTokens[afterIndex]
					? (nextRow[afterIndex + 1] ?? 0) + 1
					: Math.max(nextRow[afterIndex] ?? 0, row[afterIndex + 1] ?? 0);
		}
	}
	return rows;
}

function backtrackDiff(
	beforeTokens: string[],
	afterTokens: string[],
	rows: number[][],
): DiffPart[] {
	const parts: DiffPart[] = [];
	let beforeIndex = 0;
	let afterIndex = 0;
	while (beforeIndex < beforeTokens.length || afterIndex < afterTokens.length) {
		const beforeToken = beforeTokens[beforeIndex];
		const afterToken = afterTokens[afterIndex];
		if (beforeToken !== undefined && beforeToken === afterToken) {
			appendPart(parts, "equal", beforeToken);
			beforeIndex += 1;
			afterIndex += 1;
			continue;
		}

		const removeScore = rows[beforeIndex + 1]?.[afterIndex] ?? 0;
		const addScore = rows[beforeIndex]?.[afterIndex + 1] ?? 0;
		if (
			beforeToken !== undefined &&
			(afterToken === undefined || removeScore >= addScore)
		) {
			appendPart(parts, "removed", beforeToken);
			beforeIndex += 1;
		} else if (afterToken !== undefined) {
			appendPart(parts, "added", afterToken);
			afterIndex += 1;
		}
	}
	return parts;
}

export function createPromptDiff(
	before: string,
	after: string,
	maxCells = DEFAULT_MAX_DIFF_CELLS,
): PromptDiff {
	if (before === after)
		return summarize([{ kind: "equal", text: before }], false);

	const beforeTokens = tokenize(before);
	const afterTokens = tokenize(after);
	if (beforeTokens.length === 0 || afterTokens.length === 0)
		return replacementDiff(before, after, false);
	if (beforeTokens.length * afterTokens.length > Math.max(0, maxCells))
		return replacementDiff(before, after, true);

	const rows = buildLcsRows(beforeTokens, afterTokens);
	return summarize(backtrackDiff(beforeTokens, afterTokens, rows), false);
}

function reconstruct(diff: PromptDiff, omittedKind: DiffPartKind): string {
	let text = "";
	for (const part of diff.parts) {
		if (part.kind !== omittedKind) text += part.text;
	}
	return text;
}

export function reconstructBefore(diff: PromptDiff): string {
	return reconstruct(diff, "added");
}

export function reconstructAfter(diff: PromptDiff): string {
	return reconstruct(diff, "removed");
}
