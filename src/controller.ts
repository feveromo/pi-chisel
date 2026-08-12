import type {
	ExtensionCommandContext,
	ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";
import type { OptimizerConfig, OptimizerConfigStore } from "./config.ts";
import { type InvocationHandle, showNotice } from "./overlay.ts";
import { type ReplacementRecord, restoreReplacement } from "./replacement.ts";
import { chooseOptimizerModel, runOptimizerSettings } from "./settings-flow.ts";
import { OptimizerState } from "./state.ts";
import { runOptimizationWorkflow } from "./workflow.ts";

export class PromptOptimizerController {
	private readonly state: OptimizerState;
	private active: InvocationHandle | undefined;
	private nextInvocationId = 1;
	private disposed = false;
	private lastReplacement: ReplacementRecord | undefined;

	constructor(
		store: OptimizerConfigStore,
		config: OptimizerConfig,
		warning?: string,
	) {
		this.state = new OptimizerState(store, config, warning);
	}

	async optimize(ctx: ExtensionContext, explicitDraft?: string): Promise<void> {
		if (!ctx.hasUI) {
			ctx.ui.notify("OMP Chisel needs OMP's interactive TUI.", "error");
			return;
		}
		if (this.active) {
			ctx.ui.notify(
				"OMP Chisel is already at work; finish or close that pass first.",
				"warning",
			);
			return;
		}

		const draft = explicitDraft ?? ctx.ui.getEditorText();
		if (explicitDraft !== undefined) ctx.ui.setEditorText(explicitDraft);
		if (!draft.trim()) {
			await showNotice(
				ctx,
				"Nothing to chisel",
				"Drop a draft in the editor, then press your Chisel shortcut.",
			);
			return;
		}

		const invocation: InvocationHandle = {
			id: this.nextInvocationId++,
			requestController: undefined,
			dismiss: undefined,
		};
		this.active = invocation;
		try {
			const replacement = await runOptimizationWorkflow({
				ctx,
				invocation,
				state: this.state,
				capturedDraft: draft,
				isActive: () => !this.disposed && this.active?.id === invocation.id,
				chooseModel: () => chooseOptimizerModel(ctx, this.state, invocation),
			});
			if (replacement) this.lastReplacement = replacement;
		} finally {
			if (this.active?.id === invocation.id) this.active = undefined;
		}
	}

	async chooseModel(ctx: ExtensionContext): Promise<void> {
		if (!this.canOpenStandaloneUi(ctx, "model picker")) return;
		await chooseOptimizerModel(ctx, this.state);
	}

	async showSettings(ctx: ExtensionCommandContext): Promise<void> {
		if (!this.canOpenStandaloneUi(ctx, "settings")) return;
		await runOptimizerSettings(ctx, this.state, () => this.disposed);
	}

	async restore(ctx: ExtensionContext): Promise<void> {
		if (!this.canOpenStandaloneUi(ctx, "draft restoration")) return;
		if (!this.lastReplacement) {
			await showNotice(
				ctx,
				"Nothing to restore",
				"Chisel has no previous draft to restore in this session.",
			);
			return;
		}
		if (await restoreReplacement(ctx, this.lastReplacement))
			this.lastReplacement = undefined;
	}

	dispose(): void {
		this.disposed = true;
		this.active?.requestController?.abort();
		this.active?.dismiss?.();
		this.active = undefined;
	}

	private canOpenStandaloneUi(ctx: ExtensionContext, feature: string): boolean {
		if (!ctx.hasUI) {
			ctx.ui.notify(
				`OMP Chisel's ${feature} needs OMP's interactive TUI.`,
				"error",
			);
			return false;
		}
		if (this.active) {
			ctx.ui.notify(
				`Finish or close the active Chisel pass before opening ${feature}.`,
				"warning",
			);
			return false;
		}
		return true;
	}
}
