import {
	type Api,
	type AssistantMessage,
	type Context,
	createAssistantMessageEventStream,
	type Model,
	registerCustomApi,
	type SimpleStreamOptions,
} from "@oh-my-pi/pi-ai";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const PROVIDER = "prompt-optimizer-faux";
const MODEL = "faux-model";
const API = "prompt-optimizer-faux-api";

function textFromLastUser(context: Context): string {
	const message = [...context.messages]
		.reverse()
		.find((candidate) => candidate.role === "user");
	if (!message) return "";
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter(
			(block): block is { type: "text"; text: string } => block.type === "text",
		)
		.map((block) => block.text)
		.join("\n");
}

function response(
	model: Model<string>,
	text: string,
	stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 10,
			output: 8,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 18,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: Date.now(),
	};
}

function streamFaux(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
) {
	const stream = createAssistantMessageEventStream();
	const input = textFromLastUser(context);
	const optimizing =
		context.systemPrompt?.some((prompt) =>
			prompt.includes("OMP Chisel's prompt editor"),
		) ?? false;
	const text = optimizing
		? (process.env.OMP_CHISEL_SMOKE_RESULT ??
			"Please make this clearer while preserving the exact intent.")
		: `MAIN RECEIVED: ${input}`;
	const message = response(model, text);
	const delay = optimizing && input.includes("slow original") ? 2000 : 120;
	const timer = setTimeout(() => {
		if (options?.signal?.aborted) return;
		stream.push({ type: "start", partial: message });
		stream.push({ type: "text_start", contentIndex: 0, partial: message });
		stream.push({
			type: "text_delta",
			contentIndex: 0,
			delta: text,
			partial: message,
		});
		stream.push({
			type: "text_end",
			contentIndex: 0,
			content: text,
			partial: message,
		});
		stream.push({ type: "done", reason: "stop", message });
		stream.end();
	}, delay);

	options?.signal?.addEventListener(
		"abort",
		() => {
			clearTimeout(timer);
			const aborted = response(model, "", "aborted");
			aborted.errorMessage = "Request was aborted";
			stream.push({ type: "error", reason: "aborted", error: aborted });
			stream.end();
		},
		{ once: true },
	);
	return stream;
}

export default function fauxProvider(pi: ExtensionAPI): void {
	// OMP's source-loaded extension graph and bundled host keep separate custom
	// API registries. Register in both so Chisel and the main session see the
	// same deterministic provider during this PTY smoke.
	registerCustomApi(API, streamFaux, "omp-chisel-faux-fixture");
	pi.registerProvider(PROVIDER, {
		baseUrl: "https://example.invalid",
		apiKey: "faux-test-key",
		api: API,
		models: [
			{
				id: MODEL,
				name: "OMP Chisel Faux Model",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128_000,
				maxTokens: 4096,
			},
		],
		streamSimple: streamFaux,
	});
}
