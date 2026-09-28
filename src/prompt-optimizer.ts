import { OptimizerConfigStore } from "./config.ts";
import { PromptOptimizerController } from "./controller.ts";
import type { ExtensionAPI } from "./host.ts";

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

	pi.registerCommand("chisel", {
		description:
			"Chisel a draft without submitting it (usage: /chisel <draft>)",
		handler: async (args, ctx) => controller.optimize(ctx, args || ""),
	});

	pi.registerCommand("chisel-context", {
		description:
			"Inspect context before sending a draft (usage: /chisel-context <draft>)",
		handler: async (args, ctx) => controller.optimize(ctx, args || "", true),
	});

	pi.registerCommand("chisel-model", {
		description: "Choose and persist Pi Chisel's independent model",
		handler: async (_args, ctx) => controller.chooseModel(ctx),
	});

	pi.registerCommand("chisel-settings", {
		description:
			"Configure Pi Chisel's grounding, intensity, shortcut, and preview",
		handler: async (_args, ctx) => controller.showSettings(ctx),
	});

	pi.registerCommand("chisel-restore", {
		description: "Restore the draft Pi Chisel most recently replaced",
		handler: async (_args, ctx) => controller.restore(ctx),
	});

	pi.on("session_shutdown", () => {
		controller.dispose();
	});
}
