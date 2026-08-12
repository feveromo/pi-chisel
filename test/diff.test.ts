import { describe, expect, it } from "bun:test";
import {
	createPromptDiff,
	reconstructAfter,
	reconstructBefore,
} from "../src/ui/diff.ts";
import { clampViewportOffset, sliceViewport } from "../src/ui/viewport.ts";

describe("prompt diff", () => {
	it("reconstructs both prompts while identifying bounded changes", () => {
		const before = "Fix this rough prompt and keep /tmp/a exactly.";
		const after = "Clarify this prompt while preserving /tmp/a exactly.";
		const diff = createPromptDiff(before, after);

		expect(reconstructBefore(diff)).toBe(before);
		expect(reconstructAfter(diff)).toBe(after);
		expect(diff.coarse).toBe(false);
		expect(diff.addedCharacters).toBeGreaterThan(0);
		expect(diff.removedCharacters).toBeGreaterThan(0);
		expect(diff.parts.some((part) => part.kind === "equal")).toBe(true);
	});

	it("preserves whitespace, line breaks, emoji, and punctuation", () => {
		const before = "one\n\n  two 🔧\nthree";
		const after = "one\n\n  better two 🔧\nthree!";
		const diff = createPromptDiff(before, after);

		expect(reconstructBefore(diff)).toBe(before);
		expect(reconstructAfter(diff)).toBe(after);
	});

	it("handles an empty side without allocating a quadratic matrix", () => {
		const diff = createPromptDiff("", "new prompt");

		expect(diff.coarse).toBe(false);
		expect(reconstructBefore(diff)).toBe("");
		expect(reconstructAfter(diff)).toBe("new prompt");
	});

	it("falls back to a coarse comparison before quadratic work grows large", () => {
		const before = Array.from(
			{ length: 80 },
			(_, index) => `old-${index}`,
		).join(" ");
		const after = Array.from({ length: 80 }, (_, index) => `new-${index}`).join(
			" ",
		);
		const diff = createPromptDiff(before, after, 100);

		expect(diff.coarse).toBe(true);
		expect(reconstructBefore(diff)).toBe(before);
		expect(reconstructAfter(diff)).toBe(after);
	});
});

describe("review viewport", () => {
	const rows = Array.from({ length: 20 }, (_, index) => `row-${index + 1}`);

	it("clamps scrolling and returns a stable visible window", () => {
		expect(clampViewportOffset(-5, rows.length, 5)).toBe(0);
		expect(clampViewportOffset(99, rows.length, 5)).toBe(15);
		expect(sliceViewport(rows, 8, 5)).toMatchObject({
			offset: 8,
			total: 20,
			hasOverflow: true,
			items: ["row-9", "row-10", "row-11", "row-12", "row-13"],
		});
	});
});
