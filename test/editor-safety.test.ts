import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { isSafeToRestore, planSafeReplacement } from "../src/editor-safety.ts";
import { acceptReplacement, restoreReplacement } from "../src/replacement.ts";

describe("editor safety", () => {
	for (const operation of ["replace", "restore"])
		for (const interruption of ["new input", "shutdown"])
			it(`protects ${interruption} during ${operation} confirmation`, async () => {
				let editor = "newer draft";
				let active = true;
				const writes: string[] = [];
				const ctx = {
					ui: {
						getEditorText: () => editor,
						setEditorText: (text: string) => writes.push(text),
						custom: async () => {
							if (interruption === "shutdown") active = false;
							else editor = "even newer input";
							return "replace";
						},
					},
				} as unknown as ExtensionContext;
				const invocation = {
					id: 1,
					dismiss: undefined,
					requestController: undefined,
				};
				if (operation === "replace")
					await acceptReplacement(
						ctx,
						invocation,
						"draft",
						"better",
						() => active,
					);
				else
					await restoreReplacement(
						ctx,
						{ before: "draft", after: "better" },
						invocation,
						() => active,
					);
				expect(writes).toEqual([]);
			});
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
