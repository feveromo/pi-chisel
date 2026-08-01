import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isSafeToRestore } from "./editor-safety.ts";
import { type InvocationHandle, showChoice, showNotice } from "./overlay.ts";

export interface ReplacementRecord {
	before: string;
	after: string;
}

export async function acceptReplacement(
	ctx: ExtensionContext,
	invocation: InvocationHandle,
	capturedDraft: string,
	optimized: string,
): Promise<ReplacementRecord | undefined> {
	const current = ctx.ui.getEditorText();
	let replacement = optimized;

	if (current !== capturedDraft) {
		const choice = await showChoice(
			ctx,
			"Draft changed while polishing",
			"Pi will not overwrite the newer editor contents without your explicit choice.",
			[
				{
					value: "replace",
					label: "Replace the newer draft",
					description: "The newer text remains available for immediate undo",
					key: "r",
				},
				{
					value: "merge",
					label: "Open a merge editor",
					description: "Edit the newer and optimized versions into one prompt",
					key: "e",
				},
				{ value: "cancel", label: "Cancel and keep the newer draft", key: "q" },
			],
			invocation,
		);
		if (choice === "cancel" || choice === undefined) return undefined;
		if (choice === "merge") {
			const merged = await ctx.ui.editor(
				"Merge into one prompt (newer draft first, optimized alternative second)",
				`${current}\n\n${optimized}`,
			);
			if (merged === undefined) return undefined;
			replacement = merged;
		}
	}

	if (replacement === current) {
		await showNotice(
			ctx,
			"No replacement needed",
			"The reviewed prompt already matches the editor.",
			invocation,
		);
		return undefined;
	}

	const record = { before: current, after: replacement };
	ctx.ui.setEditorText(replacement);
	const undo = await showChoice(
		ctx,
		"Prompt replaced",
		"The optimized prompt is still only a draft. Submit it normally when ready.",
		[
			{
				value: "keep",
				label: "Continue with optimized draft",
				key: "enter",
			},
			{ value: "restore", label: "Restore previous draft", key: "u" },
		],
		invocation,
		"close",
	);
	if (undo !== "restore") return record;

	const restored = await restoreReplacement(ctx, record, invocation);
	return restored ? undefined : record;
}

export async function restoreReplacement(
	ctx: ExtensionContext,
	record: ReplacementRecord,
	invocation?: InvocationHandle,
): Promise<boolean> {
	const current = ctx.ui.getEditorText();
	let restored = record.before;

	if (!isSafeToRestore(current, record.after)) {
		const choice = await showChoice(
			ctx,
			"Draft changed after replacement",
			"Restoring blindly would overwrite newer input, so choose how to proceed.",
			[
				{
					value: "replace",
					label: "Replace newer input with the previous draft",
					key: "r",
				},
				{ value: "merge", label: "Open a merge editor", key: "e" },
				{ value: "cancel", label: "Cancel", key: "q" },
			],
			invocation,
		);
		if (choice === "cancel" || choice === undefined) return false;
		if (choice === "merge") {
			const merged = await ctx.ui.editor(
				"Merge into one prompt (newer input first, previous draft second)",
				`${current}\n\n${record.before}`,
			);
			if (merged === undefined) return false;
			restored = merged;
		}
	}

	ctx.ui.setEditorText(restored);
	await showNotice(
		ctx,
		"Draft restored",
		"Nothing was submitted to the conversation.",
		invocation,
	);
	return true;
}
