import { afterEach, describe, expect, it, mock } from "bun:test";
import {
	type Api,
	type AssistantMessage,
	type Context,
	createAssistantMessageEventStream,
	type Effort,
	type Model,
	registerCustomApi,
	type SimpleStreamOptions,
	unregisterCustomApis,
} from "@oh-my-pi/pi-ai";
import type { ModelRegistry } from "@oh-my-pi/pi-coding-agent";
import {
	PromptOptimizationCancelledError,
	PromptOptimizationError,
	runPromptOptimization,
} from "../src/model-client.ts";
import {
	buildOptimizationRequest,
	calculateMaxOutputTokens,
} from "../src/request-builder.ts";

const TEST_MODEL: Model<Api> = {
	provider: "test-provider",
	id: "test-model",
	name: "Test Model",
	api: "test-api",
	baseUrl: "https://example.invalid",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128_000,
	maxTokens: 4096,
	compat: {} as Model<Api>["compat"],
};

const CURRENT_REASONING_MODEL: Model<Api> = {
	...TEST_MODEL,
	provider: "openai-codex",
	id: "gpt-5.6-sol",
	name: "GPT-5.6-Sol",
	reasoning: true,
	thinking: {
		mode: "effort",
		efforts: ["low", "medium", "high", "xhigh", "max"] as Effort[],
	},
};

const CUSTOM_API_SOURCE = "pi-chisel-model-client-test";
afterEach(() => unregisterCustomApis(CUSTOM_API_SOURCE));

function assistant(
	text: string,
	stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: TEST_MODEL.api,
		provider: TEST_MODEL.provider,
		model: TEST_MODEL.id,
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: Date.now(),
	};
}

function harness(response: AssistantMessage) {
	let seenModel: Model<Api> | undefined;
	let seenContext: Context | undefined;
	let seenOptions: SimpleStreamOptions | undefined;
	const providerStream = mock(
		(model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
			seenModel = model;
			seenContext = context;
			seenOptions = options;
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => {
				stream.push({
					type: "done",
					reason: response.stopReason as "stop",
					message: response,
				});
				stream.end();
			});
			return stream;
		},
	);
	unregisterCustomApis(CUSTOM_API_SOURCE);
	registerCustomApi(TEST_MODEL.api, providerStream, CUSTOM_API_SOURCE);
	const credentialResolver = mock(async () => "resolved-by-omp");
	const registry = {
		hasProvider: () => true,
		getProviderBaseUrl: () => "https://credential-specific.example",
		getProviderHeaders: () => ({ "x-test": "1" }),
		resolver: () => credentialResolver,
	} as unknown as ModelRegistry;
	return {
		registry,
		providerStream,
		credentialResolver,
		getModel: () => seenModel,
		getContext: () => seenContext,
		getOptions: () => seenOptions,
	};
}

describe("prompt optimizer model client", () => {
	it("uses OMP's registered API and credential resolver without adding session messages", async () => {
		const test = harness(assistant("```text\nA clearer prompt\n```"));
		const result = await runPromptOptimization({
			model: TEST_MODEL,
			modelRegistry: test.registry,
			draft: "make this clear",
			intensity: "standard",
			signal: new AbortController().signal,
		});

		expect(result).toBe("A clearer prompt");
		expect(test.providerStream).toHaveBeenCalledTimes(1);
		expect(test.credentialResolver).toHaveBeenCalled();
		expect(test.getModel()?.baseUrl).toBe(
			"https://credential-specific.example",
		);
		expect(test.getOptions()).toMatchObject({
			apiKey: "resolved-by-omp",
			cacheRetention: "none",
			codexSseMaxAttempts: 1,
			headers: { "x-test": "1" },
			temperature: 0.2,
		});
		expect(test.getContext()?.messages).toHaveLength(1);
		expect(test.getContext()?.systemPrompt?.join("\n")).toContain(
			"prompt editor",
		);
	});

	it("uses the lowest effort supported by the current reasoning model", async () => {
		const test = harness(assistant("A clearer prompt"));
		await runPromptOptimization({
			model: CURRENT_REASONING_MODEL,
			modelRegistry: test.registry,
			draft: "make this clear",
			intensity: "standard",
			signal: new AbortController().signal,
		});

		expect(test.getOptions()?.reasoning).toBe("low" as Effort);
	});

	it("never starts a provider request after cancellation", async () => {
		const test = harness(assistant("unused"));
		const controller = new AbortController();
		controller.abort();

		await expect(
			runPromptOptimization({
				model: TEST_MODEL,
				modelRegistry: test.registry,
				draft: "draft",
				intensity: "light",
				signal: controller.signal,
			}),
		).rejects.toBeInstanceOf(PromptOptimizationCancelledError);
		expect(test.providerStream).not.toHaveBeenCalled();
	});

	it("reserves the full output allowance before starting a request", async () => {
		const draft = "keep every constraint";
		const inputTokens = buildOptimizationRequest(
			draft,
			undefined,
			"standard",
		).estimatedInputTokens;
		const outputTokens = calculateMaxOutputTokens(draft, TEST_MODEL.maxTokens);
		const constrainedModel = {
			...TEST_MODEL,
			contextWindow: inputTokens + outputTokens + 4096 - 1,
		};
		const test = harness(assistant("unused"));

		await expect(
			runPromptOptimization({
				model: constrainedModel,
				modelRegistry: test.registry,
				draft,
				intensity: "standard",
				signal: new AbortController().signal,
			}),
		).rejects.toThrow("without truncating");
		expect(test.providerStream).not.toHaveBeenCalled();
	});

	it("rejects empty, unchanged, or truncated output instead of replacing the draft", async () => {
		await expect(
			runPromptOptimization({
				model: TEST_MODEL,
				modelRegistry: harness(assistant("   ")).registry,
				draft: "draft",
				intensity: "standard",
				signal: new AbortController().signal,
			}),
		).rejects.toBeInstanceOf(PromptOptimizationError);

		await expect(
			runPromptOptimization({
				model: TEST_MODEL,
				modelRegistry: harness(assistant("draft")).registry,
				draft: "draft",
				intensity: "standard",
				signal: new AbortController().signal,
			}),
		).rejects.toThrow("unchanged");

		await expect(
			runPromptOptimization({
				model: TEST_MODEL,
				modelRegistry: harness(assistant("partial", "length")).registry,
				draft: "draft",
				intensity: "standard",
				signal: new AbortController().signal,
			}),
		).rejects.toThrow("output limit");

		await expect(
			runPromptOptimization({
				model: TEST_MODEL,
				modelRegistry: harness(assistant("draft")).registry,
				draft: "draft",
				intensity: "light",
				signal: new AbortController().signal,
			}),
		).resolves.toBe("draft");
	});

	it("runs with bounded defaults when OMP lacks model token metadata", async () => {
		const test = harness(assistant("A bounded rewrite"));
		await expect(
			runPromptOptimization({
				model: { ...TEST_MODEL, contextWindow: null, maxTokens: null },
				modelRegistry: test.registry,
				draft: "draft",
				intensity: "standard",
				signal: new AbortController().signal,
			}),
		).resolves.toBe("A bounded rewrite");
		expect(test.getOptions()?.maxTokens).toBe(1024);
	});
});
