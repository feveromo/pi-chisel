import {
	fitSources,
	referenceFromSources,
	referenceSources,
	summarizeSources,
} from "./evidence.ts";
import {
	buildOptimizationGrounding,
	groundingBudget,
	type OptimizationGrounding,
} from "./grounding.ts";
import type { ExtensionContext } from "./host.ts";
import {
	friendlyOptimizationError,
	OPTIMIZER_REQUEST_TIMEOUT_MS,
	OPTIMIZER_TIMEOUT_MESSAGE,
	PromptOptimizationCancelledError,
	runPromptOptimization,
} from "./model-client.ts";
import {
	modelReference,
	type ResolvedOptimizerModel,
	resolveOptimizerModel,
} from "./model-selection.ts";
import {
	type InvocationHandle,
	PROMPT_OVERLAY,
	showChoice,
	showContextInspector,
	showReview,
} from "./overlay.ts";
import { acceptReplacement, type ReplacementRecord } from "./replacement.ts";
import type {
	ContextSource,
	OptimizationReference,
	OptimizationRevision,
} from "./request-builder.ts";
import type { OptimizerState } from "./state.ts";
import { PromptOptimizationLoader } from "./ui/index.ts";
import type { ReviewPosition } from "./ui/review.ts";

type GenerationOutcome =
	| { kind: "success"; optimized: string }
	| { kind: "error"; message: string }
	| { kind: "cancelled" };
interface Candidate {
	text: string;
	resolved: ResolvedOptimizerModel;
	sources: ContextSource[];
	feedback: string;
}
export interface OptimizationWorkflowOptions {
	ctx: ExtensionContext;
	invocation: InvocationHandle;
	state: OptimizerState;
	capturedDraft: string;
	isActive: () => boolean;
	chooseModel: () => Promise<boolean>;
	inspectContext?: boolean;
}

export async function runOptimizationWorkflow(
	options: OptimizationWorkflowOptions,
): Promise<ReplacementRecord | undefined> {
	const { ctx, invocation, state, capturedDraft, isActive, chooseModel } =
		options;
	let current: Candidate | undefined;
	let previous: Candidate | undefined;
	let grounding: OptimizationGrounding | undefined;
	let sources: ContextSource[] = [];
	let generationRequested = true;
	let inspect = options.inspectContext ?? false;
	let feedback = "";
	let attempted = false;
	let warning: string | undefined;
	const position: ReviewPosition = {
		view: state.config.previewMode,
		offset: 0,
	};

	while (isActive()) {
		if (generationRequested) {
			const resolved = resolveOptimizerModel(state.config.model, ctx);
			if (!resolved) {
				const action = await showChoice(
					ctx,
					"Chisel needs a model",
					"Choose a current or pinned model before taking a pass.",
					[
						{ value: "model", label: "Choose model", key: "m" },
						{
							value: "cancel",
							label: current ? "Back to candidate" : "Keep original",
							key: "q",
						},
					],
					invocation,
					"back",
				);
				if (action === "model" && (await chooseModel())) continue;
				if (!current) return undefined;
				generationRequested = false;
				continue;
			}
			if (!grounding) {
				grounding = await buildOptimizationGrounding(
					ctx,
					state.config,
					capturedDraft,
					resolved.model,
				);
				sources = referenceSources(grounding.reference);
			}
			if (!isActive()) return undefined;
			const revision: OptimizationRevision | undefined = current
				? { candidate: current.text, feedback }
				: undefined;
			const budget =
				state.config.contextMode === "none"
					? 0
					: groundingBudget(
							state.config,
							capturedDraft,
							resolved.model,
							revision,
						);
			const fitted = fitSources(sources, budget);
			const shrank = fitted.length !== sources.length;
			if (inspect || state.config.inspectContext || shrank) {
				const selected = await showContextInspector(ctx, invocation, {
					sources: [
						...referenceSources(grounding.reference),
						...(grounding.toolCandidates ?? []),
					],
					selected: fitted,
					budget,
					modelRef: modelReference(resolved.model),
					beforeFirstSend: !attempted,
					...(current
						? { suppliedIds: current.sources.map((source) => source.id) }
						: {}),
					...(shrank
						? {
								note: "Model or revision reduced capacity. Review the remaining sources.",
							}
						: {}),
				});
				inspect = false;
				if (!isActive()) return undefined;
				if (!selected) {
					if (!current) return undefined;
					feedback = current.feedback;
					generationRequested = false;
					continue;
				}
				sources = selected;
			} else sources = fitted;

			attempted = true;
			const outcome = await generatePrompt(
				ctx,
				invocation,
				state,
				capturedDraft,
				resolved,
				referenceFromSources(sources),
				summarizeSources(sources),
				[state.warning, resolved.warning].filter(Boolean).join(" ") ||
					undefined,
				revision,
			);
			if (!isActive()) return undefined;
			if (outcome.kind !== "success") {
				if (current) {
					warning =
						outcome.kind === "error"
							? `${outcome.message} Previous candidate kept.`
							: "Pass cancelled · previous candidate kept.";
					feedback = current.feedback;
					generationRequested = false;
				} else {
					if (outcome.kind === "cancelled") return undefined;
					const action = await showChoice(
						ctx,
						"Chisel hit a snag",
						outcome.message,
						[
							{ value: "retry", label: "Another pass", key: "r" },
							{ value: "model", label: "Switch model", key: "m" },
							{ value: "cancel", label: "Keep original", key: "q" },
						],
						invocation,
						"keep original",
					);
					if (action === "retry") continue;
					if (action === "model" && (await chooseModel())) continue;
					return undefined;
				}
			} else {
				previous = current;
				current = {
					text: outcome.optimized,
					resolved,
					sources: [...sources],
					feedback,
				};
				warning = undefined;
				generationRequested = false;
			}
		}
		if (!current || !isActive()) return undefined;
		const action = await showReview(
			ctx,
			invocation,
			capturedDraft,
			current.text,
			current.resolved,
			summarizeSources(current.sources),
			state.config,
			Boolean(previous),
			position,
			warning,
		);
		if (!isActive() || action === "cancel") return undefined;
		if (action === "previous") {
			if (previous) {
				[current, previous] = [previous, current];
				feedback = current.feedback;
				warning = undefined;
			}
		} else if (action === "retry") {
			const request = await ctx.ui.editor(
				"Another pass — what should change? (blank: rephrase)",
				"",
			);
			if (request === undefined) continue;
			feedback = request.trim()
				? request
				: "Try another phrasing at the selected intensity, preserving the underlying goal, explicit constraints, uncertainty, and voice.";
			generationRequested = true;
		} else if (action === "context") {
			inspect = true;
			generationRequested = true;
		} else if (action === "model") {
			if (await chooseModel()) generationRequested = true;
		} else if (action === "edit") {
			const edited = await ctx.ui.editor(
				"Tune the chiseled draft",
				current.text,
			);
			if (edited?.trim() && edited !== current.text) {
				previous = current;
				current = { ...current, text: edited };
				warning = undefined;
			}
		} else if (action === "accept") {
			return acceptReplacement(
				ctx,
				invocation,
				capturedDraft,
				current.text,
				isActive,
			);
		}
	}
	return undefined;
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
	revision?: OptimizationRevision,
): Promise<GenerationOutcome> {
	const requestController = new AbortController();
	invocation.requestController = requestController;
	let timedOut = false;
	try {
		return await ctx.ui.custom<GenerationOutcome>((tui, theme, _keys, done) => {
			let settled = false;
			const finish = (outcome: GenerationOutcome) => {
				if (!settled) {
					settled = true;
					done(outcome);
				}
			};
			invocation.dismiss = () => {
				requestController.abort();
				finish({ kind: "cancelled" });
			};
			const loader = new PromptOptimizationLoader(
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
			const signal = AbortSignal.any([requestController.signal, loader.signal]);
			const timeout = setTimeout(() => {
				timedOut = true;
				requestController.abort();
				finish({ kind: "error", message: OPTIMIZER_TIMEOUT_MESSAGE });
			}, OPTIMIZER_REQUEST_TIMEOUT_MS);
			timeout.unref?.();
			signal.addEventListener("abort", () => clearTimeout(timeout), {
				once: true,
			});
			let lastProgress = 0;
			void runPromptOptimization({
				model: resolved.model,
				modelRegistry: ctx.modelRegistry,
				draft,
				...(reference ? { reference } : {}),
				...(revision ? { revision } : {}),
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
					)
						finish({ kind: "cancelled" });
					else
						finish({
							kind: "error",
							message: timedOut
								? OPTIMIZER_TIMEOUT_MESSAGE
								: friendlyOptimizationError(error),
						});
				})
				.finally(() => clearTimeout(timeout));
			return loader;
		}, PROMPT_OVERLAY);
	} finally {
		requestController.abort();
		if (invocation.requestController === requestController)
			invocation.requestController = undefined;
		invocation.dismiss = undefined;
	}
}
