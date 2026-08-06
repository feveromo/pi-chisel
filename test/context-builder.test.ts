import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
	buildConversationReference,
	extractVisibleContextItems,
} from "../src/context-builder.ts";

function entry(
	role: "user" | "assistant" | "toolResult",
	content: unknown,
): SessionEntry {
	return {
		type: "message",
		id: crypto.randomUUID(),
		parentId: null,
		timestamp: new Date(0).toISOString(),
		message: { role, content },
	} as unknown as SessionEntry;
}

function summary(
	type: "compaction" | "branch_summary",
	text: string,
): SessionEntry {
	return {
		type,
		id: crypto.randomUUID(),
		parentId: null,
		timestamp: new Date(0).toISOString(),
		summary: text,
		...(type === "compaction"
			? { firstKeptEntryId: "kept", tokensBefore: 10_000 }
			: { fromId: "old-branch" }),
	} as SessionEntry;
}

describe("session context", () => {
	it("keeps visible dialogue and compacted-session summaries while excluding tool noise", () => {
		const entries = [
			summary("compaction", "The user is improving an editor extension."),
			entry("user", [{ type: "text", text: "Use a quiet style." }]),
			entry("assistant", [
				{ type: "thinking", thinking: "hidden chain" },
				{ type: "text", text: "Here is the first version." },
				{ type: "toolCall", name: "read", arguments: { path: "secret" } },
			]),
			entry("toolResult", [{ type: "text", text: "verbose tool output" }]),
			summary("branch_summary", "The abandoned branch tested a modal layout."),
		];

		expect(extractVisibleContextItems(entries)).toEqual([
			{
				role: "session-summary",
				text: "The user is improving an editor extension.",
			},
			{ role: "user", text: "Use a quiet style." },
			{ role: "assistant", text: "Here is the first version." },
			{
				role: "branch-summary",
				text: "The abandoned branch tested a modal layout.",
			},
		]);

		const built = buildConversationReference(entries, "auto", 500);
		expect(built.reference?.text).toContain("[SESSION_SUMMARY]");
		expect(built.reference?.text).toContain("[USER]");
		expect(built.reference?.text).toContain("[ASSISTANT]");
		expect(built.reference?.text).not.toContain("hidden chain");
		expect(built.reference?.text).not.toContain("tool output");
		expect(built.reference?.summaryCount).toBe(2);
		expect(built.reference?.messageCount).toBe(2);
	});

	it("includes standalone drafts in auto mode and reserves none as the explicit opt-out", () => {
		const entries = [entry("user", [{ type: "text", text: "Old request" }])];
		expect(buildConversationReference(entries, "none", 200).reason).toBe(
			"disabled",
		);
		expect(buildConversationReference(entries, "auto", 200).reason).toBe(
			"included",
		);
	});

	it("caps a long newest response so the preceding request still fits", () => {
		const entries = [
			entry("user", [
				{ type: "text", text: "Fix the authentication regression safely." },
			]),
			entry("assistant", [
				{
					type: "text",
					text: `important beginning ${"x".repeat(1600)} important ending`,
				},
			]),
		];
		const built = buildConversationReference(entries, "recent", 160);

		expect(built.reason).toBe("included");
		expect(built.reference?.estimatedTokens).toBeLessThanOrEqual(160);
		expect(built.reference?.messageCount).toBe(2);
		expect(built.reference?.text).toContain("[USER]");
		expect(built.reference?.text).toContain("authentication regression");
		expect(built.reference?.text).toContain("[ASSISTANT]");
		expect(built.reference?.text).toContain("middle content omitted");
		expect(built.reference?.text).toContain("important beginning");
		expect(built.reference?.text).toContain("important ending");
	});

	it("reports absent or exhausted evidence without manufacturing context", () => {
		expect(buildConversationReference([], "auto", 200).reason).toBe(
			"no-visible-items",
		);
		expect(
			buildConversationReference(
				[entry("user", [{ type: "text", text: "context" }])],
				"auto",
				0,
			).reason,
		).toBe("budget-exhausted");
	});
});
