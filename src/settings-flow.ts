import type {
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	findShortcutConflicts,
	normalizeShortcut,
	type OptimizerConfig,
} from "./config.ts";
import {
	type InvocationHandle,
	modelIsCurrentAvailable,
	optimizerModelPreference,
	showModelPicker,
	showNotice,
	showSettingsOverlay,
} from "./overlay.ts";
import type { OptimizerState } from "./state.ts";

async function persistOptimizerConfig(
	state: OptimizerState,
	next: OptimizerConfig,
	ctx: ExtensionContext,
	invocation?: InvocationHandle,
): Promise<boolean> {
	try {
		await state.persist(next);
		return true;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await showNotice(ctx, "Could not save settings", message, invocation);
		return false;
	}
}

export async function chooseOptimizerModel(
	ctx: ExtensionContext,
	state: OptimizerState,
	invocation?: InvocationHandle,
): Promise<boolean> {
	const result = await showModelPicker(ctx, state.config.model, invocation);
	if (!result) return false;
	if (!modelIsCurrentAvailable(result, ctx.model)) {
		await showNotice(
			ctx,
			"No current chat model",
			"Choose a pinned model instead.",
			invocation,
		);
		return false;
	}

	return persistOptimizerConfig(
		state,
		{ ...state.config, model: optimizerModelPreference(result) },
		ctx,
		invocation,
	);
}

export async function runOptimizerSettings(
	ctx: ExtensionCommandContext,
	state: OptimizerState,
	isDisposed: () => boolean,
): Promise<void> {
	while (!isDisposed()) {
		const result = await showSettingsOverlay(ctx, state.config);
		if (!result) return;
		if (!(await persistOptimizerConfig(state, result.config, ctx))) return;

		if (result.action === "close") return;
		if (result.action === "model") {
			await chooseOptimizerModel(ctx, state);
			continue;
		}

		const entered = await ctx.ui.input(
			"Optimizer shortcut",
			"Examples: ctrl+alt+p, f6, alt+p",
		);
		if (entered === undefined) continue;
		const shortcut = normalizeShortcut(entered);
		if (!shortcut) {
			await showNotice(
				ctx,
				"Invalid shortcut",
				"Use Pi's modifier+key format, for example ctrl+alt+p or f6.",
			);
			continue;
		}

		const conflicts = findShortcutConflicts(
			result.resolvedKeybindings,
			shortcut,
		);
		if (conflicts.length > 0) {
			await showNotice(
				ctx,
				"Shortcut already in use",
				`${shortcut} is bound to ${conflicts.join(", ")}. Choose an unclaimed shortcut.`,
			);
			continue;
		}

		if (shortcut === state.config.shortcut) return;
		if (
			!(await persistOptimizerConfig(state, { ...state.config, shortcut }, ctx))
		)
			return;
		await showNotice(
			ctx,
			"Shortcut saved",
			`Pi will reload now so ${shortcut} becomes active.`,
		);
		await ctx.reload();
		return;
	}
}
