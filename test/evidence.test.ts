import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
	buildConversationReference,
	toolEvidenceCandidates,
} from "../src/context-builder.ts";
import {
	excerpt,
	fitSources,
	referenceFromSources,
	referenceSources,
} from "../src/evidence.ts";
import {
	buildOptimizationRequest,
	type ContextSource,
	estimateTextTokens,
} from "../src/request-builder.ts";

function message(role: string, content: unknown, extra = {}): SessionEntry {
	return {
		type: "message",
		id: crypto.randomUUID(),
		timestamp: new Date(0).toISOString(),
		parentId: null,
		message: { role, content, ...extra },
	} as unknown as SessionEntry;
}
const text = (value: string) => [{ type: "text", text: value }];

describe("intent-aware evidence", () => {
	it("protects the user constraint from multiple long assistant entries", () => {
		const entries = [
			message(
				"user",
				text("Discuss authentication options only. Do not implement anything."),
			),
			...Array.from({ length: 3 }, () =>
				message("assistant", text("Authentication commentary.\n".repeat(300))),
			),
		];
		const reference = buildConversationReference(
			entries,
			"auto",
			512,
			"Improve that plan.",
		).reference;
		expect(reference?.text).toContain("Do not implement anything.");
		expect(reference?.estimatedTokens).toBeLessThanOrEqual(512);
	});
	it("keeps a constraint in the middle of a long user message as a complete sentence", () => {
		const fitted = excerpt(
			`Background.\n${"More background.\n".repeat(100)}Never change the public API.\n${"Other detail.\n".repeat(100)}`,
			60,
			"fix auth",
			true,
		);
		expect(fitted?.text).toContain("Never change the public API.");
		expect(fitted?.truncated).toBe(true);
		expect(estimateTextTokens(fitted?.text ?? "")).toBeLessThanOrEqual(60);
	});
	it("does not import unrelated history into a short standalone draft", () => {
		const built = buildConversationReference(
			[message("user", text("Refactor the authentication cache."))],
			"auto",
			512,
			"Write a two-line birthday greeting.",
		);
		expect(built.reason).toBe("irrelevant");
	});
	it("finds an older named reference instead of filling the budget with recent chatter", () => {
		const built = buildConversationReference(
			[
				message(
					"user",
					text("In src/auth.ts, preserve the exported login signature."),
				),
				message("assistant", text("The birthday greeting is ready.")),
			],
			"auto",
			512,
			"Clarify the task for src/auth.ts.",
		);
		expect(built.reference?.text).toContain("exported login signature");
		expect(built.reference?.text).not.toContain("birthday");
	});
	it("keeps later corrections in chronological order and marks summaries as summaries", () => {
		const built = buildConversationReference(
			[
				message("user", text("Use Redis for cache.")),
				message(
					"user",
					text("Actually, no Redis. Use an in-memory cache only."),
				),
			],
			"recent",
			512,
			"clarify cache",
		);
		expect(built.reference?.text.indexOf("Use Redis")).toBeLessThan(
			built.reference?.text.indexOf("Actually") ?? 0,
		);
	});
	it("includes materialized retained user dialogue without hidden thinking", () => {
		const checkpoint = {
			type: "compaction",
			id: "summary",
			summary: "Earlier cache work.",
			retainedTail: [
				{ role: "user", content: text("No new dependencies.") },
				{
					role: "assistant",
					content: [{ type: "thinking", thinking: "hidden" }],
				},
			],
		} as unknown as SessionEntry;
		const built = buildConversationReference([checkpoint], "recent", 512);
		expect(built.reference?.text).toContain("No new dependencies.");
		expect(built.reference?.text).not.toContain("hidden");
	});
	it("counts separators and keeps source text identical through exclusion and budgeting", () => {
		const sources: ContextSource[] = ["user", "assistant"].map((kind) => ({
			id: kind,
			kind: kind as "user" | "assistant",
			label: kind,
			text: `${kind}: ${"detail ".repeat(30)}`,
			truncated: false,
		}));
		const kept = fitSources(
			sources,
			estimateTextTokens(sources[0]?.text ?? ""),
		);
		expect(kept.map((s) => s.id)).toEqual(["user"]);
		expect(referenceSources(referenceFromSources(kept))).toEqual(kept);
		expect(referenceFromSources([])).toBeUndefined();
	});
});

describe("explicit tool evidence", () => {
	it("offers only bounded paired results and sends none until a source is selected", () => {
		const entries = [
			message("assistant", [
				{
					type: "toolCall",
					id: "call-1",
					name: "bash",
					arguments: { command: "npm test", privateMetadata: "must not copy" },
				},
			]),
			message(
				"toolResult",
				text(
					"FAIL auth.test.ts\nExpected 200; received 401.\n" +
						"noise\n".repeat(500),
				),
				{ toolCallId: "call-1", toolName: "bash", isError: true },
			),
			message("toolResult", text("unpaired secret"), {
				toolCallId: "missing",
				toolName: "read",
			}),
		];
		const tools = toolEvidenceCandidates(entries, "fix auth.test.ts");
		expect(tools).toHaveLength(1);
		expect(estimateTextTokens(tools[0]?.text ?? "")).toBeLessThanOrEqual(240);
		expect(tools[0]?.text).toContain("Not current project state");
		expect(tools[0]?.text).not.toContain("must not copy");
		const defaultRequest = buildOptimizationRequest(
			"fix it",
			undefined,
			"standard",
		);
		expect(JSON.stringify(defaultRequest.context)).not.toContain(
			"FAIL auth.test.ts",
		);
		const optedIn = buildOptimizationRequest(
			"fix it",
			referenceFromSources(tools),
			"standard",
		);
		expect(JSON.stringify(optedIn.context.messages)).toContain(
			"FAIL auth.test.ts",
		);
	});
	it("does not offer credential targets or unknown tools", () => {
		for (const path of [
			".env",
			"/home/example/.pi/agent/auth.json",
			".npmrc",
			".netrc",
		]) {
			const entries = [
				message("assistant", [
					{
						type: "toolCall",
						id: "a",
						name: "read",
						arguments: { path },
					},
					{
						type: "toolCall",
						id: "b",
						name: "custom-secret-tool",
						arguments: {},
					},
				]),
				message("toolResult", text("credential"), {
					toolCallId: "a",
					toolName: "read",
				}),
				message("toolResult", text("credential"), {
					toolCallId: "b",
					toolName: "custom-secret-tool",
				}),
			];
			expect(toolEvidenceCandidates(entries, "credential")).toEqual([]);
		}
	});
});
