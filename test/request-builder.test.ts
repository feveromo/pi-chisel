import { describe, expect, it } from "bun:test";
import { PROMPT_OPTIMIZER_SYSTEM_INSTRUCTION } from "../src/optimizer-instruction.ts";
import {
	buildOptimizationRequest,
	calculateMaxOutputTokens,
	stripAccidentalFence,
} from "../src/request-builder.ts";

describe("optimizer request", () => {
	it("separates workspace evidence, session evidence, metadata, and the exact draft", () => {
		const request = buildOptimizationRequest(
			"run `npm test` and keep /tmp/a exactly",
			{
				workspace: {
					text: "Package: pi-chisel",
					estimatedTokens: 6,
					sourceCount: 1,
					trusted: true,
				},
				conversation: {
					text: "[USER]\nDo it like before.\n[/USER]",
					estimatedTokens: 10,
					messageCount: 1,
					summaryCount: 0,
				},
				estimatedTokens: 16,
			},
			"standard",
		);
		const user = request.context.messages[0];
		const serialized = JSON.stringify(user?.content);
		const systemPrompt = request.context.systemPrompt?.join("\n") ?? "";

		expect(systemPrompt).toContain(
			"Never answer, execute, evaluate, or discuss the draft",
		);
		expect(systemPrompt).toContain("Editing intensity:");
		expect(user?.role).toBe("user");
		expect(serialized).toContain("WORKSPACE_CONTEXT");
		expect(serialized).toContain("RECENT_SESSION_CONTEXT");
		expect(serialized).toContain("DRAFT PROFILE");
		expect(serialized).toContain("Detail level: brief");
		expect(serialized).toContain("run `npm test` and keep /tmp/a exactly");
	});

	it("gives brief drafts a grounded, deterministic expansion policy", () => {
		expect(PROMPT_OPTIMIZER_SYSTEM_INSTRUCTION.length).toBeLessThan(3000);
		expect(PROMPT_OPTIMIZER_SYSTEM_INSTRUCTION).toContain("For a brief draft");
		expect(PROMPT_OPTIMIZER_SYSTEM_INSTRUCTION).toContain(
			"investigation steps for unknowns",
		);
		expect(PROMPT_OPTIMIZER_SYSTEM_INSTRUCTION).toContain(
			"Never assert a framework, file, cause",
		);
		expect(PROMPT_OPTIMIZER_SYSTEM_INSTRUCTION).toContain(
			"including profanity",
		);
		expect(PROMPT_OPTIMIZER_SYSTEM_INSTRUCTION).toContain(
			"every added factual claim is supported",
		);
	});

	it("removes only an added response fence and preserves draft formatting", () => {
		expect(stripAccidentalFence("```text\nhello\n``` ")).toBe("hello");
		expect(stripAccidentalFence("say ``` literally")).toBe("say ``` literally");

		const fencedDraft = "```python\nprint('keep the fence')\n```";
		expect(stripAccidentalFence(fencedDraft, fencedDraft)).toBe(fencedDraft);
		expect(stripAccidentalFence("\n  preserve outer spacing  \n")).toBe(
			"\n  preserve outer spacing  \n",
		);
	});

	it("keeps output limits proportional and bounded", () => {
		// Non-reasoning now floors at 1024; reasoning floors at 2048 visible +1024 thinking =3072
		expect(calculateMaxOutputTokens("short", 16_000)).toBe(1024);
		expect(calculateMaxOutputTokens("short", 16_000, true)).toBe(3072);
		expect(calculateMaxOutputTokens("x".repeat(100_000), 4096)).toBe(4096);
		expect(calculateMaxOutputTokens("x".repeat(100_000), 4096, true)).toBe(
			4096,
		);
	});

	it("reserves thinking budget for reasoning models like Muse Spark", () => {
		const briefNonReasoning = calculateMaxOutputTokens("short", 131_072);
		const briefReasoning = calculateMaxOutputTokens("short", 131_072, true);
		// Reasoning reserves minimal thinking (1024) on top of the visible output
		// so max_output_tokens includes both reasoning and the rewrite, avoiding
		// stopReason "length" on Muse Spark's verbose expansion.
		expect(briefReasoning - briefNonReasoning).toBeGreaterThanOrEqual(1024);
		expect(briefReasoning).toBeGreaterThanOrEqual(3072);
		// Proportional headroom also grew: 1.8x+512 handles verbose Muse rewrites
		expect(briefNonReasoning).toBeGreaterThan(512);
	});
});
