import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type Api,
	type AssistantMessage,
	type Context,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
	type ExtensionContext,
	initTheme,
	type SessionEntry,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it } from "vitest";
import {
	DEFAULT_OPTIMIZER_CONFIG,
	type OptimizerConfigStore,
} from "../src/config.ts";
import type { InvocationHandle } from "../src/overlay.ts";
import { OptimizerState } from "../src/state.ts";
import { ContextInspector } from "../src/ui/context.ts";
import { PromptOptimizationLoader } from "../src/ui/loader.ts";
import { PromptReviewComponent } from "../src/ui/review.ts";
import { runOptimizationWorkflow } from "../src/workflow.ts";

initTheme("dark", false);
const API = "chisel-workflow-test-api";
const model = {
	provider: "workflow-test",
	id: "model",
	name: "model",
	api: API,
	baseUrl: "https://example.invalid",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 4096,
	compat: {},
} as Model<Api>;
const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((d) => rm(d, { recursive: true, force: true })),
	);
});
const theme = {
	fg: (_: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;
type Step = {
	kind: "review" | "context" | "choice";
	keys: string[];
	check?: (rendered: string) => void;
};

async function harness(
	outputs: string[],
	steps: Step[],
	feedback: (string | undefined)[] = [],
	inspectContext = false,
	entries: SessionEntry[] = [],
) {
	const cwd = await mkdtemp(join(tmpdir(), "chisel-workflow-"));
	directories.push(cwd);
	const draft = "Hey, can we improve this? No code changes.";
	let editor = draft;
	const writes: string[] = [];
	const requests: Context[] = [];
	const invocation: InvocationHandle = {
		id: 1,
		dismiss: undefined,
		requestController: undefined,
	};
	const stream = (
		_model: Model<Api>,
		context: Context,
		options?: SimpleStreamOptions,
	) => {
		requests.push(context);
		const response = outputs.shift();
		if (response === undefined) throw new Error("Unexpected provider request");
		const result = createAssistantMessageEventStream();
		const message = {
			role: "assistant",
			content: [{ type: "text", text: response }],
			api: API,
			provider: model.provider,
			model: model.id,
			stopReason: "stop",
			timestamp: 0,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
		} as AssistantMessage;
		queueMicrotask(() => {
			if (response === "CANCEL") {
				invocation.dismiss?.();
				result.push({
					type: "error",
					reason: "aborted",
					error: { ...message, stopReason: "aborted" },
				});
			} else if (response === "FAIL")
				result.push({
					type: "error",
					reason: "error",
					error: {
						...message,
						stopReason: "error",
						errorMessage: "Synthetic provider failure",
					},
				});
			else result.push({ type: "done", reason: "stop", message });
			result.end();
		});
		expect(options?.cacheRetention).toBe("none");
		expect(context.tools).toBeUndefined();
		return result;
	};
	const registry = {
		getAvailable: () => [model],
		find: () => model,
		hasProvider: () => true,
		getProviderBaseUrl: () => model.baseUrl,
		getProviderHeaders: () => ({}),
		resolver: () => async () => "synthetic",
		getProvider: () => ({ streamSimple: stream }),
		streamSimple: stream,
		getApiKeyAndHeaders: async () => ({ ok: true }),
	};
	const tui = {
		requestRender() {},
		requestComponentRender() {},
		terminal: { rows: 42 },
	} as unknown as TUI;
	const ctx = {
		cwd,
		hasUI: true,
		mode: "tui",
		model,
		modelRegistry: registry,
		getSystemPrompt: () => "",
		isProjectTrusted: () => true,
		sessionManager: {
			getBranch: () => entries,
			buildContextEntries: () => entries,
		},
		ui: {
			getEditorText: () => editor,
			setEditorText: (text: string) => {
				editor = text;
				writes.push(text);
			},
			editor: async () => feedback.shift(),
			custom: async (
				factory: (
					tui: TUI,
					theme: Theme,
					keys: unknown,
					done: (result: unknown) => void,
				) => Component & { dispose?: () => void },
			) => {
				let done!: (result: unknown) => void;
				const result = new Promise((resolve) => {
					done = resolve;
				});
				const component = factory(tui, theme, {}, done);
				if (!(component instanceof PromptOptimizationLoader)) {
					const kind =
						component instanceof PromptReviewComponent
							? "review"
							: component instanceof ContextInspector
								? "context"
								: "choice";
					const step = steps.shift();
					expect(step?.kind).toBe(kind);
					step?.check?.(component.render(82).join("\n"));
					for (const key of step?.keys ?? []) {
						component.handleInput?.(key);
						component.render(82);
					}
				}
				try {
					return await result;
				} finally {
					component.dispose?.();
				}
			},
		},
	} as unknown as ExtensionContext;
	const state = new OptimizerState(
		{
			save: async () => {
				throw new Error("No draft data may be persisted");
			},
		} as unknown as OptimizerConfigStore,
		{ ...DEFAULT_OPTIMIZER_CONFIG },
	);
	const run = (chooseModel = async () => false) =>
		runOptimizationWorkflow({
			ctx,
			invocation,
			state,
			capturedDraft: draft,
			isActive: () => true,
			chooseModel,
			inspectContext,
		});
	return { run, requests, writes, draft, steps, outputs, ctx };
}

describe("integrated review workflow", () => {
	it("cancels preflight without calling the provider or changing the editor", async () => {
		const test = await harness(
			[],
			[{ kind: "context", keys: ["\x1b"] }],
			[],
			true,
		);
		await test.run();
		expect(test.requests).toHaveLength(0);
		expect(test.writes).toEqual([]);
	});
	it("does not add an implicit brevity constraint on a blank retry", async () => {
		const test = await harness(
			["First candidate.", "Second candidate."],
			[
				{ kind: "review", keys: ["r"] },
				{ kind: "review", keys: ["q"] },
			],
			[""],
		);
		await test.run();
		expect(test.requests).toHaveLength(2);
		const revision = JSON.stringify(test.requests[1]?.messages);
		expect(revision).toContain("at the selected intensity");
		expect(revision).toContain("explicit constraints");
		expect(revision).not.toContain("brevity");
		expect(test.writes).toEqual([]);
	});

	it("keeps default invocation effortless, and carries exact original/candidate/feedback on retry", async () => {
		const test = await harness(
			["First candidate.", "Second candidate."],
			[
				{ kind: "review", keys: ["r"] },
				{ kind: "review", keys: ["q"] },
			],
			["Less formal. Keep my opening."],
		);
		await test.run();
		expect(test.requests).toHaveLength(2);
		const revision = JSON.stringify(test.requests[1]?.messages);
		expect(revision).toContain(test.draft);
		expect(revision).toContain("First candidate.");
		expect(revision).toContain("Less formal. Keep my opening.");
		expect(test.writes).toEqual([]);
	});
	for (const outcome of ["FAIL", "CANCEL"])
		it(`keeps the previous candidate after ${outcome.toLowerCase()}`, async () => {
			const test = await harness(
				["First candidate.", outcome],
				[
					{ kind: "review", keys: ["r"] },
					{
						kind: "review",
						keys: ["\r"],
						check: (text) => {
							expect(text).toContain("First candidate.");
							expect(text.toLowerCase()).toContain("previous candidate kept");
						},
					},
					{ kind: "choice", keys: ["\r"] },
				],
				["Be shorter."],
			);
			await test.run();
			expect(test.writes).toEqual(["First candidate."]);
		});
	it("cancels feedback without a reroll and can return to an earlier successful candidate", async () => {
		const test = await harness(
			["First candidate.", "Second candidate."],
			[
				{ kind: "review", keys: ["r"] },
				{ kind: "review", keys: ["r"] },
				{ kind: "review", keys: ["b"] },
				{
					kind: "review",
					keys: ["q"],
					check: (text) => expect(text).toContain("First candidate."),
				},
			],
			[undefined, "Shorter."],
		);
		await test.run();
		expect(test.requests).toHaveLength(2);
		expect(test.writes).toEqual([]);
	});
	it("excludes sources and regenerates without quietly replenishing them", async () => {
		const test = await harness(
			["First candidate.", "Second candidate."],
			[
				{ kind: "review", keys: ["c"] },
				{
					kind: "context",
					keys: ["0", "\r"],
					check: (text) => expect(text).toContain("cannot unsend"),
				},
				{ kind: "review", keys: ["q"] },
			],
		);
		await test.run();
		expect(JSON.stringify(test.requests[0]?.messages)).toContain(
			"WORKSPACE_CONTEXT",
		);
		expect(JSON.stringify(test.requests[1]?.messages)).not.toContain(
			"WORKSPACE_CONTEXT",
		);
		expect(test.writes).toEqual([]);
	});
	it("does not resurrect excluded sources after a failed regeneration", async () => {
		const test = await harness(
			["First candidate.", "FAIL", "Third candidate."],
			[
				{ kind: "review", keys: ["c"] },
				{ kind: "context", keys: ["0", "\r"] },
				{ kind: "review", keys: ["c"] },
				{
					kind: "context",
					keys: ["\x1b"],
					check: (text) => expect(text).toContain("[ ] supplied ·"),
				},
				{ kind: "review", keys: ["r"] },
				{ kind: "review", keys: ["q"] },
			],
			["Shorter."],
		);
		await test.run();
		for (const request of test.requests.slice(1))
			expect(JSON.stringify(request.messages)).not.toContain(
				"WORKSPACE_CONTEXT",
			);
	});
	it("requires inspection when model capacity shrinks and keeps candidate provenance on cancellation", async () => {
		const test = await harness(
			["First candidate."],
			[
				{ kind: "review", keys: ["m"] },
				{
					kind: "context",
					keys: ["\x1b"],
					check: (text) => {
						expect(text).toContain("reduced capacity");
						expect(text).toContain("[ ] supplied ·");
					},
				},
				{
					kind: "review",
					keys: ["q"],
					check: (text) => {
						expect(text).toContain("Model: workflow-test/model");
						expect(text).toContain("First candidate.");
					},
				},
			],
		);
		await test.run(async () => {
			Object.assign(test.ctx, {
				model: { ...model, id: "small", contextWindow: 1 },
			});
			return true;
		});
		expect(test.requests).toHaveLength(1);
		expect(test.writes).toEqual([]);
	});

	it("sends only tool excerpts explicitly checked in preflight", async () => {
		const entries = [
			{
				type: "message",
				id: "call",
				message: {
					role: "assistant",
					content: [
						{
							type: "toolCall",
							id: "call-1",
							name: "bash",
							arguments: { command: "npm test" },
						},
					],
				},
			},
			{
				type: "message",
				id: "result",
				timestamp: new Date(0).toISOString(),
				message: {
					role: "toolResult",
					toolCallId: "call-1",
					toolName: "bash",
					isError: true,
					content: [{ type: "text", text: "FAIL auth.test.ts" }],
				},
			},
		] as unknown as SessionEntry[];
		const test = await harness(
			["Candidate."],
			[
				{ kind: "context", keys: ["t", " ", "\r"] },
				{ kind: "review", keys: ["q"] },
			],
			[],
			true,
			entries,
		);
		await test.run();
		expect(JSON.stringify(test.requests[0]?.messages)).toContain(
			"FAIL auth.test.ts",
		);
		expect(test.writes).toEqual([]);
	});
	it("accepts an already-good draft without replacing it or forcing a reroll", async () => {
		const test = await harness(
			["Hey, can we improve this? No code changes."],
			[
				{
					kind: "review",
					keys: ["\r"],
					check: (text) => expect(text).toContain("ALREADY GOOD"),
				},
				{ kind: "choice", keys: ["\r"] },
			],
		);
		await test.run();
		expect(test.requests).toHaveLength(1);
		expect(test.writes).toEqual([]);
	});
});
