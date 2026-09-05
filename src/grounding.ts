import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { OptimizerConfig } from "./config.ts";
import {
	buildConversationReference,
	extractVisibleContextItems,
	toolEvidenceCandidates,
} from "./context-builder.ts";
import { analyzeDraft } from "./draft-analysis.ts";
import { calculateContextBudgetForModel } from "./model-selection.ts";
import { buildWorkspaceReference } from "./project-context.ts";
import {
	buildOptimizationRequest,
	type ContextSource,
	calculateMaxOutputTokens,
	estimateTextTokens,
	type OptimizationReference,
	type OptimizationRevision,
} from "./request-builder.ts";

export interface OptimizationGrounding {
	reference?: OptimizationReference;
	summary: string;
	toolCandidates?: ContextSource[];
}

type GroundingExtensionContext = Pick<
	ExtensionContext,
	"cwd" | "getSystemPrompt" | "isProjectTrusted" | "sessionManager"
>;

const REFERENCE_WRAPPER_RESERVE_TOKENS = 160;
const MAX_WORKSPACE_TOKENS_WITH_SESSION = 700;
const MAX_WORKSPACE_TOKENS_FRESH_SESSION = 1000;
const AUTO_AMBIENT_SESSION_TOKENS = 512;

function plural(count: number, singular: string): string {
	return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function contextSummary(
	reference: OptimizationReference,
	hasSessionEvidence: boolean,
): string {
	const parts: string[] = [];
	if (reference.workspace) {
		parts.push(
			reference.workspace.trusted ? "workspace" : "workspace identity",
		);
	}
	if (reference.conversation) {
		if (reference.conversation.summaryCount > 0) {
			parts.push(
				plural(reference.conversation.summaryCount, "session summary"),
			);
		}
		if (reference.conversation.messageCount > 0) {
			parts.push(plural(reference.conversation.messageCount, "recent message"));
		}
	} else if (hasSessionEvidence) {
		parts.push("session context did not fit");
	} else {
		parts.push("fresh session");
	}

	return `${parts.join(" + ")} · ~${reference.estimatedTokens.toLocaleString()} context tokens`;
}

export function groundingBudget(
	config: OptimizerConfig,
	draft: string,
	model: Model<Api>,
	revision?: OptimizationRevision,
): number {
	const withoutReference = buildOptimizationRequest(
		draft,
		undefined,
		config.intensity,
		revision,
	);
	const outputDraft =
		revision &&
		estimateTextTokens(revision.candidate) > estimateTextTokens(draft)
			? revision.candidate
			: draft;
	return calculateContextBudgetForModel(
		model,
		0,
		config.contextTokenBudget,
		calculateMaxOutputTokens(
			outputDraft,
			model.maxTokens,
			Boolean(model.reasoning),
		),
		withoutReference.estimatedInputTokens + REFERENCE_WRAPPER_RESERVE_TOKENS,
	);
}

export async function buildOptimizationGrounding(
	ctx: GroundingExtensionContext,
	config: OptimizerConfig,
	draft: string,
	model: Model<Api>,
): Promise<OptimizationGrounding> {
	if (config.contextMode === "none") return { summary: "context disabled" };

	const totalBudget = groundingBudget(config, draft, model);
	if (totalBudget <= 0)
		return { summary: "draft only · context window is full" };

	const entries = ctx.sessionManager.buildContextEntries();
	const hasSessionEvidence = extractVisibleContextItems(entries).length > 0;
	const workspaceLimit = hasSessionEvidence
		? Math.min(MAX_WORKSPACE_TOKENS_WITH_SESSION, Math.floor(totalBudget * 0.4))
		: Math.min(totalBudget, MAX_WORKSPACE_TOKENS_FRESH_SESSION);

	let systemPrompt = "";
	let trusted = false;
	try {
		systemPrompt = ctx.getSystemPrompt();
		trusted = ctx.isProjectTrusted();
	} catch {
		// Workspace extraction still works if the runtime prompt is unavailable.
	}
	const workspace = await buildWorkspaceReference({
		cwd: ctx.cwd,
		systemPrompt,
		trusted,
		tokenBudget: workspaceLimit,
		...(config.contextMode === "auto" ? { draft } : {}),
	});
	const remainingBudget = Math.max(
		0,
		totalBudget - (workspace?.estimatedTokens ?? 0),
	);
	const profile = analyzeDraft(draft);
	const conversationBudget =
		config.contextMode === "recent" || profile.contextDemand === "expanded"
			? remainingBudget
			: Math.min(remainingBudget, AUTO_AMBIENT_SESSION_TOKENS);
	const conversationResult = buildConversationReference(
		entries,
		config.contextMode,
		conversationBudget,
		draft,
	);
	const conversation = conversationResult.reference;

	const toolCandidates = toolEvidenceCandidates(entries, draft);
	if (!workspace && !conversation) {
		return {
			toolCandidates,
			summary:
				conversationResult.reason === "budget-exhausted"
					? "draft only · context did not fit"
					: "draft only · no context available",
		};
	}

	const reference: OptimizationReference = {
		...(workspace ? { workspace } : {}),
		...(conversation ? { conversation } : {}),
		estimatedTokens:
			(workspace?.estimatedTokens ?? 0) + (conversation?.estimatedTokens ?? 0),
	};
	return {
		reference,
		toolCandidates,
		summary: contextSummary(reference, hasSessionEvidence),
	};
}
