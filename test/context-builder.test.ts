import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
	buildConversationReference,
	draftNeedsConversationContext,
	extractVisibleTurns,
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

describe("conversation context", () => {
	it("detects contextual drafts conservatively", () => {
		expect(
			draftNeedsConversationContext("Do that again in the same style."),
		).toBe(true);
		expect(draftNeedsConversationContext("Fix the previous version.")).toBe(
			true,
		);
		expect(draftNeedsConversationContext("What is a B-tree?")).toBe(false);
	});

	it("keeps visible user and assistant text while excluding thinking and tool noise", () => {
		const entries = [
			entry("user", [{ type: "text", text: "Use a quiet style." }]),
			entry("assistant", [
				{ type: "thinking", thinking: "hidden chain" },
				{ type: "text", text: "Here is the first version." },
				{ type: "toolCall", name: "read", arguments: { path: "secret" } },
			]),
			entry("toolResult", [{ type: "text", text: "verbose tool output" }]),
		];

		expect(extractVisibleTurns(entries)).toEqual([
			{ role: "user", text: "Use a quiet style." },
			{ role: "assistant", text: "Here is the first version." },
		]);
		const built = buildConversationReference(
			entries,
			"Do that again.",
			"auto",
			500,
		);
		expect(built.reference?.text).toContain("[USER]");
		expect(built.reference?.text).toContain("[ASSISTANT]");
		expect(built.reference?.text).not.toContain("hidden chain");
		expect(built.reference?.text).not.toContain("tool output");
	});

	it("omits context in none mode and for standalone auto-mode drafts", () => {
		const entries = [entry("user", [{ type: "text", text: "Old request" }])];
		expect(
			buildConversationReference(entries, "Do that again", "none", 100).reason,
		).toBe("disabled");
		expect(
			buildConversationReference(entries, "Explain B-trees", "auto", 100)
				.reason,
		).toBe("not-referential");
	});

	it("walks backward and bounds an oversized newest turn without dropping its role", () => {
		const entries = [
			entry("user", [{ type: "text", text: "older context" }]),
			entry("assistant", [
				{ type: "text", text: `important ending ${"x".repeat(1000)}` },
			]),
		];
		const built = buildConversationReference(
			entries,
			"Fix the previous version",
			"recent",
			40,
		);

		expect(built.reason).toBe("included");
		expect(built.reference?.estimatedTokens).toBeLessThanOrEqual(40);
		expect(built.reference?.turnCount).toBe(1);
		expect(built.reference?.text).toContain("[ASSISTANT]");
		expect(built.reference?.text).toContain("earlier content omitted");
		expect(built.reference?.text).not.toContain("older context");
	});
});
