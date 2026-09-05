import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@oh-my-pi/pi-ai";
import type { ExtensionContext, SessionEntry } from "@oh-my-pi/pi-coding-agent";
import { DEFAULT_OPTIMIZER_CONFIG } from "../src/config.ts";
import { buildOptimizationGrounding } from "../src/grounding.ts";
import { buildOptimizationRequest } from "../src/request-builder.ts";

const MODEL: Model<Api> = {
	provider: "test",
	id: "grounding-model",
	name: "Grounding Model",
	api: "test",
	baseUrl: "https://example.invalid",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128_000,
	maxTokens: 4096,
	compat: {} as Model<Api>["compat"],
};
const temporaryDirectories: string[] = [];
afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

function message(role: "user" | "assistant", text: string): SessionEntry {
	return {
		type: "message",
		id: crypto.randomUUID(),
		parentId: null,
		timestamp: new Date(0).toISOString(),
		message: { role, content: [{ type: "text", text }] },
	} as unknown as SessionEntry;
}

function context(
	cwd: string,
	entries: readonly SessionEntry[],
): Pick<ExtensionContext, "cwd" | "getSystemPrompt" | "sessionManager"> {
	return {
		cwd,
		getSystemPrompt: () => [`Current working directory: ${cwd}`],
		sessionManager: {
			getBranch: () => [...entries],
		} as unknown as ExtensionContext["sessionManager"],
	};
}

describe("optimization grounding", () => {
	it("grounds a fresh session in the workspace instead of declaring context unnecessary", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-chisel-grounding-"));
		temporaryDirectories.push(cwd);
		await writeFile(
			join(cwd, "package.json"),
			JSON.stringify({
				name: "fresh-session-project",
				description: "A context-aware editor extension.",
			}),
		);
		await writeFile(
			join(cwd, "README.md"),
			"# Fresh Session Project\n\nImproves unsent prompts safely.\n",
		);

		const grounding = await buildOptimizationGrounding(
			context(cwd, []),
			{ ...DEFAULT_OPTIMIZER_CONFIG },
			"make this clearer",
			MODEL,
		);

		expect(grounding.reference?.workspace?.text).toContain(
			"Package: fresh-session-project",
		);
		expect(grounding.reference?.conversation).toBeUndefined();
		expect(grounding.summary).toContain("workspace + fresh session");
		expect(grounding.summary).not.toContain("no context needed");

		const request = buildOptimizationRequest(
			"make this clearer",
			grounding.reference,
			"standard",
		);
		expect(JSON.stringify(request.context.messages[0]?.content)).toContain(
			"WORKSPACE_CONTEXT",
		);
	});

	it("allocates more session capacity to explicit references, not brevity alone", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-chisel-grounding-"));
		temporaryDirectories.push(cwd);
		const entries = [
			message("user", `original goal.\n${"User detail.\n".repeat(400)}`),
			message(
				"assistant",
				`latest implementation.\n${"Assistant detail.\n".repeat(400)}`,
			),
		];
		const ctx = context(cwd, entries);
		const shortGrounding = await buildOptimizationGrounding(
			ctx,
			{ ...DEFAULT_OPTIMIZER_CONFIG },
			"fix it",
			MODEL,
		);
		const developedDraft = Array.from(
			{ length: 75 },
			(_, index) => `requirement-${index}`,
		).join(" ");
		const developedGrounding = await buildOptimizationGrounding(
			ctx,
			{ ...DEFAULT_OPTIMIZER_CONFIG },
			developedDraft,
			MODEL,
		);

		expect(shortGrounding.reference?.conversation?.messageCount).toBe(2);
		expect(
			shortGrounding.reference?.conversation?.estimatedTokens ?? 0,
		).toBeGreaterThan(
			developedGrounding.reference?.conversation?.estimatedTokens ?? 0,
		);
		expect(
			developedGrounding.reference?.conversation?.estimatedTokens ?? 0,
		).toBeLessThanOrEqual(512);
	});

	it("does not let workspace metadata consume a small user-intent budget", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-chisel-grounding-"));
		temporaryDirectories.push(cwd);
		await writeFile(
			join(cwd, "package.json"),
			JSON.stringify({
				name: "demo",
				description: "Workspace metadata. ".repeat(60),
			}),
		);
		await writeFile(
			join(cwd, "README.md"),
			`# Demo\n${"Project overview.\n".repeat(100)}`,
		);
		const grounding = await buildOptimizationGrounding(
			context(cwd, [
				message("user", "Discuss options only. Do not implement anything."),
			]),
			{
				...DEFAULT_OPTIMIZER_CONFIG,
				contextMode: "recent",
				contextTokenBudget: 256,
			},
			"Improve this.",
			MODEL,
		);
		expect(grounding.reference?.conversation?.text).toContain(
			"Do not implement anything.",
		);
		expect(grounding.reference?.estimatedTokens).toBeLessThanOrEqual(256);
	});

	it("keeps none as an explicit draft-only mode", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-chisel-grounding-"));
		temporaryDirectories.push(cwd);
		const grounding = await buildOptimizationGrounding(
			context(cwd, [message("user", "Relevant session detail")]),
			{ ...DEFAULT_OPTIMIZER_CONFIG, contextMode: "none" },
			"fix it",
			MODEL,
		);

		expect(grounding).toEqual({ summary: "context disabled" });
	});
});
