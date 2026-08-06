import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildWorkspaceReference,
	extractProjectGuidance,
} from "../src/project-context.ts";

const temporaryDirectories: string[] = [];
afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

async function projectFixture(): Promise<{ root: string; cwd: string }> {
	const root = await mkdtemp(join(tmpdir(), "pi-chisel-project-"));
	temporaryDirectories.push(root);
	const cwd = join(root, "src");
	await mkdir(join(root, ".git"), { recursive: true });
	await mkdir(cwd);
	await writeFile(
		join(root, ".git", "HEAD"),
		"ref: refs/heads/feature/context\n",
	);
	await writeFile(
		join(root, "package.json"),
		JSON.stringify({
			name: "contextual-tool",
			description: "A native prompt optimizer for coding sessions.",
			engines: { node: ">=22" },
			scripts: { test: "vitest run", validate: "npm test" },
			dependencies: { typescript: "latest", vitest: "latest" },
		}),
	);
	await writeFile(
		join(root, "README.md"),
		"# Contextual Tool\n\nTurns terse drafts into grounded prompts without submitting them.\n\n## Install\n\nRun npm install.\n",
	);
	await writeFile(join(root, "src", "index.ts"), "export {};\n");
	return { root, cwd };
}

describe("workspace context", () => {
	it("extracts only explicit project guidance blocks from Pi's system prompt", () => {
		const systemPrompt = `Generic agent instructions.
<project_context>
<project_instructions path="/work/AGENTS.md">
Preserve the public API.
</project_instructions>
</project_context>
Current working directory: /work`;
		expect(extractProjectGuidance(systemPrompt)).toEqual([
			{ path: "/work/AGENTS.md", content: "Preserve the public API." },
		]);
	});

	it("builds a bounded trusted snapshot from project facts and loaded guidance", async () => {
		const { root, cwd } = await projectFixture();
		const reference = await buildWorkspaceReference({
			cwd,
			trusted: true,
			tokenBudget: 700,
			systemPrompt: `Unrelated generic system text.
<project_context>
<project_instructions path="${join(root, "AGENTS.md")}">
Match existing style and run the narrowest proof first.
</project_instructions>
</project_context>`,
		});

		expect(reference?.estimatedTokens).toBeLessThanOrEqual(700);
		expect(reference?.trusted).toBe(true);
		expect(reference?.sourceCount).toBeGreaterThanOrEqual(4);
		expect(reference?.text).toContain("Project: ");
		expect(reference?.text).toContain("Git branch: feature/context");
		expect(reference?.text).toContain("Package: contextual-tool");
		expect(reference?.text).toContain("native prompt optimizer");
		expect(reference?.text).toContain("Match existing style");
		expect(reference?.text).toContain("Turns terse drafts");
		expect(reference?.text).not.toContain("Unrelated generic system text");
	});

	it("does not follow project metadata symlinks outside the intended file", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-chisel-project-"));
		temporaryDirectories.push(root);
		await mkdir(join(root, ".git"));
		await writeFile(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
		await writeFile(
			join(root, "private.txt"),
			'{"name":"must-not-leak","description":"sensitive material"}',
		);
		await symlink(join(root, "private.txt"), join(root, "package.json"));

		const reference = await buildWorkspaceReference({
			cwd: root,
			trusted: true,
			tokenBudget: 400,
			systemPrompt: "",
		});

		expect(reference?.text).not.toContain("must-not-leak");
		expect(reference?.text).not.toContain("sensitive material");
	});

	it("does not inspect project files before Pi trusts the workspace", async () => {
		const { cwd } = await projectFixture();
		const reference = await buildWorkspaceReference({
			cwd,
			trusted: false,
			tokenBudget: 160,
			systemPrompt: `<project_instructions path="/tmp/AGENTS.md">Do not leak me.</project_instructions>`,
		});

		expect(reference?.estimatedTokens).toBeLessThanOrEqual(160);
		expect(reference?.trusted).toBe(false);
		expect(reference?.sourceCount).toBe(1);
		expect(reference?.text).toContain("Project trust is inactive");
		expect(reference?.text).not.toContain("contextual-tool");
		expect(reference?.text).not.toContain("Do not leak me");
	});
});
