import { describe, expect, it } from "bun:test";
import { isSafeToRestore, planSafeReplacement } from "../src/editor-safety.ts";

describe("editor safety", () => {
	it("replaces only an unchanged captured draft automatically", () => {
		expect(planSafeReplacement("draft", "draft", "better")).toEqual({
			kind: "replace",
			text: "better",
		});
		expect(planSafeReplacement("newer", "draft", "better")).toEqual({
			kind: "merge",
			prefill: "newer\n\nbetter",
		});
	});

	it("restores only when the accepted replacement still matches", () => {
		expect(isSafeToRestore("better", "better")).toBe(true);
		expect(isSafeToRestore("better plus my edit", "better")).toBe(false);
	});
});
