import { afterEach, describe, expect, it, mock } from "bun:test";
import type { Theme } from "@oh-my-pi/pi-coding-agent";
import {
	getKeybindings,
	KeybindingsManager,
	setKeybindings,
	type TUI,
	TUI_KEYBINDINGS,
} from "@oh-my-pi/pi-tui";

import { PromptReviewComponent } from "../src/ui/review.ts";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

function createReview(original: string, optimized: string) {
	const requestRender = mock();
	const onAction = mock();
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

const defaultKeybindings = getKeybindings();
afterEach(() => setKeybindings(defaultKeybindings));

describe("prompt review", () => {
	it("follows remapped host selection keys and shows them in hints", () => {
		setKeybindings(
			new KeybindingsManager(TUI_KEYBINDINGS, {
				"tui.select.cancel": "ctrl+g",
				"tui.select.confirm": "ctrl+o",
			}),
		);
		const { component, onAction } = createReview("old", "new");
		const output = rendered(component, 82);
		expect(output).toContain("ctrl+o use this");
		expect(output).toContain("ctrl+g keep original");

		component.handleInput("\x1b");
		expect(onAction).not.toHaveBeenCalled();
		component.handleInput("\x07");
		expect(onAction).toHaveBeenCalledWith("cancel");
		component.handleInput("\x0f");
		expect(onAction).toHaveBeenCalledWith("accept");
	});

	it("keeps safety and every action discoverable at the minimum width", () => {
		const { component } = createReview("old", "new");
		const output = rendered(component);

		expect(output).toContain("Fresh off the Chisel");
		expect(output).toContain("Model: test/model");
		expect(output).toContain("Context supplied: workspace + fresh session");
		expect(output).toContain("Still unsent · Enter replaces your draft");
		expect(output).toContain("nothing gets submitted");
		expect(output).toContain("CHISELED");
		expect(output).toContain("use this");
		expect(output).toContain("tune it");
		expect(output).toContain("tab switch view");
		expect(output).toContain("another pass");
		expect(output).toContain("switch model");
		expect(output).toContain("keep original");
		expect(output.split("\n")[0]).toMatch(/^╭─ ✦ Fresh off the Chisel ─+╮$/);
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
		expect(diff).toContain("chiseled   CHANGES   original");
		expect(diff).toContain("--- original");
		expect(diff).toContain("+++ chiseled");

		component.handleInput("\t");
		expect(rendered(component, 82)).toContain("chiseled   changes   ORIGINAL");
		component.handleInput("\r");
		expect(onAction).toHaveBeenCalledWith("accept");
		expect(requestRender).toHaveBeenCalled();
	});

	it("focuses distant changes, navigates both directions, and exposes context/previous actions", () => {
		const middle = "Unchanged context. ".repeat(40);
		const { component, onAction } = createReview(
			`Old first. ${middle} Old last.`,
			`New first. ${middle} New last.`,
		);
		component.handleInput("d");
		expect(rendered(component, 82)).toContain("Change 1/2");
		expect(rendered(component, 82)).not.toContain(
			"Unchanged context. ".repeat(10),
		);
		component.handleInput("n");
		expect(rendered(component, 82)).toContain("Change 2/2");
		component.handleInput("p");
		expect(rendered(component, 82)).toContain("Change 1/2");
		component.handleInput("c");
		expect(onAction).toHaveBeenCalledWith("context");
	});

	it("exposes and scrolls every row of a long review", () => {
		const optimized = Array.from(
			{ length: 30 },
			(_, index) => `optimized line ${index + 1}`,
		).join("\n");
		const { component } = createReview("old", optimized);

		// The scroll position sits in the bottom border.
		const bottom = () => component.render(82).at(-1) ?? "";
		expect(bottom()).toMatch(/^╰─+ rows 1–13 of 30 · ↑↓ PgUp\/PgDn ─╯$/);
		component.handleInput("\x1b[6~");
		expect(bottom()).toContain("rows 14–26 of 30");
		component.handleInput("\x1b[F");
		expect(bottom()).toContain("rows 18–30 of 30");
	});
});
