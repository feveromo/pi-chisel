import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { OptimizerConfigStore } from "./config.ts";
import { PromptOptimizerController } from "./controller.ts";

export default async function promptOptimizerExtension(
	pi: ExtensionAPI,
): Promise<void> {
	const store = new OptimizerConfigStore();
	const loaded = await store.load();
	const controller = new PromptOptimizerController(
		store,
		loaded.config,
		loaded.warning,
	);

	pi.registerShortcut(loaded.config.shortcut, {
		description: "Polish the current unsent prompt",
		handler: async (ctx) => controller.optimize(ctx),
	});

	pi.registerCommand("prompt-optimize", {
		description:
			"Polish a draft without submitting it (usage: /prompt-optimize <draft>)",
		handler: async (args, ctx) => {
			if (!args) {
				await controller.optimize(ctx, "");
				return;
			}
			await controller.optimize(ctx, args);
		},
	});

	pi.registerCommand("prompt-optimize-model", {
		description: "Choose and persist an independent prompt optimizer model",
		handler: async (_args, ctx) => controller.chooseModel(ctx),
	});

	pi.registerCommand("prompt-optimize-settings", {
		description:
			"Configure prompt optimizer context, intensity, shortcut, and preview",
		handler: async (_args, ctx) => controller.showSettings(ctx),
	});

	pi.registerCommand("prompt-optimize-restore", {
		description:
			"Restore the draft most recently replaced by the prompt optimizer",
		handler: async (_args, ctx) => controller.restore(ctx),
	});

	pi.on("session_shutdown", () => {
		controller.dispose();
	});
}
