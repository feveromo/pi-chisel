import type { OptimizerIntensity } from "./config.ts";
import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	HOST_NAME,
	type Model,
	type ModelRegistry,
	streamOptimizerModel,
} from "./host.ts";
import type {
	OptimizationReference,
	OptimizationRevision,
} from "./request-builder.ts";
import {
	buildOptimizationRequest,
	calculateMaxOutputTokens,
	estimateTextTokens,
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
	revision?: OptimizationRevision;
	intensity: OptimizerIntensity;
	signal: AbortSignal;
	timeoutMs?: number;
	onTextDelta?: (totalCharacters: number) => void;
}

function responseText(response: AssistantMessage): string {
	let text = "";
	for (const block of response.content) {
		if (block.type === "text") text += block.text;
	}
	return text;
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
	return optimized.trim() === draft.trim() ? draft : optimized;
}

export async function runPromptOptimization(
	options: RunPromptOptimizationOptions,
): Promise<string> {
	const {
		model,
		modelRegistry,
		draft,
		reference,
		revision,
		intensity,
		signal,
		onTextDelta,
	} = options;
	if (signal.aborted) throw new PromptOptimizationCancelledError();

	const request = buildOptimizationRequest(
		draft,
		reference,
		intensity,
		revision,
	);
	const maxTokens = calculateMaxOutputTokens(
		revision &&
			estimateTextTokens(revision.candidate) > estimateTextTokens(draft)
			? revision.candidate
			: draft,
		model.maxTokens,
		Boolean(model.reasoning),
	);
	if (
		model.contextWindow !== null &&
		request.estimatedInputTokens + maxTokens + 4096 > model.contextWindow
	) {
		throw new PromptOptimizationError(
			`This request is too long for ${model.provider}/${model.id} without truncating your text. Choose a larger model or shorten the candidate or feedback.`,
		);
	}

	let stream: AssistantMessageEventStream;
	try {
		stream = await streamOptimizerModel(model, modelRegistry, request.context, {
			signal,
			maxTokens,
			timeoutMs: options.timeoutMs ?? OPTIMIZER_REQUEST_TIMEOUT_MS,
		});
	} catch (error) {
		if (signal.aborted) throw new PromptOptimizationCancelledError();
		throw new PromptOptimizationError(
			error instanceof Error ? error.message : String(error),
		);
	}

	const finalMessage = await consumeOptimizationStream(
		stream,
		signal,
		onTextDelta,
	);
	return validateOptimizationResponse(finalMessage, draft);
}

export function friendlyOptimizationError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	if (/429|rate.?limit/i.test(message))
		return "Chisel's model is rate-limited. Your original draft is still untouched.";
	if (/401|403|unauth|api key|credential|login/i.test(message)) {
		return `${HOST_NAME} could not authenticate Chisel's model: ${message}`;
	}
	if (/network|fetch|socket|econn|enotfound|timed?\s*out/i.test(message)) {
		return `Chisel could not reach the provider: ${message}`;
	}
	return message;
}
