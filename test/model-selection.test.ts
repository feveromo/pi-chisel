import { describe, expect, it } from "bun:test";
import type { Api, Model } from "@oh-my-pi/pi-ai";
import type {
	ExtensionContext,
	ModelRegistry,
} from "@oh-my-pi/pi-coding-agent";
import {
	calculateContextBudgetForModel,
	resolveOptimizerModel,
} from "../src/model-selection.ts";

function model(provider: string, id: string): Model<Api> {
	return {
		provider,
		id,
		name: id,
		api: "test",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 20_000,
		maxTokens: 4096,
		compat: {} as Model<Api>["compat"],
	};
}

function context(
	current: Model<Api> | undefined,
	all: Model<Api>[],
	available: Model<Api>[],
) {
	const registry = {
		getAvailable: () => available,
		find: (provider: string, id: string) =>
			all.find(
				(candidate) => candidate.provider === provider && candidate.id === id,
			),
	} as unknown as ModelRegistry;
	return { model: current, modelRegistry: registry } satisfies Pick<
		ExtensionContext,
		"model" | "modelRegistry"
	>;
}

describe("optimizer model selection", () => {
	it("uses the current chat model when no optimizer model is pinned", () => {
		const chat = model("openai-codex", "gpt-5.6-sol");
		expect(resolveOptimizerModel(null, context(chat, [chat], [chat]))).toEqual({
			model: chat,
			source: "current",
		});
	});

	it("uses a pinned available model without touching the chat model", () => {
		const chat = model("chat", "main");
		const pinned = model("other", "optimizer");
		expect(
			resolveOptimizerModel(
				{ provider: "other", id: "optimizer" },
				context(chat, [chat, pinned], [chat, pinned]),
			),
		).toEqual({
			model: pinned,
			source: "pinned",
		});
	});

	it("falls back visibly while retaining an unavailable pin", () => {
		const chat = model("chat", "main");
		const configured = model("other", "optimizer");
		const resolved = resolveOptimizerModel(
			{ provider: "other", id: "optimizer" },
			context(chat, [chat, configured], [chat]),
		);
		expect(resolved?.model).toBe(chat);
		expect(resolved?.source).toBe("fallback");
		expect(resolved?.warning).toContain("Chisel's pin stays put");
	});

	it("reserves draft and provider headroom before context", () => {
		const selected = model("p", "m");
		expect(
			calculateContextBudgetForModel(selected, 10_000, 8000, 2000, 1000),
		).toBe(2904);
		expect(
			calculateContextBudgetForModel(selected, 19_000, 8000, 2000, 1000),
		).toBe(0);
	});

	it("uses the configured grounding budget when OMP has no context-window metadata", () => {
		const selected = { ...model("p", "m"), contextWindow: null };
		expect(
			calculateContextBudgetForModel(selected, 10_000, 8000, 2000, 1000),
		).toBe(8000);
	});
});
