import type { SessionEntry } from "@oh-my-pi/pi-coding-agent";
import type { ContextMode } from "./config.ts";
import {
	type ConversationReference,
	estimateTextTokens,
} from "./request-builder.ts";

export type VisibleContextRole =
	| "user"
	| "assistant"
	| "session-summary"
	| "branch-summary";

export interface VisibleContextItem {
	role: VisibleContextRole;
	text: string;
}

type ContextReason =
	| "disabled"
	| "no-visible-items"
	| "budget-exhausted"
	| "included";

export interface ContextBuildResult {
	reference?: ConversationReference;
	reason: ContextReason;
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

export function extractVisibleContextItems(
	entries: readonly SessionEntry[],
): VisibleContextItem[] {
	const items: VisibleContextItem[] = [];
	for (const entry of entries) {
		if (entry.type === "compaction") {
			const text = entry.summary.trim();
			if (text) items.push({ role: "session-summary", text });
			continue;
		}
		if (entry.type === "branch_summary") {
			const text = entry.summary.trim();
			if (text) items.push({ role: "branch-summary", text });
			continue;
		}
		if (entry.type !== "message") continue;

		const message = entry.message;
		if (message.role !== "user" && message.role !== "assistant") continue;
		const text = textBlocks(message.content).join("\n").trim();
		if (text) items.push({ role: message.role, text });
	}
	return items;
}

function contextLabel(role: VisibleContextRole): string {
	return role.toUpperCase().replaceAll("-", "_");
}

function formatContextItem(item: VisibleContextItem): string {
	const label = contextLabel(item.role);
	return `[${label}]\n${item.text}\n[/${label}]`;
}

function truncateContextItem(
	item: VisibleContextItem,
	budget: number,
): string | undefined {
	const label = contextLabel(item.role);
	const prefix = `[${label}]\n`;
	const omission = "\n[… middle content omitted …]\n";
	const suffix = `\n[/${label}]`;
	const framingTokens = estimateTextTokens(prefix + omission + suffix);
	if (framingTokens >= budget) return undefined;

	let characterBudget = Math.max(1, (budget - framingTokens) * 4);
	let candidate = "";
	while (characterBudget > 0) {
		const headCharacters = Math.max(1, Math.floor(characterBudget * 0.35));
		const tailCharacters = Math.max(1, characterBudget - headCharacters);
		candidate = `${prefix}${item.text.slice(0, headCharacters)}${omission}${item.text.slice(-tailCharacters)}${suffix}`;
		if (estimateTextTokens(candidate) <= budget) return candidate;
		characterBudget -= Math.max(1, Math.ceil(characterBudget * 0.08));
	}
	return undefined;
}

export function buildConversationReference(
	entries: readonly SessionEntry[],
	mode: ContextMode,
	tokenBudget: number,
): ContextBuildResult {
	if (mode === "none") return { reason: "disabled" };
	if (tokenBudget <= 0) return { reason: "budget-exhausted" };

	const items = extractVisibleContextItems(entries);
	if (items.length === 0) return { reason: "no-visible-items" };

	const selectedText: string[] = [];
	const selectedItems: VisibleContextItem[] = [];
	let tokens = 0;
	const perItemBudget = Math.max(48, Math.floor(tokenBudget * 0.58));

	for (let index = items.length - 1; index >= 0; index -= 1) {
		const item = items[index];
		if (!item) continue;
		const remaining = tokenBudget - tokens;
		if (remaining <= 0) break;

		const allowance =
			index > 0 ? Math.min(remaining, perItemBudget) : remaining;
		const formatted = formatContextItem(item);
		const rendered =
			estimateTextTokens(formatted) <= allowance
				? formatted
				: truncateContextItem(item, allowance);
		if (!rendered) break;

		selectedText.unshift(rendered);
		selectedItems.unshift(item);
		tokens += estimateTextTokens(rendered);
	}

	if (selectedText.length === 0) return { reason: "budget-exhausted" };
	const text = selectedText.join("\n\n");
	return {
		reason: "included",
		reference: {
			text,
			estimatedTokens: estimateTextTokens(text),
			messageCount: selectedItems.filter(
				(item) => item.role === "user" || item.role === "assistant",
			).length,
			summaryCount: selectedItems.filter(
				(item) =>
					item.role === "session-summary" || item.role === "branch-summary",
			).length,
		},
	};
}
