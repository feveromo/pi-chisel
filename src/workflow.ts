import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildConversationReference } from "./context-builder.ts";
import {
	friendlyOptimizationError,
	OPTIMIZER_REQUEST_TIMEOUT_MS,
	OPTIMIZER_TIMEOUT_MESSAGE,
	PromptOptimizationCancelledError,
	runPromptOptimization,
} from "./model-client.ts";
import {
	calculateContextBudgetForModel,
	modelReference,
	type ResolvedOptimizerModel,
	resolveOptimizerModel,
} from "./model-selection.ts";
import {
	type InvocationHandle,
	PROMPT_BUBBLE_OVERLAY,
	showChoice,
	showReview,
} from "./overlay.ts";
import { acceptReplacement, type ReplacementRecord } from "./replacement.ts";
import {
	buildOptimizationRequest,
	calculateMaxOutputTokens,
	estimateTextTokens,
	type OptimizationReference,
} from "./request-builder.ts";
import type { OptimizerState } from "./state.ts";
import { PromptBubbleLoader } from "./ui/index.ts";

interface GenerationSuccess {
	kind: "success";
	optimized: string;
}

interface GenerationFailure {
	kind: "error";
	message: string;
}

interface GenerationCancelled {
	kind: "cancelled";
}

type GenerationOutcome =
	| GenerationSuccess
	| GenerationFailure
	| GenerationCancelled;

export interface OptimizationWorkflowOptions {
	ctx: ExtensionContext;
	invocation: InvocationHandle;
	state: OptimizerState;
	capturedDraft: string;
	isActive: () => boolean;
	chooseModel: () => Promise<boolean>;
}

export async function runOptimizationWorkflow(
	options: OptimizationWorkflowOptions,
): Promise<ReplacementRecord | undefined> {
	const { ctx, invocation, state, capturedDraft, isActive, chooseModel } =
		options;
	let optimized: string | undefined;
	let resolved: ResolvedOptimizerModel | undefined;
	let reference: OptimizationReference | undefined;
	let contextSummary = "no conversation context";

	while (isActive()) {
		if (!optimized) {
			resolved = resolveOptimizerModel(state.config.model, ctx);
			if (!resolved) {
				const action = await showChoice(
					ctx,
					"No optimizer model",
					"Pi has no current or pinned optimizer model available.",
					[
						{ value: "model", label: "Choose a model", key: "m" },
						{ value: "cancel", label: "Cancel", key: "q" },
					],
					invocation,
				);
				if (action === "model" && (await chooseModel())) continue;
				return undefined;
			}

			const context = buildReference(ctx, state, capturedDraft, resolved.model);
			reference = context.reference;
			contextSummary = context.summary;
			const warning =
				[state.warning, resolved.warning].filter(Boolean).join(" ") ||
				undefined;
			const outcome = await generatePrompt(
				ctx,
				invocation,
				state,
				capturedDraft,
				resolved,
				reference,
				contextSummary,
				warning,
			);

			if (outcome.kind === "cancelled") return undefined;
			if (outcome.kind === "error") {
				const action = await showChoice(
					ctx,
					"Polish failed",
					outcome.message,
					[
						{ value: "retry", label: "Retry", key: "r" },
						{ value: "model", label: "Change model", key: "m" },
						{ value: "cancel", label: "Keep original and close", key: "q" },
					],
					invocation,
				);
				if (action === "retry") continue;
				if (action === "model" && (await chooseModel())) continue;
				return undefined;
			}
			optimized = outcome.optimized;
		}

		if (!resolved) return undefined;
		const action = await showReview(
			ctx,
			invocation,
			capturedDraft,
			optimized,
			resolved,
			contextSummary,
			state.config,
		);
		if (action === "cancel") return undefined;
		if (action === "retry") {
			optimized = undefined;
			continue;
		}
		if (action === "model") {
			if (await chooseModel()) optimized = undefined;
			continue;
		}
		if (action === "edit") {
			const edited = await ctx.ui.editor("Edit optimized prompt", optimized);
			if (edited?.trim()) optimized = edited;
			continue;
		}
		return acceptReplacement(ctx, invocation, capturedDraft, optimized);
	}

	return undefined;
}

function buildReference(
	ctx: ExtensionContext,
	state: OptimizerState,
	draft: string,
	model: Model<Api>,
): { reference?: OptimizationReference; summary: string } {
	const draftTokens = estimateTextTokens(draft);
	const outputTokens = calculateMaxOutputTokens(draft, model.maxTokens);
	const withoutReference = buildOptimizationRequest(
		draft,
		undefined,
		state.config.intensity,
	);
	const framingTokens = Math.max(
		0,
		withoutReference.estimatedInputTokens - draftTokens,
	);
	const budget = calculateContextBudgetForModel(
		model,
		draftTokens,
		state.config.contextTokenBudget,
		outputTokens,
		framingTokens,
	);
	const result = buildConversationReference(
		ctx.sessionManager.getBranch(),
		draft,
		state.config.contextMode,
		budget,
	);

	if (result.reference) {
		return {
			reference: result.reference,
			summary: `${result.reference.turnCount} recent turn${result.reference.turnCount === 1 ? "" : "s"} · ~${result.reference.estimatedTokens} context tokens`,
		};
	}
	if (result.reason === "not-referential")
		return { summary: "no context needed" };
	if (result.reason === "disabled") return { summary: "context disabled" };
	if (result.reason === "no-visible-turns")
		return { summary: "no conversation context" };
	if (result.reason === "budget-exhausted")
		return { summary: "no context (draft takes priority)" };
	return { summary: "no conversation context" };
}

async function generatePrompt(
	ctx: ExtensionContext,
	invocation: InvocationHandle,
	state: OptimizerState,
	draft: string,
	resolved: ResolvedOptimizerModel,
	reference: OptimizationReference | undefined,
	contextSummary: string,
	warning: string | undefined,
): Promise<GenerationOutcome> {
	const requestController = new AbortController();
	invocation.requestController = requestController;
	let timedOut = false;

	try {
		return await ctx.ui.custom<GenerationOutcome>(
			(tui, theme, _keybindings, done) => {
				let settled = false;
				const finish = (outcome: GenerationOutcome) => {
					if (settled) return;
					settled = true;
					done(outcome);
				};
				invocation.dismiss = () => {
					requestController.abort();
					finish({ kind: "cancelled" });
				};

				const loader = new PromptBubbleLoader(
					tui,
					theme,
					modelReference(resolved.model),
					contextSummary,
					warning,
				);
				loader.onAbort = () => {
					requestController.abort();
					finish({ kind: "cancelled" });
				};
				const signal = AbortSignal.any([
					requestController.signal,
					loader.signal,
				]);
				const timeout = setTimeout(() => {
					timedOut = true;
					requestController.abort();
					finish({
						kind: "error",
						message: OPTIMIZER_TIMEOUT_MESSAGE,
					});
				}, OPTIMIZER_REQUEST_TIMEOUT_MS);
				let lastProgress = 0;

				void runPromptOptimization({
					model: resolved.model,
					modelRegistry: ctx.modelRegistry,
					draft,
					...(reference ? { reference } : {}),
					intensity: state.config.intensity,
					signal,
					onTextDelta: (characters) => {
						if (characters - lastProgress >= 80) {
							lastProgress = characters;
							loader.setProgress(characters);
						}
					},
				})
					.then((result) => finish({ kind: "success", optimized: result }))
					.catch((error: unknown) => {
						if (
							(error instanceof PromptOptimizationCancelledError ||
								signal.aborted) &&
							!timedOut
						) {
							finish({ kind: "cancelled" });
							return;
						}
						finish({
							kind: "error",
							message: timedOut
								? OPTIMIZER_TIMEOUT_MESSAGE
								: friendlyOptimizationError(error),
						});
					})
					.finally(() => clearTimeout(timeout));

				return loader;
			},
			PROMPT_BUBBLE_OVERLAY,
		);
	} finally {
		requestController.abort();
		if (invocation.requestController === requestController)
			invocation.requestController = undefined;
		invocation.dismiss = undefined;
	}
}
