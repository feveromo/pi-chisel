import {
	type Api,
	type AssistantMessage,
	type Context,
	createAssistantMessageEventStream,
	type Model,
	type Provider,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
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
};

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
	const streamSimple = vi.fn(
		(model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
			seenModel = model;
			seenContext = context;
			seenOptions = options;
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => {
				stream.push({ type: "start", partial: response });
				stream.push({
					type: "text_delta",
					contentIndex: 0,
					delta: "x",
					partial: response,
				});
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
	const provider = { streamSimple } as unknown as Provider;
	const registry = {
		getProvider: () => provider,
		getApiKeyAndHeaders: async () => ({
			ok: true as const,
			apiKey: "resolved-by-pi",
			headers: { "x-test": "1" },
		}),
		getProviderAuth: async () => ({
			auth: { baseUrl: "https://credential-specific.example" },
		}),
	} as unknown as ModelRegistry;
	return {
		registry,
		streamSimple,
		getModel: () => seenModel,
		getContext: () => seenContext,
		getOptions: () => seenOptions,
	};
}

describe("prompt optimizer model client", () => {
	it("uses Pi's registered provider and resolved auth without adding session messages", async () => {
		const test = harness(assistant("```text\nA clearer prompt\n```"));
		const result = await runPromptOptimization({
			model: TEST_MODEL,
			modelRegistry: test.registry,
			draft: "make this clear",
			intensity: "standard",
			signal: new AbortController().signal,
		});

		expect(result).toBe("A clearer prompt");
		expect(test.streamSimple).toHaveBeenCalledOnce();
		expect(test.getModel()?.baseUrl).toBe(
			"https://credential-specific.example",
		);
		expect(test.getOptions()).toMatchObject({
			apiKey: "resolved-by-pi",
			cacheRetention: "none",
			maxRetries: 0,
			temperature: 0.2,
		});
		expect(test.getContext()?.messages).toHaveLength(1);
		expect(test.getContext()?.systemPrompt).toContain("prompt editor");
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
		expect(test.streamSimple).not.toHaveBeenCalled();
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
		expect(test.streamSimple).not.toHaveBeenCalled();
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
});
