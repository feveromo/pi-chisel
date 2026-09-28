// Host boundary for the OMP build (branch `main`).
//
// Every other file in src/ is shared byte-for-byte with the native Pi build on
// `pi`. Keep host package imports and host-specific behavior in this file so
// shared changes can be copied between branches unchanged.
import {
	type Api,
	type AssistantMessageEventStream,
	type Context,
	type Effort,
	type Model,
	streamSimple,
	type UserMessage,
} from "@oh-my-pi/pi-ai";
import {
	type ExtensionContext,
	getSelectListTheme,
	type ModelRegistry,
	type SessionEntry,
	type Theme,
} from "@oh-my-pi/pi-coding-agent";
import {
	CancellableLoader,
	type SelectListTheme,
	type TUI,
	truncateToWidth,
} from "@oh-my-pi/pi-tui";

export type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Model,
	UserMessage,
} from "@oh-my-pi/pi-ai";
export {
	DynamicBorder,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	getAgentDir,
	getSettingsListTheme,
	type ModelRegistry,
	type SessionEntry,
	type Theme,
} from "@oh-my-pi/pi-coding-agent";
export {
	type Component,
	Container,
	decodePrintableKey,
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
} from "@oh-my-pi/pi-tui";

export const HOST_NAME = "OMP";

/** Entries on the active session branch. */
export function sessionEntries(
	ctx: Pick<ExtensionContext, "sessionManager">,
): SessionEntry[] {
	return ctx.sessionManager.getBranch();
}

export function systemPromptText(
	ctx: Pick<ExtensionContext, "getSystemPrompt">,
): string {
	return ctx.getSystemPrompt().join("\n\n");
}

export function estimateTextTokens(text: string): number {
	return (Buffer.byteLength(text, "utf8") + 3) >> 2;
}

export function optimizerContext(
	systemPrompt: string,
	message: UserMessage,
): Context {
	return { systemPrompt: [systemPrompt], messages: [message] };
}

/** Truncate one terminal line with a single-column ellipsis. */
export function truncateLine(text: string, width: number): string {
	return truncateToWidth(text, width);
}

export function selectListTheme(theme: Theme): SelectListTheme {
	return {
		...getSelectListTheme(),
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
	return new CancellableLoader(
		tui,
		spinnerColor,
		messageColor,
		message,
		frames,
	);
}

export interface OptimizerStreamOptions {
	signal: AbortSignal;
	maxTokens: number;
	timeoutMs: number;
}

function lowestReasoningEffort(model: Model<Api>): Effort | undefined {
	if (!model.reasoning) return undefined;
	return model.thinking?.efforts[0];
}

/**
 * Start the side-channel optimizer request with OMP's session-sticky API-key
 * resolver and the model's fully resolved header chain.
 */
export async function streamOptimizerModel(
	model: Model<Api>,
	modelRegistry: ModelRegistry,
	context: Context,
	options: OptimizerStreamOptions,
): Promise<AssistantMessageEventStream> {
	if (!modelRegistry.hasProvider(model.provider))
		throw new Error(`OMP no longer has provider “${model.provider}”.`);
	const baseUrl =
		modelRegistry.getProviderBaseUrl(model.provider) ?? model.baseUrl;
	const requestModel = baseUrl ? { ...model, baseUrl } : model;
	const sessionId = crypto.randomUUID();
	if (
		!(await modelRegistry.getApiKey(requestModel, sessionId, {
			signal: options.signal,
		}))
	)
		throw new Error(`No API key found for "${model.provider}"`);
	const headers = await modelRegistry.resolveModelHeaders(
		requestModel,
		options.signal,
	);
	const reasoning = lowestReasoningEffort(requestModel);
	return streamSimple(requestModel, context, {
		...(model.reasoning ? {} : { temperature: 0.2 }),
		...(reasoning ? { reasoning } : {}),
		apiKey: modelRegistry.resolver(requestModel, sessionId),
		...(headers ? { headers } : {}),
		signal: options.signal,
		maxTokens: options.maxTokens,
		cacheRetention: "none",
		sessionId,
		codexSseMaxAttempts: 1,
	});
}
