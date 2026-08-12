import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Effort,
	type Model,
	streamSimple,
} from "@oh-my-pi/pi-ai";
import type { ModelRegistry } from "@oh-my-pi/pi-coding-agent";
import type { OptimizerIntensity } from "./config.ts";
import type { OptimizationReference } from "./request-builder.ts";
import {
	buildOptimizationRequest,
	calculateMaxOutputTokens,
	stripAccidentalFence,
} from "./request-builder.ts";

export const OPTIMIZER_REQUEST_TIMEOUT_MS = 120_000;
export const OPTIMIZER_TIMEOUT_MESSAGE =
	"Chisel timed out. Your original draft is still untouched.";

export class PromptOptimizationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PromptOptimizationError";
	}
}

export class PromptOptimizationCancelledError extends Error {
	constructor() {
		super("Prompt optimization cancelled");
		this.name = "PromptOptimizationCancelledError";
	}
}

export interface RunPromptOptimizationOptions {
	model: Model<Api>;
	modelRegistry: ModelRegistry;
	draft: string;
	reference?: OptimizationReference;
	intensity: OptimizerIntensity;
	signal: AbortSignal;
	onTextDelta?: (totalCharacters: number) => void;
}

function responseText(response: AssistantMessage): string {
	let text = "";
	for (const block of response.content) {
		if (block.type === "text") text += block.text;
	}
	return text;
}

function resolveRequestModel(
	model: Model<Api>,
	modelRegistry: ModelRegistry,
): Model<Api> {
	const baseUrl =
		modelRegistry.getProviderBaseUrl(model.provider) ?? model.baseUrl;
	return baseUrl ? { ...model, baseUrl } : model;
}

function lowestReasoningEffort(model: Model<Api>): Effort | undefined {
	if (!model.reasoning) return undefined;
	return model.thinking?.efforts[0];
}

async function consumeOptimizationStream(
	stream: AssistantMessageEventStream,
	signal: AbortSignal,
	onTextDelta: ((totalCharacters: number) => void) | undefined,
): Promise<AssistantMessage> {
	let finalMessage: AssistantMessage | undefined;
	let streamedCharacters = 0;
	try {
		for await (const event of stream) {
			if (event.type === "text_delta") {
				streamedCharacters += event.delta.length;
				onTextDelta?.(streamedCharacters);
			} else if (event.type === "done") {
				finalMessage = event.message;
			} else if (event.type === "error") {
				if (event.reason === "aborted" || signal.aborted)
					throw new PromptOptimizationCancelledError();
				throw new PromptOptimizationError(
					event.error.errorMessage || "Chisel's model returned an error.",
				);
			}
		}
	} catch (error) {
		if (signal.aborted) throw new PromptOptimizationCancelledError();
		throw error;
	}

	if (signal.aborted) throw new PromptOptimizationCancelledError();
	if (!finalMessage)
		throw new PromptOptimizationError(
			"Chisel's stream ended without a final response.",
		);
	return finalMessage;
}

function validateOptimizationResponse(
	finalMessage: AssistantMessage,
	draft: string,
	intensity: OptimizerIntensity,
): string {
	if (finalMessage.stopReason === "length") {
		throw new PromptOptimizationError(
			"Chisel hit its output limit, so the original draft was left untouched.",
		);
	}
	if (finalMessage.stopReason !== "stop") {
		throw new PromptOptimizationError(
			`Chisel stopped unexpectedly (${finalMessage.stopReason}).`,
		);
	}

	const optimized = stripAccidentalFence(responseText(finalMessage), draft);
	if (!optimized.trim())
		throw new PromptOptimizationError("Chisel returned an empty prompt.");
	if (intensity !== "light" && optimized.trim() === draft.trim()) {
		throw new PromptOptimizationError(
			"Chisel returned the draft unchanged, so the original was left untouched.",
		);
	}
	return optimized;
}

export async function runPromptOptimization(
	options: RunPromptOptimizationOptions,
): Promise<string> {
	const {
		model,
		modelRegistry,
		draft,
		reference,
		intensity,
		signal,
		onTextDelta,
	} = options;
	if (!modelRegistry.hasProvider(model.provider))
		throw new PromptOptimizationError(
			`OMP no longer has provider “${model.provider}”.`,
		);

	const requestModel = resolveRequestModel(model, modelRegistry);
	const reasoning = lowestReasoningEffort(requestModel);
	const sessionId = crypto.randomUUID();
	const headers = modelRegistry.getProviderHeaders(model.provider);
	if (signal.aborted) throw new PromptOptimizationCancelledError();

	const request = buildOptimizationRequest(draft, reference, intensity);
	const maxTokens = calculateMaxOutputTokens(
		draft,
		model.maxTokens,
		Boolean(model.reasoning),
	);
	if (
		model.contextWindow !== null &&
		request.estimatedInputTokens + maxTokens + 4096 > model.contextWindow
	) {
		throw new PromptOptimizationError(
			`The draft is too long for ${model.provider}/${model.id} without truncating it. Choose a model with a larger context window.`,
		);
	}

	let stream: AssistantMessageEventStream;
	try {
		stream = streamSimple(requestModel, request.context, {
			...(!model.reasoning ? { temperature: 0.2 } : {}),
			...(reasoning ? { reasoning } : {}),
			apiKey: modelRegistry.resolver(requestModel, sessionId),
			...(headers ? { headers } : {}),
			signal,
			maxTokens,
			cacheRetention: "none",
			sessionId,
			codexSseMaxAttempts: 1,
		});
	} catch (error) {
		throw new PromptOptimizationError(
			error instanceof Error ? error.message : String(error),
		);
	}

	const finalMessage = await consumeOptimizationStream(
		stream,
		signal,
		onTextDelta,
	);
	return validateOptimizationResponse(finalMessage, draft, intensity);
}

export function friendlyOptimizationError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	if (/429|rate.?limit/i.test(message))
		return "Chisel's model is rate-limited. Your original draft is still untouched.";
	if (/401|403|unauth|api key|credential|login/i.test(message)) {
		return `OMP could not authenticate Chisel's model: ${message}`;
	}
	if (/network|fetch|socket|econn|enotfound|timed?\s*out/i.test(message)) {
		return `Chisel could not reach the provider: ${message}`;
	}
	return message;
}
