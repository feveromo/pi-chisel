// Host boundary for the native Pi build (branch `pi`).
//
// Every other file in src/ is shared byte-for-byte with the OMP build on
// `main`. Keep host package imports and host-specific behavior in this file so
// shared changes can be copied between branches unchanged.
import {
	type Api,
	type AssistantMessageEventStream,
	type Context,
	type Model,
	type UserMessage,
	uuidv7,
} from "@earendil-works/pi-ai";
import {
	type ExtensionContext,
	estimateTokens,
	type ModelRegistry,
	type SessionEntry,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	CancellableLoader,
	type SelectListTheme,
	type TUI,
	truncateToWidth,
} from "@earendil-works/pi-tui";

export type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Model,
	UserMessage,
} from "@earendil-works/pi-ai";
export {
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	getAgentDir,
	getSettingsListTheme,
	type ModelRegistry,
	type SessionEntry,
	type Theme,
} from "@earendil-works/pi-coding-agent";
export {
	type Component,
	Container,
	decodeKittyPrintable as decodePrintableKey,
	type Focusable,
	fuzzyFilter,
	getKeybindings,
	Input,
	type Keybinding,
	type KeybindingsConfig,
	type KeyId,
	matchesKey,
	type SelectItem,
	SelectList,
	type SettingItem,
	SettingsList,
	Spacer,
	Text,
	type TUI,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

export const HOST_NAME = "Pi";

/** Branch entries that Pi would send to the model, after compaction. */
export function sessionEntries(
	ctx: Pick<ExtensionContext, "sessionManager">,
): SessionEntry[] {
	return ctx.sessionManager.buildContextEntries();
}

export function systemPromptText(
	ctx: Pick<ExtensionContext, "getSystemPrompt">,
): string {
	return ctx.getSystemPrompt();
}

export function estimateTextTokens(text: string): number {
	const message: UserMessage = {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: 0,
	};
	return estimateTokens(message);
}

export function optimizerContext(
	systemPrompt: string,
	message: UserMessage,
): Context {
	return { systemPrompt, messages: [message] };
}

/** Truncate one terminal line with a single-column ellipsis. */
export function truncateLine(text: string, width: number): string {
	return truncateToWidth(text, width, "…");
}

export function selectListTheme(theme: Theme): SelectListTheme {
	return {
		selectedPrefix: (text) => theme.fg("accent", text),
		selectedText: (text) => theme.fg("accent", text),
		description: (text) => theme.fg("muted", text),
		scrollInfo: (text) => theme.fg("dim", text),
		noMatch: (text) => theme.fg("warning", text),
	};
}

export function createProgressLoader(
	tui: TUI,
	spinnerColor: (text: string) => string,
	messageColor: (text: string) => string,
	message: string,
	frames: string[],
): CancellableLoader {
	// Pi draws custom indicator frames verbatim, so color them here.
	return new CancellableLoader(tui, spinnerColor, messageColor, message, {
		frames: frames.map(spinnerColor),
		intervalMs: 90,
	});
}

export interface OptimizerStreamOptions {
	signal: AbortSignal;
	maxTokens: number;
	timeoutMs: number;
}

/**
 * Start the side-channel optimizer request. Pi's registry normalizes the
 * system prompt into a leading system message and applies request-time auth,
 * including credential-specific base URLs.
 */
export async function streamOptimizerModel(
	model: Model<Api>,
	modelRegistry: ModelRegistry,
	context: Context,
	options: OptimizerStreamOptions,
): Promise<AssistantMessageEventStream> {
	// Pi installs packages without enforcing peer ranges, so check the API here.
	if (typeof modelRegistry.streamSimple !== "function")
		throw new Error("Pi Chisel requires Pi 0.87.1 or newer.");
	if (!modelRegistry.getProvider(model.provider))
		throw new Error(`Pi no longer has provider “${model.provider}”.`);
	const auth = await modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) throw new Error(auth.error);
	return modelRegistry.streamSimple(model, context, {
		...(model.reasoning
			? { reasoning: "minimal" as const }
			: { temperature: 0.2 }),
		...(auth.apiKey ? { apiKey: auth.apiKey } : {}),
		...(auth.headers ? { headers: auth.headers } : {}),
		...(auth.env ? { env: auth.env } : {}),
		signal: options.signal,
		maxTokens: options.maxTokens,
		cacheRetention: "none",
		sessionId: uuidv7(),
		timeoutMs: options.timeoutMs,
		maxRetries: 0,
	});
}
