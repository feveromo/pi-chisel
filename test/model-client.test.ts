import {
	type Api,
	type AssistantMessage,
	type Context,
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	fauxProvider,
	getSystemMessageText,
	InMemoryCredentialStore,
	InMemoryModelsStore,
	type Model,
	type Provider,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
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
		streamSimple,
		getProvider: () => provider,
		getApiKeyAndHeaders: async () => ({
			ok: true as const,
			apiKey: "resolved-by-pi",
			headers: { "x-test": "1" },
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
	it("normalizes system instructions through the real Pi model registry", async () => {
		const runtime = await ModelRuntime.create({
			credentials: new InMemoryCredentialStore(),
			modelsStore: new InMemoryModelsStore(),
			modelsPath: null,
			refreshOnCreate: false,
		});
		const faux = fauxProvider({ provider: "chisel-test" });
		runtime.registerNativeProvider(faux.provider);
		faux.setResponses([
			(context) => {
				expect(context).not.toHaveProperty("systemPrompt");
				expect(context.messages.map((message) => message.role)).toEqual([
					"system",
					"user",
				]);
				const first = context.messages[0];
				if (first?.role !== "system")
					throw new Error("Missing system instructions");
				expect(getSystemMessageText(first)).toContain("prompt editor");
				return fauxAssistantMessage("A clearer prompt");
			},
		]);
		await expect(
			runPromptOptimization({
				model: faux.getModel(),
				modelRegistry: new ModelRegistry(runtime),
				draft: "make this clear",
				intensity: "standard",
				signal: new AbortController().signal,
			}),
		).resolves.toBe("A clearer prompt");
		expect(faux.state.callCount).toBe(1);
	});

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
		expect(test.getOptions()).toMatchObject({
			apiKey: "resolved-by-pi",
			cacheRetention: "none",
			maxRetries: 0,
			temperature: 0.2,
		});
		expect(test.getContext()?.messages).toHaveLength(1);
		expect(test.getContext()?.systemPrompt).toContain("prompt editor");
	});

	it("reserves the larger estimated output for multilingual revision candidates", async () => {
		const test = harness(assistant("A clearer prompt"));
		const draft = "a".repeat(3000);
		const candidate = "日".repeat(2400);
		await runPromptOptimization({
			model: TEST_MODEL,
			modelRegistry: test.registry,
			draft,
			revision: { candidate, feedback: "Keep it brief." },
			intensity: "standard",
			signal: new AbortController().signal,
		});
		expect(test.getOptions()?.maxTokens).toBe(
			Math.max(
				calculateMaxOutputTokens(draft, TEST_MODEL.maxTokens),
				calculateMaxOutputTokens(candidate, TEST_MODEL.maxTokens),
			),
		);
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

	it("rejects empty or truncated output but accepts an already-good draft", async () => {
		await expect(
			runPromptOptimization({
				model: TEST_MODEL,
				modelRegistry: harness(assistant("   ")).registry,
				draft: "draft",
				intensity: "standard",
				signal: new AbortController().signal,
			}),
		).rejects.toBeInstanceOf(PromptOptimizationError);

		for (const intensity of ["light", "standard", "strong"] as const)
			await expect(
				runPromptOptimization({
					model: TEST_MODEL,
					modelRegistry: harness(assistant("draft")).registry,
					draft: "\n  draft\n\n",
					intensity,
					signal: new AbortController().signal,
				}),
			).resolves.toBe("\n  draft\n\n");

		await expect(
			runPromptOptimization({
				model: TEST_MODEL,
				modelRegistry: harness(assistant("partial", "length")).registry,
				draft: "draft",
				intensity: "standard",
				signal: new AbortController().signal,
			}),
		).rejects.toThrow("output limit");
	});
});
