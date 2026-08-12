import type { Api, Model } from "@oh-my-pi/pi-ai";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { OptimizerModelPreference } from "./config.ts";

export interface ResolvedOptimizerModel {
	model: Model<Api>;
	source: "current" | "pinned" | "fallback";
	warning?: string;
}

export function modelReference(
	model: Pick<Model<Api>, "provider" | "id">,
): string {
	return `${model.provider}/${model.id}`;
}

function sameModel(
	model: Model<Api>,
	preference: OptimizerModelPreference,
): boolean {
	return model.provider === preference.provider && model.id === preference.id;
}

export function resolveOptimizerModel(
	preference: OptimizerModelPreference | null,
	ctx: Pick<ExtensionContext, "model" | "modelRegistry">,
): ResolvedOptimizerModel | undefined {
	const available = ctx.modelRegistry.getAvailable();

	if (preference) {
		const configured = available.find((model) => sameModel(model, preference));
		if (configured) return { model: configured, source: "pinned" };

		if (ctx.model) {
			const configuredExists =
				ctx.modelRegistry.find(preference.provider, preference.id) !==
				undefined;
			return {
				model: ctx.model,
				source: "fallback",
				warning: configuredExists
					? `${preference.provider}/${preference.id} is not currently authenticated or available. Using ${modelReference(ctx.model)} for this pass; Chisel's pin stays put.`
					: `${preference.provider}/${preference.id} is no longer in OMP's model registry. Using ${modelReference(ctx.model)} for this pass; pick another model for Chisel.`,
			};
		}

		return undefined;
	}

	return ctx.model ? { model: ctx.model, source: "current" } : undefined;
}

export function calculateContextBudgetForModel(
	model: Model<Api>,
	draftTokens: number,
	configuredBudget: number,
	outputTokens: number,
	instructionAndFramingTokens: number,
): number {
	const contextWindow = model.contextWindow;
	if (contextWindow === null) return configuredBudget;
	const providerSafetyMargin = 4096;
	const available =
		contextWindow -
		draftTokens -
		outputTokens -
		instructionAndFramingTokens -
		providerSafetyMargin;
	return Math.max(0, Math.min(configuredBudget, available));
}
