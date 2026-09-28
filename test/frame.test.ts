import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
	overlayFrame,
	sanitizeForDisplay,
	sanitizeInline,
} from "../src/ui/frame.ts";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

describe("terminal display sanitization", () => {
	it("neutralizes terminal control sequences while preserving prompt line breaks", () => {
		expect(sanitizeForDisplay("a\tb\nc\r\u0000\u001b\u009b")).toBe(
			"a    b\nc\r�␛�",
		);
	});

	it("flattens dynamic labels to one safe line", () => {
		expect(sanitizeInline("provider\r\nmodel\u001b[31m")).toBe(
			"provider model␛[31m",
		);
	});
});

describe("overlay frame", () => {
	it("sets the title and status into the border without changing its width", () => {
		const lines = overlayFrame(theme, 40, ["body"], true, {
			title: "✦ Chisel · review",
			status: "rows 1–3 of 9",
		});
		expect(lines[0]).toMatch(/^╭─ ✦ Chisel · review ─+╮$/);
		expect(lines.at(-1)).toMatch(/^╰─+ rows 1–3 of 9 ─╯$/);
		for (const line of lines) expect(visibleWidth(line)).toBe(40);
	});

	it("truncates labels that do not fit and keeps plain edges without them", () => {
		const [top, , bottom] = overlayFrame(theme, 16, ["body"], true, {
			title: "Draft changed while Chisel was working",
		});
		expect(top).toContain("…");
		expect(visibleWidth(top ?? "")).toBe(16);
		expect(bottom).toBe(`╰${"─".repeat(14)}╯`);
	});
});
