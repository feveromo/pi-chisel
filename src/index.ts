import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
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
		description: "Chisel the current unsent draft",
		handler: async (ctx) => controller.optimize(ctx),
	});

	pi.registerCommand("prompt-optimize", {
		description:
			"Chisel a draft without submitting it (usage: /prompt-optimize <draft>)",
		handler: async (args, ctx) => {
			if (!args) {
				await controller.optimize(ctx, "");
				return;
			}
			await controller.optimize(ctx, args);
		},
	});

	pi.registerCommand("prompt-optimize-model", {
		description: "Choose and persist Pi Chisel's independent model",
		handler: async (_args, ctx) => controller.chooseModel(ctx),
	});

	pi.registerCommand("prompt-optimize-settings", {
		description:
			"Configure Pi Chisel's grounding, intensity, shortcut, and preview",
		handler: async (_args, ctx) => controller.showSettings(ctx),
	});

	pi.registerCommand("prompt-optimize-restore", {
		description: "Restore the draft Pi Chisel most recently replaced",
		handler: async (_args, ctx) => controller.restore(ctx),
	});

	pi.on("session_shutdown", () => {
		controller.dispose();
	});
}
