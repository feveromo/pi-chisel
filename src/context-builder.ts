import type { SessionEntry } from "@oh-my-pi/pi-coding-agent";
import type { ContextMode } from "./config.ts";
import { analyzeDraft } from "./draft-analysis.ts";
import {
	excerpt,
	referenceFromSources,
	referenceTerms,
	relevance,
} from "./evidence.ts";
import {
	type ContextSource,
	type ConversationReference,
	estimateTextTokens,
} from "./request-builder.ts";

export type VisibleContextRole =
	| "user"
	| "assistant"
	| "session-summary"
	| "branch-summary";
export interface VisibleContextItem {
	id: string;
	role: VisibleContextRole;
	text: string;
	order: number;
}
export interface ContextBuildResult {
	reference?: ConversationReference;
	reason:
		| "disabled"
		| "no-visible-items"
		| "budget-exhausted"
		| "irrelevant"
		| "included";
}

export function textBlocks(content: unknown): string[] {
	if (typeof content === "string") return content ? [content] : [];
	if (!Array.isArray(content)) return [];
	return content.flatMap((block) =>
		block?.type === "text" && typeof block.text === "string"
			? [block.text]
			: [],
	);
}

export function extractVisibleContextItems(
	entries: readonly SessionEntry[],
): VisibleContextItem[] {
	const items: VisibleContextItem[] = [];
	const add = (id: string, role: VisibleContextRole, text: string) => {
		if (text.trim())
			items.push({ id, role, text: text.trim(), order: items.length });
	};
	for (const [index, entry] of entries.entries()) {
		const id = entry.id ?? `entry-${index}`;
		if (entry.type === "compaction") {
			add(id, "session-summary", entry.summary);
			// Newer hosts materialize retained dialogue on the checkpoint itself.
			const tail = (
				entry as unknown as {
					retainedTail?: { role: string; content?: unknown }[];
				}
			).retainedTail;
			for (const [tailIndex, message] of (tail ?? []).entries()) {
				if (message.role === "user" || message.role === "assistant")
					add(
						`${id}-tail-${tailIndex}`,
						message.role,
						textBlocks(message.content).join("\n"),
					);
			}
		} else if (entry.type === "branch_summary")
			add(id, "branch-summary", entry.summary);
		else if (
			entry.type === "message" &&
			(entry.message.role === "user" || entry.message.role === "assistant")
		) {
			add(id, entry.message.role, textBlocks(entry.message.content).join("\n"));
		}
	}
	return items;
}

export function buildConversationReference(
	entries: readonly SessionEntry[],
	mode: ContextMode,
	tokenBudget: number,
	draft = "",
): ContextBuildResult {
	if (mode === "none") return { reason: "disabled" };
	if (tokenBudget <= 0) return { reason: "budget-exhausted" };
	const items = extractVisibleContextItems(entries);
	if (!items.length) return { reason: "no-visible-items" };
	const terms = referenceTerms(draft);
	const referential = analyzeDraft(draft).likelyReferential;
	const relevant = new Set(
		items.filter(
			(item) =>
				mode === "recent" ||
				!draft ||
				referential ||
				relevance(item.text, terms) > 0,
		),
	);
	// A matching assistant reply must not lose the user instruction that prompted it.
	let user: VisibleContextItem | undefined;
	for (const item of items) {
		if (item.role === "user") user = item;
		else if (item.role === "assistant" && relevant.has(item) && user)
			relevant.add(user);
	}
	const candidates = items.filter((item) => relevant.has(item));
	if (!candidates.length) return { reason: "irrelevant" };
	const newestUser = candidates.findLast((item) => item.role === "user");
	const rank = (item: VisibleContextItem) =>
		item === newestUser
			? 0
			: item.role === "user"
				? 1
				: item.role.endsWith("summary")
					? 2
					: 3;
	const ranked = candidates.toSorted(
		(a, b) =>
			rank(a) - rank(b) ||
			relevance(b.text, terms) - relevance(a.text, terms) ||
			b.order - a.order,
	);
	const selected: { source: ContextSource; order: number }[] = [];
	for (const item of ranked) {
		const label = item.role.toUpperCase().replaceAll("-", "_");
		const prefix = `[${label}]\nSource: ${item.id} · session item ${item.order + 1}\n`;
		const suffix = `\n[/${label}]`;
		const current =
			referenceFromSources(selected.map((s) => s.source))?.estimatedTokens ?? 0;
		const remaining = tokenBudget - current - (selected.length ? 1 : 0);
		const allowance = Math.min(
			remaining,
			Math.max(
				48,
				Math.floor(tokenBudget * (item.role === "user" ? 0.65 : 0.32)),
			),
		);
		const fitted = excerpt(
			item.text,
			allowance - estimateTextTokens(prefix + suffix),
			draft,
			item.role === "user",
		);
		if (!fitted) continue;
		const source: ContextSource = {
			id: `session:${item.id}`,
			kind: item.role,
			label: `${label} · item ${item.order + 1}`,
			text: prefix + fitted.text + suffix,
			truncated: fitted.truncated,
		};
		if (
			(referenceFromSources([...selected.map((s) => s.source), source])
				?.estimatedTokens ?? 0) <= tokenBudget
		)
			selected.push({ source, order: item.order });
	}
	const sources = selected
		.toSorted((a, b) => a.order - b.order)
		.map((s) => s.source);
	const reference = referenceFromSources(sources)?.conversation;
	return reference
		? { reference, reason: "included" }
		: { reason: "budget-exhausted" };
}

/** Existing completed results only. Merely appearing here does NOT opt a result into transmission. */
export function toolEvidenceCandidates(
	entries: readonly SessionEntry[],
	draft: string,
): ContextSource[] {
	const calls = new Map<
		string,
		{ name: string; arguments: Record<string, unknown> }
	>();
	const candidates: { source: ContextSource; score: number; order: number }[] =
		[];
	const allowed = new Set([
		"bash",
		"read",
		"grep",
		"find",
		"ls",
		"edit",
		"write",
	]);
	const terms = referenceTerms(draft);
	const start = Math.max(0, entries.length - 64);
	for (const [relativeIndex, entry] of entries.slice(start).entries()) {
		const index = start + relativeIndex;
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role === "assistant") {
			for (const block of message.content) {
				if (block.type === "toolCall" && allowed.has(block.name))
					calls.set(block.id, { name: block.name, arguments: block.arguments });
			}
		} else if (message.role === "toolResult") {
			const call = calls.get(message.toolCallId);
			if (!call || call.name !== message.toolName) continue;
			const target = call.arguments.path ?? call.arguments.command ?? "";
			// Do not copy arbitrary arguments/details, hidden entries, or known credential-file targets.
			if (
				typeof target !== "string" ||
				/(?:\.env\b|auth\.json\b|\.npmrc\b|\.netrc\b|credentials?|secrets?|\.pem\b|\.key\b|id_rsa|id_ed25519)/i.test(
					target,
				)
			)
				continue;
			if (target.length > 400) continue;
			const status = message.isError
				? "tool reported an error"
				: "tool returned; success of the task is not established";
			const header = `[TOOL_RESULT]\nSource: ${entry.id} · session entry ${index + 1} · ${entry.timestamp}\n${call.name}: ${target}\nObserved then: ${status}. Not current project state.\n`;
			const fitted = excerpt(
				textBlocks(message.content).join("\n"),
				240 - estimateTextTokens(`${header}\n[/TOOL_RESULT]`),
				draft,
			);
			if (!fitted) continue;
			candidates.push({
				source: {
					id: `tool:${entry.id}`,
					kind: "tool",
					label: `${call.name} · entry ${index + 1} · ${target || "result"}`,
					text: `${header}${fitted.text}\n[/TOOL_RESULT]`,
					truncated: fitted.truncated,
				},
				score: relevance(target + fitted.text, terms),
				order: index,
			});
		}
	}
	return candidates
		.toSorted((a, b) => b.score - a.score || b.order - a.order)
		.slice(0, 8)
		.map((c) => c.source);
}
