import { lstat, open, readdir } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
	estimateTextTokens,
	type WorkspaceReference,
} from "./request-builder.ts";

export interface ProjectGuidance {
	path: string;
	content: string;
}

export interface BuildWorkspaceReferenceOptions {
	cwd: string;
	systemPrompt: string;
	trusted: boolean;
	tokenBudget: number;
}

const PROJECT_MARKERS = [
	".git",
	"package.json",
	"pyproject.toml",
	"Cargo.toml",
	"go.mod",
	"deno.json",
	"deno.jsonc",
	"pnpm-workspace.yaml",
];
const FALLBACK_MANIFESTS = [
	"pyproject.toml",
	"Cargo.toml",
	"go.mod",
	"deno.json",
	"deno.jsonc",
];
const LANDMARK_NOISE = new Set([
	".git",
	".cache",
	"coverage",
	"dist",
	"node_modules",
	"target",
	"vendor",
]);
const PRIVATE_NAME_PATTERN =
	/(?:^\.env(?:\.|$)|credential|secret|token|private|\.pem$|\.key$|^id_(?:rsa|ed25519))/i;

async function readTextPrefix(
	path: string,
	maximumBytes: number,
): Promise<string | undefined> {
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	try {
		const metadata = await lstat(path);
		if (!metadata.isFile() || metadata.isSymbolicLink()) return undefined;
		handle = await open(path, "r");
		const buffer = Buffer.alloc(maximumBytes);
		const { bytesRead } = await handle.read(buffer, 0, maximumBytes, 0);
		return buffer.subarray(0, bytesRead).toString("utf8");
	} catch {
		return undefined;
	} finally {
		await handle?.close().catch(() => undefined);
	}
}

async function directoryNames(path: string): Promise<Set<string>> {
	try {
		return new Set(await readdir(path));
	} catch {
		return new Set();
	}
}

async function findProjectRoot(cwd: string): Promise<string> {
	let current = resolve(cwd);
	let nearestManifest: string | undefined;

	while (true) {
		const names = await directoryNames(current);
		if (names.has(".git")) return current;
		if (
			!nearestManifest &&
			PROJECT_MARKERS.some((marker) => marker !== ".git" && names.has(marker))
		) {
			nearestManifest = current;
		}

		const parent = dirname(current);
		if (parent === current) return nearestManifest ?? resolve(cwd);
		current = parent;
	}
}

async function readGitBranch(root: string): Promise<string | undefined> {
	const dotGit = join(root, ".git");
	let gitDirectory = dotGit;
	try {
		const metadata = await lstat(dotGit);
		if (metadata.isSymbolicLink()) return undefined;
		if (metadata.isFile()) {
			const pointer = await readTextPrefix(dotGit, 1024);
			const match = pointer?.match(/^gitdir:\s*(.+)$/m);
			if (!match?.[1]) return undefined;
			gitDirectory = resolve(root, match[1].trim());
		}
	} catch {
		return undefined;
	}

	const head = (await readTextPrefix(join(gitDirectory, "HEAD"), 512))?.trim();
	if (!head) return undefined;
	if (head.startsWith("ref: refs/heads/")) return head.slice(16);
	return `detached@${head.slice(0, 12)}`;
}

export function extractProjectGuidance(
	systemPrompt: string,
): ProjectGuidance[] {
	const guidance: ProjectGuidance[] = [];
	const pattern =
		/<project_instructions\s+path="([^"]+)">\s*([\s\S]*?)\s*<\/project_instructions>/g;
	for (const match of systemPrompt.matchAll(pattern)) {
		const path = match[1]?.trim();
		const content = match[2]?.trim();
		if (path && content) guidance.push({ path, content });
	}
	return guidance;
}

function guidanceText(
	guidance: readonly ProjectGuidance[],
	root: string,
): string | undefined {
	if (guidance.length === 0) return undefined;
	const ranked = [...guidance].sort((left, right) => {
		const leftInside = relative(root, left.path).startsWith("..") ? 1 : 0;
		const rightInside = relative(root, right.path).startsWith("..") ? 1 : 0;
		return leftInside - rightInside || right.path.length - left.path.length;
	});
	return ranked
		.map((item) => {
			const shownPath = relative(root, item.path) || basename(item.path);
			return `[${shownPath}]\n${item.content}`;
		})
		.join("\n\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordKeys(value: unknown): string[] {
	return isRecord(value) ? Object.keys(value) : [];
}

async function packageSummary(root: string): Promise<string | undefined> {
	const raw = await readTextPrefix(join(root, "package.json"), 128 * 1024);
	if (!raw) return undefined;

	try {
		const value = JSON.parse(raw) as unknown;
		if (!isRecord(value)) return undefined;
		const lines: string[] = [];
		if (typeof value.name === "string") {
			const description =
				typeof value.description === "string" && value.description.trim()
					? ` — ${value.description.trim()}`
					: "";
			lines.push(`Package: ${value.name}${description}`);
		}
		if (isRecord(value.engines)) {
			const engines = Object.entries(value.engines)
				.filter(
					(entry): entry is [string, string] => typeof entry[1] === "string",
				)
				.map(([name, version]) => `${name} ${version}`)
				.join(", ");
			if (engines) lines.push(`Runtime: ${engines}`);
		}
		const scriptNames = recordKeys(value.scripts);
		if (scriptNames.length > 0)
			lines.push(`Available scripts: ${scriptNames.slice(0, 16).join(", ")}`);

		const packages = [
			...recordKeys(value.dependencies),
			...recordKeys(value.devDependencies),
		];
		const distinctive = [...new Set(packages)]
			.filter((name) =>
				/(?:react|next|vue|svelte|astro|vite|typescript|vitest|jest|playwright|electron|express|fastify|biome|eslint|tailwind|pi-|pi-ai|pi-tui)/i.test(
					name,
				),
			)
			.sort();
		if (distinctive.length > 0)
			lines.push(`Key packages: ${distinctive.slice(0, 18).join(", ")}`);
		return lines.length > 0 ? lines.join("\n") : undefined;
	} catch {
		return undefined;
	}
}

async function fallbackManifestSummary(
	root: string,
): Promise<string | undefined> {
	for (const name of FALLBACK_MANIFESTS) {
		const text = (await readTextPrefix(join(root, name), 2400))?.trim();
		if (text) return `${name}:\n${text}`;
	}
	return undefined;
}

function cleanReadmeBlock(block: string): string {
	return block
		.split("\n")
		.filter(
			(line) => !/^\s*(?:!\[|\[!\[|<img|<div|<p\s+align=|```)/i.test(line),
		)
		.join("\n")
		.replace(/\s+/g, " ")
		.trim();
}

async function readmeOverview(root: string): Promise<string | undefined> {
	const names = await directoryNames(root);
	const readme = [...names].find((name) => /^readme(?:\.[^.]+)?$/i.test(name));
	if (!readme) return undefined;
	const raw = await readTextPrefix(join(root, readme), 16 * 1024);
	if (!raw) return undefined;

	const blocks = raw
		.split(/\n\s*\n/u)
		.map(cleanReadmeBlock)
		.filter(
			(block) =>
				block.length > 0 && !/^[-|: ]+$/.test(block) && !/^```/.test(block),
		);
	if (blocks.length === 0) return undefined;
	return blocks.slice(0, 3).join("\n\n");
}

async function projectLandmarks(root: string): Promise<string | undefined> {
	try {
		const entries = await readdir(root, { withFileTypes: true });
		const names = entries
			.filter(
				(entry) =>
					!LANDMARK_NOISE.has(entry.name) &&
					!PRIVATE_NAME_PATTERN.test(entry.name) &&
					(!entry.name.startsWith(".") ||
						entry.name === ".github" ||
						entry.name === ".pi"),
			)
			.map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
			.sort((left, right) => left.localeCompare(right))
			.slice(0, 28);
		return names.length > 0 ? names.join(", ") : undefined;
	} catch {
		return undefined;
	}
}

function fitTextToTokenBudget(
	text: string,
	tokenBudget: number,
): string | undefined {
	if (tokenBudget <= 0) return undefined;
	if (estimateTextTokens(text) <= tokenBudget) return text;

	const marker = "\n[… context excerpt shortened …]\n";
	if (estimateTextTokens(marker) >= tokenBudget) return undefined;
	let characterBudget = Math.max(1, tokenBudget * 4 - marker.length);
	while (characterBudget > 0) {
		const headCharacters = Math.max(1, Math.floor(characterBudget * 0.7));
		const tailCharacters = Math.max(1, characterBudget - headCharacters);
		const candidate = `${text.slice(0, headCharacters)}${marker}${text.slice(-tailCharacters)}`;
		if (estimateTextTokens(candidate) <= tokenBudget) return candidate;
		characterBudget -= Math.max(1, Math.ceil(characterBudget * 0.08));
	}
	return undefined;
}

interface ReferenceSection {
	text: string | undefined;
	maximumTokens: number;
}

export async function buildWorkspaceReference(
	options: BuildWorkspaceReferenceOptions,
): Promise<WorkspaceReference | undefined> {
	const { cwd, systemPrompt, trusted, tokenBudget } = options;
	if (tokenBudget <= 0) return undefined;

	const root = trusted ? await findProjectRoot(cwd) : resolve(cwd);
	const branch = trusted ? await readGitBranch(root) : undefined;
	const identityLines = [
		`Working directory: ${resolve(cwd)}`,
		...(root !== resolve(cwd) ? [`Project root: ${root}`] : []),
		`Project: ${basename(root) || root}`,
		...(branch ? [`Git branch: ${branch}`] : []),
		...(!trusted
			? ["Project trust is inactive; project files were not inspected."]
			: []),
	];

	const guidance = trusted
		? guidanceText(extractProjectGuidance(systemPrompt), root)
		: undefined;
	const manifest = trusted
		? ((await packageSummary(root)) ?? (await fallbackManifestSummary(root)))
		: undefined;
	const overview = trusted ? await readmeOverview(root) : undefined;
	const landmarks = trusted ? await projectLandmarks(root) : undefined;
	const sections: ReferenceSection[] = [
		{
			text: `Workspace identity:\n${identityLines.join("\n")}`,
			maximumTokens: 120,
		},
		{
			text: guidance ? `Loaded project guidance:\n${guidance}` : undefined,
			maximumTokens: 240,
		},
		{
			text: manifest ? `Project manifest:\n${manifest}` : undefined,
			maximumTokens: 180,
		},
		{
			text: overview ? `Project overview:\n${overview}` : undefined,
			maximumTokens: 180,
		},
		{
			text: landmarks ? `Top-level landmarks:\n${landmarks}` : undefined,
			maximumTokens: 100,
		},
	];

	const selected: string[] = [];
	let sourceCount = 0;
	for (const section of sections) {
		if (!section.text) continue;
		const used = estimateTextTokens(selected.join("\n\n"));
		const remaining = tokenBudget - used;
		if (remaining <= 0) break;
		const fitted = fitTextToTokenBudget(
			section.text,
			Math.min(remaining, section.maximumTokens),
		);
		if (!fitted) continue;
		selected.push(fitted);
		sourceCount += 1;
	}
	if (selected.length === 0) return undefined;

	const text = fitTextToTokenBudget(selected.join("\n\n"), tokenBudget);
	if (!text) return undefined;
	return {
		text,
		estimatedTokens: estimateTextTokens(text),
		sourceCount,
		trusted,
	};
}
