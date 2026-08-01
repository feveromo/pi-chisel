import type { OptimizerConfig, OptimizerConfigStore } from "./config.ts";

export class OptimizerState {
	config: OptimizerConfig;
	warning: string | undefined;

	constructor(
		private readonly store: OptimizerConfigStore,
		config: OptimizerConfig,
		warning?: string,
	) {
		this.config = config;
		this.warning = warning;
	}

	async persist(next: OptimizerConfig): Promise<void> {
		await this.store.save(next);
		this.config = next;
		this.warning = undefined;
	}
}
