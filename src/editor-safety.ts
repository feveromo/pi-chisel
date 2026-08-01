export type ReplacementDecision =
	| { kind: "replace"; text: string }
	| { kind: "merge"; prefill: string }
	| { kind: "cancel" };

export function planSafeReplacement(
	current: string,
	captured: string,
	optimized: string,
): ReplacementDecision {
	if (current === captured) return { kind: "replace", text: optimized };
	return {
		kind: "merge",
		prefill: `${current}\n\n${optimized}`,
	};
}

export function isSafeToRestore(current: string, replacement: string): boolean {
	return current === replacement;
}
