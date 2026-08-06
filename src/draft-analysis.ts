export type DraftDetail = "brief" | "developed";
export type DraftContextDemand = "expanded" | "ambient";

export interface DraftProfile {
	detail: DraftDetail;
	contextDemand: DraftContextDemand;
	likelyReferential: boolean;
	wordCount: number;
}

const REFERENTIAL_PATTERNS = [
	/\b(?:again|previous|prior|earlier|above|last time|same (?:style|format|approach|way)|as before)\b/i,
	/\b(?:do|fix|change|rewrite|improve|continue|finish|repeat|restore|revert|use)\s+(?:it|that|this|those|them)\b/i,
	/\b(?:that|this|it|those|these)\s+(?:one|version|draft|result|answer|response|implementation|plan|style)\b/i,
	/\b(?:the previous|the last|what you|you just|we discussed|we decided)\b/i,
];

const BRIEF_DRAFT_MAX_WORDS = 40;
const BRIEF_DRAFT_MAX_CHARACTERS = 320;

export function analyzeDraft(draft: string): DraftProfile {
	const normalized = draft.trim();
	const wordCount = normalized ? normalized.split(/\s+/u).length : 0;
	const likelyReferential = REFERENTIAL_PATTERNS.some((pattern) =>
		pattern.test(normalized),
	);
	const detail =
		wordCount <= BRIEF_DRAFT_MAX_WORDS ||
		normalized.length <= BRIEF_DRAFT_MAX_CHARACTERS
			? "brief"
			: "developed";

	return {
		detail,
		contextDemand:
			likelyReferential || detail === "brief" ? "expanded" : "ambient",
		likelyReferential,
		wordCount,
	};
}
