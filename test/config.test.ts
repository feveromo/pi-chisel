import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	DEFAULT_OPTIMIZER_CONFIG,
	findShortcutConflicts,
	normalizeShortcut,
	OptimizerConfigStore,
	parseOptimizerConfig,
} from "../src/config.ts";

const temporaryDirectories: string[] = [];
afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("optimizer config", () => {
	it("uses compact defaults for a missing or empty config", () => {
		expect(parseOptimizerConfig({}).config).toEqual(DEFAULT_OPTIMIZER_CONFIG);
	});

	it("accepts valid settings and rejects unsafe values independently", () => {
		const parsed = parseOptimizerConfig({
			model: { provider: "openai-codex", id: "gpt-5.6-sol" },
			contextMode: "recent",
			contextTokenBudget: 4096,
			intensity: "strong",
			shortcut: "CTRL+SHIFT+K",
			previewMode: "original",
		});

		expect(parsed.warning).toBeUndefined();
		expect(parsed.config).toMatchObject({
			model: { provider: "openai-codex", id: "gpt-5.6-sol" },
			contextMode: "recent",
			contextTokenBudget: 4096,
			intensity: "strong",
			shortcut: "ctrl+shift+k",
			previewMode: "original",
		});

		const invalid = parseOptimizerConfig({
			contextTokenBudget: -1,
			shortcut: "ctrl+made-up",
		});
		expect(invalid.config.contextTokenBudget).toBe(
			DEFAULT_OPTIMIZER_CONFIG.contextTokenBudget,
		);
		expect(invalid.config.shortcut).toBe("ctrl+shift+k");
		expect(invalid.warning).toContain("contextTokenBudget");
		expect(invalid.warning).toContain("shortcut");
	});

	it("normalizes Pi key names and modifier order for conflict checks", () => {
		expect(normalizeShortcut(" shift + ctrl + p ")).toBe("shift+ctrl+p");
		expect(normalizeShortcut("PageUp")).toBe("pageUp");
		expect(normalizeShortcut("super + o")).toBe("super+o");
		expect(normalizeShortcut("ctrl + +")).toBe("ctrl++");
		expect(normalizeShortcut("ctrl+wat")).toBeUndefined();
		expect(
			findShortcutConflicts(
				{
					"app.model.cycleBackward": "shift+ctrl+p",
					"app.model.select": "ctrl+l",
				},
				"ctrl+shift+p",
			),
		).toEqual(["app.model.cycleBackward"]);
	});

	it("writes settings atomically with private permissions", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-chisel-config-"));
		temporaryDirectories.push(directory);
		const path = join(directory, "nested", "prompt-optimizer.json");
		const store = new OptimizerConfigStore(path);
		const config = { ...DEFAULT_OPTIMIZER_CONFIG, intensity: "light" as const };

		await store.save(config);

		expect(JSON.parse(await readFile(path, "utf8"))).toEqual(config);
		expect((await stat(path)).mode & 0o777).toBe(0o600);
		expect((await store.load()).config).toEqual(config);
	});
});
