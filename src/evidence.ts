import {
	type ContextSource,
	estimateTextTokens,
	type OptimizationReference,
} from "./request-builder.ts";

const STOP_WORDS = new Set(
	"a an and are as at be but by can could do for from have how i in is it its just me my of on or our please should that the their them there these they this to use want we what when where which with would you your".split(
		" ",
	),
);
export const CONSTRAINT_PATTERN =
	/\b(?:do not|don't|never|must|only|without|no\s|keep|preserve|avoid|not yet|instead|actually)\b/i;

export function referenceTerms(draft: string): string[] {
	return [
		...new Set(
			(draft.toLowerCase().match(/[\p{L}\p{N}_./:-]{3,}/gu) ?? [])
				.map((word) => word.replace(/^[.:/-]+|[.:/-]+$/g, ""))
				.filter((word) => !STOP_WORDS.has(word)),
		),
	];
}

export function relevance(text: string, terms: readonly string[]): number {
	const lower = text.toLowerCase();
	return terms.reduce(
		(score, term) =>
			score + (lower.includes(term) ? (/[./:_-]/.test(term) ? 3 : 1) : 0),
		0,
	);
}

/** Whole sentences/lines first; never splice away a negation in the middle. */
export function excerpt(
	text: string,
	budget: number,
	draft = "",
	protectConstraints = false,
): { text: string; truncated: boolean } | undefined {
	if (budget <= 0) return undefined;
	if (estimateTextTokens(text) <= budget) return { text, truncated: false };
	const marker = "[… omitted …]";
	const terms = referenceTerms(draft);
	const units = text
		.split(/\n+|(?<=[.!?。！？])\s+/u)
		.map((text, index) => ({ text: text.trim(), index }))
		.filter((unit) => unit.text);
	// ponytail: lexical relevance and English constraint cues; explicit source review covers ambiguous/multilingual intent.
	const ranked = units.toSorted((a, b) => {
		const score = (unit: typeof a) =>
			(protectConstraints && CONSTRAINT_PATTERN.test(unit.text) ? 100 : 0) +
			relevance(unit.text, terms) * 4 +
			(unit.index === 0 ? 1 : 0);
		return score(b) - score(a) || a.index - b.index;
	});
	const selected: typeof units = [];
	const render = (items: typeof units) => {
		const ordered = items.toSorted((a, b) => a.index - b.index);
		const parts: string[] = [];
		let previous = -1;
		for (const unit of ordered) {
			if (unit.index > previous + 1) parts.push(marker);
			parts.push(unit.text);
			previous = unit.index;
		}
		if (previous < units.length - 1) parts.push(marker);
		return parts.join("\n");
	};
	for (const unit of ranked) {
		if (estimateTextTokens(render([...selected, unit])) <= budget)
			selected.push(unit);
	}
	if (!selected.length) return undefined;
	return { text: render(selected), truncated: true };
}

export function referenceSources(
	reference?: OptimizationReference,
): ContextSource[] {
	return [
		...(reference?.workspace?.sources ?? []),
		...(reference?.conversation?.sources ?? []),
		...(reference?.tools?.sources ?? []),
	];
}

export function referenceFromSources(
	sources: readonly ContextSource[],
): OptimizationReference | undefined {
	if (!sources.length) return undefined;
	const workspace = sources.filter((s) => s.kind === "workspace");
	const conversation = sources.filter(
		(s) => s.kind !== "workspace" && s.kind !== "tool",
	);
	const tools = sources.filter((s) => s.kind === "tool");
	const section = (sources: ContextSource[]) => {
		const text = sources.map((s) => s.text).join("\n\n");
		return { text, estimatedTokens: estimateTextTokens(text), sources };
	};
	const result: OptimizationReference = { estimatedTokens: 0 };
	if (workspace.length)
		result.workspace = {
			...section(workspace),
			sourceCount: workspace.length,
			trusted: workspace.every((s) => s.trusted),
		};
	if (conversation.length)
		result.conversation = {
			...section(conversation),
			messageCount: conversation.filter(
				(s) => s.kind === "user" || s.kind === "assistant",
			).length,
			summaryCount: conversation.filter((s) => s.kind.endsWith("summary"))
				.length,
		};
	if (tools.length) result.tools = section(tools);
	result.estimatedTokens =
		(result.workspace?.estimatedTokens ?? 0) +
		(result.conversation?.estimatedTokens ?? 0) +
		(result.tools?.estimatedTokens ?? 0);
	return result;
}

export function summarizeSources(sources: readonly ContextSource[]): string {
	const reference = referenceFromSources(sources);
	if (!reference) return "draft only · no context supplied";
	const parts = [
		...(reference.workspace ? ["workspace"] : []),
		...(reference.conversation
			? [
					`${reference.conversation.messageCount} messages · ${reference.conversation.summaryCount} summaries`,
				]
			: []),
		...(reference.tools
			? [`${reference.tools.sources.length} selected tool results`]
			: []),
	];
	return `${parts.join(" + ")} · ~${reference.estimatedTokens} tokens`;
}

/** Drop whole sources if a new model/revision reduces capacity; never add or rewrite a source silently. */
export function fitSources(
	sources: readonly ContextSource[],
	budget: number,
): ContextSource[] {
	const priority = (s: ContextSource) =>
		s.kind === "user"
			? 0
			: s.kind === "tool"
				? 1
				: s.kind === "workspace"
					? 2
					: 3;
	const selected: ContextSource[] = [];
	const ranked = sources
		.map((source, index) => ({ source, index }))
		.toSorted(
			(a, b) =>
				priority(a.source) - priority(b.source) ||
				(a.source.kind === "user" ? b.index - a.index : a.index - b.index),
		);
	for (const { source } of ranked) {
		if (
			(referenceFromSources([...selected, source])?.estimatedTokens ?? 0) <=
			budget
		)
			selected.push(source);
	}
	return sources.filter((s) => selected.includes(s));
}
