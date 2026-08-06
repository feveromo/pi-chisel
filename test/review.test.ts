import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", () => ({
	rawKeyHint: (key: string, label: string) => `${key} ${label}`,
}));

import { PromptReviewComponent } from "../src/ui/review.ts";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

function createReview(original: string, optimized: string) {
	const requestRender = vi.fn();
	const onAction = vi.fn();
	const component = new PromptReviewComponent(
		{ requestRender } as unknown as TUI,
		theme,
		{
			original,
			optimized,
			initialView: "optimized",
			modelRef: "test/model",
			contextSummary: "workspace + fresh session · ~320 context tokens",
			onAction,
		},
	);
	return { component, requestRender, onAction };
}

function rendered(component: PromptReviewComponent, width = 52): string {
	return component.render(width).join("\n");
}

describe("prompt review", () => {
	it("keeps safety and every action discoverable at the minimum width", () => {
		const { component } = createReview("old", "new");
		const output = rendered(component);

		expect(output).toContain("Fresh off the Chisel");
		expect(output).toContain("Model: test/model");
		expect(output).toContain("Grounded in: workspace + fresh session");
		expect(output).toContain("Still unsent · Enter replaces your draft");
		expect(output).toContain("nothing gets submitted");
		expect(output).toContain("CHISELED");
		expect(output).toContain("use this");
		expect(output).toContain("tune it");
		expect(output).toContain("compare");
		expect(output).toContain("another pass");
		expect(output).toContain("switch model");
		expect(output).toContain("keep original");
		expect(output).not.toContain("Prompt Review");
		expect(output).not.toContain("OPTIMIZED");
	});

	it("cycles through diff and original views without losing keyboard actions", () => {
		const { component, requestRender, onAction } = createReview(
			"Keep the old wording.",
			"Preserve the clearer wording.",
		);

		component.handleInput("\t");
		const diff = rendered(component, 82);
		expect(diff).toContain("CHANGES");
		expect(diff).toContain("--- original");
		expect(diff).toContain("+++ chiseled");

		component.handleInput("\t");
		expect(rendered(component, 82)).toContain("ORIGINAL");
		component.handleInput("\r");
		expect(onAction).toHaveBeenCalledWith("accept");
		expect(requestRender).toHaveBeenCalled();
	});

	it("exposes and scrolls every row of a long review", () => {
		const optimized = Array.from(
			{ length: 30 },
			(_, index) => `optimized line ${index + 1}`,
		).join("\n");
		const { component } = createReview("old", optimized);

		expect(rendered(component, 82)).toContain("Rows 1–11 of 30");
		component.handleInput("\x1b[6~");
		expect(rendered(component, 82)).toContain("Rows 12–22 of 30");
		component.handleInput("\x1b[F");
		expect(rendered(component, 82)).toContain("Rows 20–30 of 30");
	});
});
