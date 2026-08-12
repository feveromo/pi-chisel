import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
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
			"Draft changed while Chisel was working",
			"Your editor has newer text. Chisel won't overwrite it without your say-so.",
			[
				{
					value: "replace",
					label: "Replace newer draft with chiseled version",
					description: "The newer text stays available for immediate undo",
					key: "r",
				},
				{
					value: "merge",
					label: "Open a merge editor",
					description: "Blend the newer and chiseled versions into one draft",
					key: "e",
				},
				{ value: "cancel", label: "Keep newer draft", key: "q" },
			],
			invocation,
			"keep newer",
		);
		if (choice === "cancel" || choice === undefined) return undefined;
		if (choice === "merge") {
			const merged = await ctx.ui.editor(
				"Merge drafts (newer first, chiseled second)",
				`${current}\n\n${optimized}`,
			);
			if (merged === undefined) return undefined;
			replacement = merged;
		}
	}

	if (replacement === current) {
		await showNotice(
			ctx,
			"Already in place",
			"The chiseled draft already matches your editor.",
			invocation,
		);
		return undefined;
	}

	const record = { before: current, after: replacement };
	ctx.ui.setEditorText(replacement);
	const undo = await showChoice(
		ctx,
		"Chiseled draft ready",
		"Still unsent. Submit normally when it looks right.",
		[
			{
				value: "keep",
				label: "Keep this draft",
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
				{ value: "cancel", label: "Keep newer input", key: "q" },
			],
			invocation,
			"keep newer input",
		);
		if (choice === "cancel" || choice === undefined) return false;
		if (choice === "merge") {
			const merged = await ctx.ui.editor(
				"Merge drafts (newer first, previous second)",
				`${current}\n\n${record.before}`,
			);
			if (merged === undefined) return false;
			restored = merged;
		}
	}

	ctx.ui.setEditorText(restored);
	await showNotice(
		ctx,
		"Previous draft restored",
		"You're back where you started. Nothing was submitted.",
		invocation,
	);
	return true;
}
