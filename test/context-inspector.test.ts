import { describe, expect, it } from "bun:test";
import type { Theme } from "@oh-my-pi/pi-coding-agent";
import type { TUI } from "@oh-my-pi/pi-tui";
import type { ContextSource } from "../src/request-builder.ts";
import { ContextInspector } from "../src/ui/context.ts";

const theme = {
	fg: (_: string, text: string) => text,
	bold: (s: string) => s,
} as unknown as Theme;
const sources: ContextSource[] = [
	{
		id: "user",
		kind: "user",
		label: "USER",
		text: "Keep my voice.\nNo implementation.",
		truncated: false,
	},
	{
		id: "tool",
		kind: "tool",
		label: "bash · npm test",
		text: `FAIL auth.test.ts\n${"line\n".repeat(30)}`,
		truncated: true,
	},
];
function inspector(budget = 512) {
	let result: ContextSource[] | undefined;
	const component = new ContextInspector(
		{ requestRender() {}, terminal: { rows: 42 } } as unknown as TUI,
		theme,
		{
			sources,
			selected: sources.slice(0, 1),
			budget,
			modelRef: "test/model",
			beforeFirstSend: true,
			onDone: (value) => {
				result = value;
			},
		},
	);
	return { component, result: () => result };
}
describe("context inspector", () => {
	it("starts tools unchecked, previews bounded text, and requires explicit inclusion", () => {
		const { component, result } = inspector();
		expect(component.render(52).join("\n")).toContain("Nothing sent yet");
		component.handleInput("t");
		expect(component.render(82).join("\n")).toContain("FAIL auth.test.ts");
		component.handleInput(" ");
		component.handleInput("\r");
		expect(result()).toEqual(sources);
	});
	it("does not mutate selection on escape or silently evict intent to fit a tool", () => {
		const { component, result } = inspector(30);
		component.handleInput("t");
		component.handleInput(" ");
		expect(component.render(82).join("\n")).toContain("Not enough room");
		component.handleInput("\r");
		expect(result()).toEqual(sources.slice(0, 1));
		const cancelled = inspector();
		cancelled.component.handleInput("0");
		cancelled.component.handleInput("\x1b");
		expect(cancelled.result()).toBeUndefined();
		expect(sources[0]?.text).toBe("Keep my voice.\nNo implementation.");
	});
	it("scrolls the complete excerpt and clears every source with draft-only", () => {
		const { component, result } = inspector();
		component.handleInput("t");
		component.handleInput("\x1b[F");
		expect(component.render(82).join("\n")).toContain("/32");
		component.handleInput("0");
		component.handleInput("\r");
		expect(result()).toEqual([]);
	});
});
