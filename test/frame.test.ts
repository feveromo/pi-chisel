import { describe, expect, it } from "bun:test";
import { sanitizeForDisplay, sanitizeInline } from "../src/ui/frame.ts";

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
