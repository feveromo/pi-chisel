import type { Api, Model } from "@oh-my-pi/pi-ai";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { OptimizerConfig } from "./config.ts";
import {
	buildConversationReference,
	extractVisibleContextItems,
} from "./context-builder.ts";
import { analyzeDraft } from "./draft-analysis.ts";
import { calculateContextBudgetForModel } from "./model-selection.ts";
import { buildWorkspaceReference } from "./project-context.ts";
import {
	buildOptimizationRequest,
	calculateMaxOutputTokens,
	estimateTextTokens,
	type OptimizationReference,
} from "./request-builder.ts";

export interface OptimizationGrounding {
	reference?: OptimizationReference;
	summary: string;
}

type GroundingExtensionContext = Pick<
	ExtensionContext,
	"cwd" | "getSystemPrompt" | "sessionManager"
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

export async function buildOptimizationGrounding(
	ctx: GroundingExtensionContext,
	config: OptimizerConfig,
	draft: string,
	model: Model<Api>,
): Promise<OptimizationGrounding> {
	if (config.contextMode === "none") return { summary: "context disabled" };

	const draftTokens = estimateTextTokens(draft);
	const outputTokens = calculateMaxOutputTokens(
		draft,
		model.maxTokens,
		Boolean(model.reasoning),
	);
	const withoutReference = buildOptimizationRequest(
		draft,
		undefined,
		config.intensity,
	);
	const framingTokens = Math.max(
		0,
		withoutReference.estimatedInputTokens - draftTokens,
	);
	const totalBudget = calculateContextBudgetForModel(
		model,
		draftTokens,
		config.contextTokenBudget,
		outputTokens,
		framingTokens + REFERENCE_WRAPPER_RESERVE_TOKENS,
	);
	if (totalBudget <= 0)
		return { summary: "draft only · context window is full" };

	const entries = ctx.sessionManager.getBranch();
	const hasSessionEvidence = extractVisibleContextItems(entries).length > 0;
	const workspaceLimit = hasSessionEvidence
		? Math.min(
				totalBudget,
				Math.max(
					256,
					Math.min(
						MAX_WORKSPACE_TOKENS_WITH_SESSION,
						Math.floor(totalBudget * 0.4),
					),
				),
			)
		: Math.min(totalBudget, MAX_WORKSPACE_TOKENS_FRESH_SESSION);

	let systemPrompt = "";
	try {
		systemPrompt = ctx.getSystemPrompt().join("\n\n");
	} catch {
		// Workspace extraction still works if the runtime prompt is unavailable.
	}
	const workspace = await buildWorkspaceReference({
		cwd: ctx.cwd,
		systemPrompt,
		trusted: true,
		tokenBudget: workspaceLimit,
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
	);
	const conversation = conversationResult.reference;

	if (!workspace && !conversation) {
		return {
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
		summary: contextSummary(reference, hasSessionEvidence),
	};
}
