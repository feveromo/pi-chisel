import { describe, expect, it } from "vitest";
import examples from "../docs/editorial-cases.json" with { type: "json" };
import { textBlocks } from "../src/context-builder.ts";
import { buildOptimizationRequest } from "../src/request-builder.ts";

// These are executable request/literal contracts, NOT scores for live model quality.
// Human review of real rewrites uses the good/bad contrasts and rubric in docs/editorial-quality.md.
describe("editorial examples", () => {
	for (const example of examples) {
		it(`${example.id}: preserves exact draft at every intensity`, () => {
			for (const intensity of ["light", "standard", "strong"] as const) {
				const request = buildOptimizationRequest(
					example.draft,
					undefined,
					intensity,
				);
				const text = textBlocks(request.context.messages[0]?.content).join(
					"\n",
				);
				expect(text?.endsWith(`${example.draft}\nCURRENT_DRAFT>>>`)).toBe(true);
			}
			for (const literal of example.literals ?? []) {
				expect(example.draft).toContain(literal);
				expect(example.good).toContain(literal);
			}
			expect(example.good).not.toBe(example.bad);
		});
	}
});
