import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";

export type ContextMode = "none" | "recent" | "auto";
export type OptimizerIntensity = "light" | "standard" | "strong";
export type PreviewMode = "optimized" | "original";

export interface OptimizerModelPreference {
	provider: string;
	id: string;
}

export interface OptimizerConfig {
	version: 1;
	model: OptimizerModelPreference | null;
	contextMode: ContextMode;
	contextTokenBudget: number;
	intensity: OptimizerIntensity;
	shortcut: KeyId;
	previewMode: PreviewMode;
}

export const DEFAULT_OPTIMIZER_CONFIG: Readonly<OptimizerConfig> =
	Object.freeze({
		version: 1,
		model: null,
		contextMode: "auto",
		contextTokenBudget: 1800,
		intensity: "standard",
		shortcut: "ctrl+alt+p",
		previewMode: "optimized",
	});

const MODIFIERS = new Set(["ctrl", "shift", "alt", "super"]);
const SPECIAL_KEYS = new Set([
	"escape",
	"esc",
	"enter",
	"return",
	"tab",
	"space",
	"backspace",
	"delete",
	"insert",
	"clear",
	"home",
	"end",
	"pageup",
	"pagedown",
	"up",
	"down",
	"left",
	"right",
	...Array.from({ length: 12 }, (_, index) => `f${index + 1}`),
]);
const SYMBOL_KEYS = new Set("`-=[]\\;',./!@#$%^&*()_+|~{}:<>?".split(""));

interface ParsedShortcut {
	modifiers: string[];
	key: string;
}

function parseShortcut(value: string): ParsedShortcut | undefined {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/\s*\+\s*/g, "+");
	if (!normalized) return undefined;

	let key: string | undefined;
	let modifiers: string[];
	if (normalized === "+") {
		key = "+";
		modifiers = [];
	} else if (normalized.endsWith("++")) {
		key = "+";
		modifiers = normalized.slice(0, -2).split("+");
	} else {
		const parts = normalized.split("+");
		key = parts.pop();
		modifiers = parts;
	}

	if (
		!key ||
		modifiers.some((part) => !part) ||
		new Set(modifiers).size !== modifiers.length ||
		modifiers.some((part) => !MODIFIERS.has(part))
	) {
		return undefined;
	}

	const isBaseKey =
		/^[a-z0-9]$/.test(key) || SPECIAL_KEYS.has(key) || SYMBOL_KEYS.has(key);
	if (!isBaseKey) return undefined;

	if (key === "pageup") key = "pageUp";
	else if (key === "pagedown") key = "pageDown";
	return { modifiers, key };
}

export function normalizeShortcut(value: string): KeyId | undefined {
	const parsed = parseShortcut(value);
	return parsed
		? ([...parsed.modifiers, parsed.key].join("+") as KeyId)
		: undefined;
}

function shortcutIdentity(value: string): string | undefined {
	const parsed = parseShortcut(value);
	if (!parsed) return undefined;
	const modifiers = parsed.modifiers.toSorted((a, b) => a.localeCompare(b));
	return `${modifiers.join("+")}::${parsed.key}`;
}

export function findShortcutConflicts(
	bindings: Record<string, KeyId | KeyId[] | undefined>,
	shortcut: string,
): string[] {
	const target = shortcutIdentity(shortcut);
	if (!target) return [];

	const conflicts: string[] = [];
	for (const [id, configured] of Object.entries(bindings)) {
		if (configured === undefined) continue;
		const keys = Array.isArray(configured) ? configured : [configured];
		if (keys.some((key) => shortcutIdentity(key) === target))
			conflicts.push(id);
	}
	return conflicts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(
	value: unknown,
	values: readonly T[],
): value is T {
	return typeof value === "string" && values.includes(value as T);
}

export interface ParsedConfig {
	config: OptimizerConfig;
	warning?: string;
}

export function parseOptimizerConfig(value: unknown): ParsedConfig {
	if (!isRecord(value)) {
		return {
			config: { ...DEFAULT_OPTIMIZER_CONFIG },
			warning: "Pi Chisel's config is not a JSON object; defaults are active.",
		};
	}

	const invalid: string[] = [];
	let model: OptimizerModelPreference | null = DEFAULT_OPTIMIZER_CONFIG.model;
	if (value.model === null || value.model === undefined) {
		model = null;
	} else if (
		isRecord(value.model) &&
		typeof value.model.provider === "string" &&
		value.model.provider.trim() &&
		typeof value.model.id === "string" &&
		value.model.id.trim()
	) {
		model = {
			provider: value.model.provider.trim(),
			id: value.model.id.trim(),
		};
	} else {
		invalid.push("model");
	}

	const contextMode = isOneOf(value.contextMode, [
		"none",
		"recent",
		"auto",
	] as const)
		? value.contextMode
		: DEFAULT_OPTIMIZER_CONFIG.contextMode;
	if (value.contextMode !== undefined && contextMode !== value.contextMode)
		invalid.push("contextMode");

	const contextTokenBudget =
		typeof value.contextTokenBudget === "number" &&
		Number.isInteger(value.contextTokenBudget) &&
		value.contextTokenBudget >= 128 &&
		value.contextTokenBudget <= 16_384
			? value.contextTokenBudget
			: DEFAULT_OPTIMIZER_CONFIG.contextTokenBudget;
	if (
		value.contextTokenBudget !== undefined &&
		contextTokenBudget !== value.contextTokenBudget
	) {
		invalid.push("contextTokenBudget");
	}

	const intensity = isOneOf(value.intensity, [
		"light",
		"standard",
		"strong",
	] as const)
		? value.intensity
		: DEFAULT_OPTIMIZER_CONFIG.intensity;
	if (value.intensity !== undefined && intensity !== value.intensity)
		invalid.push("intensity");

	const shortcut =
		typeof value.shortcut === "string"
			? normalizeShortcut(value.shortcut)
			: undefined;
	if (value.shortcut !== undefined && !shortcut) invalid.push("shortcut");

	const previewMode = isOneOf(value.previewMode, [
		"optimized",
		"original",
	] as const)
		? value.previewMode
		: DEFAULT_OPTIMIZER_CONFIG.previewMode;
	if (value.previewMode !== undefined && previewMode !== value.previewMode)
		invalid.push("previewMode");

	const config: OptimizerConfig = {
		version: 1,
		model,
		contextMode,
		contextTokenBudget,
		intensity,
		shortcut: shortcut ?? DEFAULT_OPTIMIZER_CONFIG.shortcut,
		previewMode,
	};
	if (invalid.length === 0) return { config };

	const settingLabel = invalid.length === 1 ? "setting" : "settings";
	return {
		config,
		warning: `Ignored invalid Chisel ${settingLabel}: ${invalid.join(", ")}.`,
	};
}

export class OptimizerConfigStore {
	readonly path: string;

	constructor(path = join(getAgentDir(), "prompt-optimizer.json")) {
		this.path = path;
	}

	async load(): Promise<ParsedConfig> {
		try {
			const raw = await readFile(this.path, "utf8");
			return parseOptimizerConfig(JSON.parse(raw) as unknown);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return { config: { ...DEFAULT_OPTIMIZER_CONFIG } };
			}
			const message = error instanceof Error ? error.message : String(error);
			return {
				config: { ...DEFAULT_OPTIMIZER_CONFIG },
				warning: `Could not read ${this.path}: ${message}. Defaults are active.`,
			};
		}
	}

	async save(config: OptimizerConfig): Promise<void> {
		const directory = dirname(this.path);
		const temporaryPath = join(
			directory,
			`.prompt-optimizer.${process.pid}.${randomUUID()}.tmp`,
		);
		await mkdir(directory, { recursive: true });
		try {
			await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
				encoding: "utf8",
				mode: 0o600,
			});
			await rename(temporaryPath, this.path);
		} catch (error) {
			await rm(temporaryPath, { force: true }).catch(() => undefined);
			throw error;
		}
	}
}
