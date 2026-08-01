import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ContextMode } from "./config.ts";
import {
	estimateTextTokens,
	type OptimizationReference,
} from "./request-builder.ts";

export interface VisibleTurn {
	role: "user" | "assistant";
	text: string;
}

type ContextReason =
	| "disabled"
	| "not-referential"
	| "no-visible-turns"
	| "budget-exhausted"
	| "included";

export interface ContextBuildResult {
	reference?: OptimizationReference;
	reason: ContextReason;
}

const REFERENTIAL_PATTERNS = [
	/\b(?:again|previous|prior|earlier|above|last time|same (?:style|format|approach|way)|as before)\b/i,
	/\b(?:do|fix|change|rewrite|improve|continue|finish|repeat|restore|revert|use)\s+(?:it|that|this|those|them)\b/i,
	/\b(?:that|this|it|those|these)\s+(?:one|version|draft|result|answer|response|implementation|plan|style)\b/i,
	/\b(?:the previous|the last|what you|you just|we discussed|we decided)\b/i,
];

export function draftNeedsConversationContext(draft: string): boolean {
	const normalized = draft.trim();
	if (!normalized) return false;
	return REFERENTIAL_PATTERNS.some((pattern) => pattern.test(normalized));
}

function textBlocks(content: unknown): string[] {
	if (typeof content === "string") return content ? [content] : [];
	if (!Array.isArray(content)) return [];

	const result: string[] = [];
	for (const block of content) {
		if (
			typeof block === "object" &&
			block !== null &&
			"type" in block &&
			block.type === "text" &&
			"text" in block &&
			typeof block.text === "string"
		) {
			result.push(block.text);
		}
	}
	return result;
}

export function extractVisibleTurns(
	entries: readonly SessionEntry[],
): VisibleTurn[] {
	const turns: VisibleTurn[] = [];
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role !== "user" && message.role !== "assistant") continue;

		const text = textBlocks(message.content).join("\n").trim();
		if (text) turns.push({ role: message.role, text });
	}
	return turns;
}

function formatTurn(turn: VisibleTurn): string {
	const label = turn.role.toUpperCase();
	return `[${label}]\n${turn.text}\n[/${label}]`;
}

function truncateNewestTurn(
	turn: VisibleTurn,
	budget: number,
): string | undefined {
	const label = turn.role.toUpperCase();
	const prefix = `[${label}]\n[… earlier content omitted …]\n`;
	const suffix = `\n[/${label}]`;
	const framingTokens = estimateTextTokens(prefix + suffix);
	if (framingTokens >= budget) return undefined;

	let characterBudget = Math.max(1, (budget - framingTokens) * 4);
	let candidate = `${prefix}${turn.text.slice(-characterBudget)}${suffix}`;
	while (estimateTextTokens(candidate) > budget && characterBudget > 1) {
		characterBudget = Math.max(1, characterBudget - 4);
		candidate = `${prefix}${turn.text.slice(-characterBudget)}${suffix}`;
	}
	return estimateTextTokens(candidate) <= budget ? candidate : undefined;
}

export function buildConversationReference(
	entries: readonly SessionEntry[],
	draft: string,
	mode: ContextMode,
	tokenBudget: number,
): ContextBuildResult {
	if (mode === "none") return { reason: "disabled" };
	if (mode === "auto" && !draftNeedsConversationContext(draft))
		return { reason: "not-referential" };
	if (tokenBudget <= 0) return { reason: "budget-exhausted" };

	const turns = extractVisibleTurns(entries);
	if (turns.length === 0) return { reason: "no-visible-turns" };

	const selected: string[] = [];
	let tokens = 0;
	for (let index = turns.length - 1; index >= 0; index -= 1) {
		const turn = turns[index];
		if (!turn) continue;
		const formatted = formatTurn(turn);
		const turnTokens = estimateTextTokens(formatted);

		if (tokens + turnTokens > tokenBudget) {
			if (selected.length === 0) {
				const truncated = truncateNewestTurn(turn, tokenBudget);
				if (truncated) {
					selected.unshift(truncated);
					tokens = estimateTextTokens(truncated);
				}
			}
			break;
		}

		selected.unshift(formatted);
		tokens += turnTokens;
	}

	if (selected.length === 0) return { reason: "budget-exhausted" };
	const text = selected.join("\n\n");
	return {
		reason: "included",
		reference: {
			text,
			turnCount: selected.length,
			estimatedTokens: estimateTextTokens(text),
		},
	};
}
