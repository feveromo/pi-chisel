import { describe, expect, it } from "bun:test";
import { analyzeDraft } from "../src/draft-analysis.ts";

describe("draft analysis", () => {
	it("expands backward references, not every brief standalone request", () => {
		expect(analyzeDraft("What is a B-tree?")).toMatchObject({
			detail: "brief",
			contextDemand: "ambient",
			likelyReferential: false,
		});
		expect(
			analyzeDraft("Fix the previous version in the same style."),
		).toMatchObject({
			detail: "brief",
			contextDemand: "expanded",
			likelyReferential: true,
		});
	});

	it("uses only ambient history for a developed self-contained draft", () => {
		const draft = Array.from(
			{ length: 70 },
			(_, index) => `constraint-${index}`,
		).join(" ");
		expect(analyzeDraft(draft)).toMatchObject({
			detail: "developed",
			contextDemand: "ambient",
			likelyReferential: false,
			wordCount: 70,
		});
	});
});
