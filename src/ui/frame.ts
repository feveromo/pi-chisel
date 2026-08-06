import { DynamicBorder, type Theme } from "@earendil-works/pi-coding-agent";
import {
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

export function accentBorder(theme: Theme): DynamicBorder {
	return new DynamicBorder((text: string) => theme.fg("borderAccent", text));
}

export function sanitizeForDisplay(text: string): string {
	let sanitized = "";
	for (const character of text) {
		const codePoint = character.codePointAt(0) ?? 0;
		if (character === "\t") sanitized += "    ";
		else if (character === "\n" || character === "\r") sanitized += character;
		else if (codePoint === 0x1b) sanitized += "␛";
		else if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f))
			sanitized += "�";
		else sanitized += character;
	}
	return sanitized;
}

export function sanitizeInline(text: string): string {
	return sanitizeForDisplay(text)
		.replaceAll("\r\n", " ")
		.replaceAll("\r", " ")
		.replaceAll("\n", " ");
}

export function wrapPlainText(text: string, width: number): string[] {
	const safe = sanitizeForDisplay(text);
	return wrapTextWithAnsi(safe, Math.max(1, width));
}

export function overlayFrame(
	theme: Theme,
	width: number,
	body: string[],
	accent = false,
): string[] {
	const actualWidth = Math.max(8, width);
	const innerWidth = actualWidth - 2;
	const borderColor = accent ? "borderAccent" : "border";
	const top = theme.fg(borderColor, `╭${"─".repeat(innerWidth)}╮`);
	const bottom = theme.fg(borderColor, `╰${"─".repeat(innerWidth)}╯`);
	const rows = body.map((content) => {
		const normalized =
			visibleWidth(content) > innerWidth
				? truncateToWidth(content, innerWidth, "…")
				: content;
		const padded = truncateToWidth(normalized, innerWidth, "", true);
		return `${theme.fg(borderColor, "│")}${padded}${theme.fg(borderColor, "│")}`;
	});
	return [top, ...rows, bottom];
}
