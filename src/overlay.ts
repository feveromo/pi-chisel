import type { Api, Model } from "@oh-my-pi/pi-ai";
import type {
	ExtensionCommandContext,
	ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";
import type { OptimizerConfig, OptimizerModelPreference } from "./config.ts";
import {
	modelReference,
	type ResolvedOptimizerModel,
} from "./model-selection.ts";
import {
	type ChoiceOption,
	type ModelPickerResult,
	OptimizerModelPicker,
	OptimizerSettingsComponent,
	PromptChoiceComponent,
	PromptReviewComponent,
	type ReviewAction,
	type SettingsResult,
} from "./ui/index.ts";

export interface InvocationHandle {
	id: number;
	requestController: AbortController | undefined;
	dismiss: (() => void) | undefined;
}

export const PROMPT_OVERLAY = {
	overlay: true,
	overlayOptions: {
		width: "72%" as const,
		minWidth: 52,
		maxHeight: "84%" as const,
		margin: 1,
	},
};

export async function showChoice(
	ctx: ExtensionContext,
	title: string,
	message: string,
	options: ChoiceOption[],
	invocation?: InvocationHandle,
	escapeLabel = "cancel",
): Promise<string | undefined> {
	try {
		return await ctx.ui.custom<string | undefined>(
			(tui, theme, _keybindings, done) => {
				let settled = false;
				const finish = (value: string | undefined) => {
					if (settled) return;
					settled = true;
					done(value);
				};
				if (invocation) invocation.dismiss = () => finish(undefined);
				return new PromptChoiceComponent(
					tui,
					theme,
					title,
					message,
					options,
					finish,
					escapeLabel,
				);
			},
			PROMPT_OVERLAY,
		);
	} finally {
		if (invocation) invocation.dismiss = undefined;
	}
}

export async function showNotice(
	ctx: ExtensionContext,
	title: string,
	message: string,
	invocation?: InvocationHandle,
): Promise<void> {
	await showChoice(
		ctx,
		title,
		message,
		[{ value: "close", label: "Close", key: "enter" }],
		invocation,
		"close",
	);
}

export async function showReview(
	ctx: ExtensionContext,
	invocation: InvocationHandle,
	original: string,
	optimized: string,
	resolved: ResolvedOptimizerModel,
	contextSummary: string,
	config: OptimizerConfig,
): Promise<ReviewAction> {
	try {
		return await ctx.ui.custom<ReviewAction>(
			(tui, theme, _keybindings, done) => {
				let settled = false;
				const finish = (action: ReviewAction) => {
					if (settled) return;
					settled = true;
					done(action);
				};
				invocation.dismiss = () => finish("cancel");
				return new PromptReviewComponent(tui, theme, {
					original,
					optimized,
					initialView: config.previewMode,
					modelRef: modelReference(resolved.model),
					contextSummary,
					...(resolved.warning ? { warning: resolved.warning } : {}),
					onAction: finish,
				});
			},
			PROMPT_OVERLAY,
		);
	} finally {
		invocation.dismiss = undefined;
	}
}

export async function showModelPicker(
	ctx: ExtensionContext,
	preference: OptimizerModelPreference | null,
	invocation?: InvocationHandle,
): Promise<ModelPickerResult | undefined> {
	const available = ctx.modelRegistry.getAvailable();
	try {
		return await ctx.ui.custom<ModelPickerResult | undefined>(
			(tui, theme, _keybindings, done) => {
				let settled = false;
				const finish = (selection: ModelPickerResult | undefined) => {
					if (settled) return;
					settled = true;
					done(selection);
				};
				if (invocation) invocation.dismiss = () => finish(undefined);
				return new OptimizerModelPicker(
					tui,
					theme,
					ctx.model,
					available,
					preference,
					finish,
				);
			},
			PROMPT_OVERLAY,
		);
	} finally {
		if (invocation) invocation.dismiss = undefined;
	}
}

export async function showSettingsOverlay(
	ctx: ExtensionCommandContext,
	config: OptimizerConfig,
): Promise<SettingsResult | undefined> {
	return ctx.ui.custom<SettingsResult | undefined>(
		(tui, theme, keybindings, done) => {
			let modelLabel = "current chat model";
			if (config.model)
				modelLabel = `${config.model.provider}/${config.model.id}`;
			else if (ctx.model) modelLabel += ` (${modelReference(ctx.model)})`;
			return new OptimizerSettingsComponent(
				tui,
				theme,
				config,
				modelLabel,
				keybindings.getResolvedBindings(),
				done,
			);
		},
		PROMPT_OVERLAY,
	);
}

export function optimizerModelPreference(
	result: ModelPickerResult,
): OptimizerModelPreference | null {
	if (result.kind === "current") return null;
	return { provider: result.model.provider, id: result.model.id };
}

export function modelIsCurrentAvailable(
	result: ModelPickerResult,
	current: Model<Api> | undefined,
): boolean {
	return result.kind !== "current" || current !== undefined;
}
