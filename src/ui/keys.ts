import { getKeybindings, type Keybinding } from "../host.ts";

export type SelectBinding = Extract<
	Keybinding,
	| "tui.select.up"
	| "tui.select.down"
	| "tui.select.pageUp"
	| "tui.select.pageDown"
	| "tui.select.confirm"
	| "tui.select.cancel"
>;

// Keyed by lowercase name: Pi reports "pageUp" while OMP reports "pageup".
const KEY_LABELS: Readonly<Record<string, string>> = {
	escape: "esc",
	return: "enter",
	up: "↑",
	down: "↓",
	pageup: "PgUp",
	pagedown: "PgDn",
};

/** Match the host's configurable selection keys, like its built-in dialogs. */
export function matchesBinding(data: string, binding: SelectBinding): boolean {
	return getKeybindings().matches(data, binding);
}

/** Short label for the first key currently bound to a selection action. */
export function bindingLabel(binding: SelectBinding): string {
	const key = getKeybindings().getKeys(binding)[0];
	if (!key) return "unbound";
	return KEY_LABELS[key.toLowerCase()] ?? key;
}

export function keyHint(binding: SelectBinding, description: string): string {
	return `${bindingLabel(binding)} ${description}`;
}
