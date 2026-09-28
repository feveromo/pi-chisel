import {
	Container,
	type Theme,
	truncateLine,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "../host.ts";

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

export interface FrameLabels {
	/** Shown at the left of the top border. */
	title?: string;
	/** Shown at the right of the bottom border, such as a scroll position. */
	status?: string;
}

/** A border edge with an optional label set into it: `╭─ label ────╮`. */
function frameEdge(
	theme: Theme,
	borderColor: "border" | "borderAccent",
	innerWidth: number,
	corners: [string, string],
	label: string | undefined,
	labelAtEnd: boolean,
): string {
	const border = (text: string) => theme.fg(borderColor, text);
	const fitted =
		label && innerWidth >= 6
			? truncateLine(sanitizeInline(label), innerWidth - 4)
			: "";
	if (!fitted)
		return border(`${corners[0]}${"─".repeat(innerWidth)}${corners[1]}`);
	const styled = labelAtEnd
		? theme.fg("dim", fitted)
		: theme.fg("accent", theme.bold(fitted));
	const rest = "─".repeat(innerWidth - visibleWidth(fitted) - 3);
	return labelAtEnd
		? `${border(`${corners[0]}${rest} `)}${styled}${border(` ─${corners[1]}`)}`
		: `${border(`${corners[0]}─ `)}${styled}${border(` ${rest}${corners[1]}`)}`;
}

export function overlayFrame(
	theme: Theme,
	width: number,
	body: string[],
	accent = false,
	labels: FrameLabels = {},
): string[] {
	const actualWidth = Math.max(8, width);
	const innerWidth = actualWidth - 2;
	const borderColor = accent ? "borderAccent" : "border";
	const top = frameEdge(
		theme,
		borderColor,
		innerWidth,
		["╭", "╮"],
		labels.title,
		false,
	);
	const bottom = frameEdge(
		theme,
		borderColor,
		innerWidth,
		["╰", "╯"],
		labels.status,
		true,
	);
	const rows = body.map((content) => {
		const normalized =
			visibleWidth(content) > innerWidth
				? truncateLine(content, innerWidth)
				: content;
		const padded = truncateToWidth(normalized, innerWidth, "", true);
		return `${theme.fg(borderColor, "│")}${padded}${theme.fg(borderColor, "│")}`;
	});
	return [top, ...rows, bottom];
}

/** Native host components laid out inside Chisel's titled overlay frame. */
export class FramedContainer extends Container {
	constructor(
		private readonly frameTheme: Theme,
		private readonly title: string,
	) {
		super();
	}

	override render(width: number): string[] {
		const inner = Math.max(1, width - 4);
		return overlayFrame(
			this.frameTheme,
			width,
			super.render(inner).map((line) => ` ${line}`),
			true,
			{ title: this.title },
		);
	}
}
