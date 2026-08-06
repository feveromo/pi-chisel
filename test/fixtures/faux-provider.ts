import type {
	AssistantMessage,
	Context,
	Model,
	SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "prompt-optimizer-faux";
const MODEL = "faux-model";

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

export default function fauxProvider(pi: ExtensionAPI): void {
	pi.registerProvider(PROVIDER, {
		name: "Pi Chisel Faux Provider",
		baseUrl: "https://example.invalid",
		apiKey: "faux-test-key",
		api: "prompt-optimizer-faux-api",
		models: [
			{
				id: MODEL,
				name: "Pi Chisel Faux Model",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128_000,
				maxTokens: 4096,
			},
		],
		streamSimple(model, context, options?: SimpleStreamOptions) {
			const stream = createAssistantMessageEventStream();
			const input = textFromLastUser(context);
			const optimizing =
				context.systemPrompt?.includes("Pi Chisel's prompt editor") ?? false;
			const text = optimizing
				? "Please make this clearer while preserving the exact intent."
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
		},
	});
}
