"""Lossless PTY decoding and font-independent frame rendering for documentation.

No runtime dependency: pyte is needed only when requesting screenshots.
"""

from __future__ import annotations

import codecs
import html
import re
from pathlib import Path
from typing import Any

FONT = "DejaVu Sans Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
COLORS = {
    "black": "#11151d",
    "red": "#ff6b7a",
    "green": "#7bd88f",
    "brown": "#f4bf75",
    "yellow": "#f4bf75",
    "blue": "#79a8ff",
    "magenta": "#c099ff",
    "cyan": "#61d6d6",
    "white": "#d8dee9",
    "brightblack": "#667085",
    "brightred": "#ff8290",
    "brightgreen": "#91e6a3",
    "brightyellow": "#ffd08a",
    "brightblue": "#91b8ff",
    "brightmagenta": "#d0b0ff",
    "brightcyan": "#7fe3e3",
    "brightwhite": "#f4f7fb",
    "default": "#d8dee9",
}
# Draw terminal frames as geometry, so browser font fallback cannot break joins.
EDGES = {
    "─": "lr",
    "│": "ud",
    "┌": "rd",
    "┐": "ld",
    "└": "ru",
    "┘": "lu",
    "╭": "rd",
    "╮": "ld",
    "╰": "ru",
    "╯": "lu",
    "├": "urd",
    "┤": "uld",
    "┬": "lrd",
    "┴": "lru",
    "┼": "lrud",
}


def terminal_decoder() -> Any:
    # A read() boundary is not a Unicode boundary. Strict decoding exposes real
    # invalid output instead of silently baking replacement glyphs into images.
    return codecs.getincrementaldecoder("utf-8")("strict")


def color(value: str, default: str = "#d8dee9") -> str:
    if re.fullmatch(r"#?[0-9a-fA-F]{6}", value):
        return "#" + value.lstrip("#")
    return COLORS.get(value, default)


def render_svg(screen: Any, title: str, marker: str, footer: str) -> str:
    display = screen.display
    marker_row = next((i for i, line in enumerate(display) if marker in line), None)
    if marker_row is None:
        raise ValueError(f"Screenshot marker not found: {marker!r}")
    footer_row = next(
        (i for i in range(marker_row, len(display)) if footer in display[i]), None
    )
    if footer_row is None:
        raise ValueError(f"Screenshot footer not found: {footer!r}")
    # Chisel sets overlay titles into the top border; otherwise the frame is
    # the row above the marker.
    first_row = (
        marker_row
        if any(corner in display[marker_row] for corner in ("╭", "┌"))
        else max(0, marker_row - 1)
    )
    last_row = min(len(display) - 1, footer_row + 1)
    rows = display[first_row : last_row + 1]
    if any("\ufffd" in line for line in rows):
        raise ValueError("Replacement glyph in screenshot; check UTF-8 decoding")
    occupied = [
        column
        for row in range(first_row, last_row + 1)
        for column in range(screen.columns)
        if screen.buffer[row][column].data != " "
    ]
    first_column, last_column = min(occupied), max(occupied)
    # Native Pi floats the overlay above the editor/footer. Crop its real frame,
    # not background host text that happens to share these terminal rows.
    top_row = screen.buffer[first_row]
    left = next(
        (c for c in range(screen.columns) if top_row[c].data in ("╭", "┌")), None
    )
    if left is not None:
        right = next(
            (
                c
                for c in range(left + 1, screen.columns)
                if top_row[c].data in ("╮", "┐")
            ),
            None,
        )
        if right is not None:
            first_column, last_column = left, right
    cell_width, line_height, padding, header = 8.8, 21, 22, 42
    width = round((last_column - first_column + 1) * cell_width + padding * 2)
    height = header + len(rows) * line_height + padding * 2
    svg = [
        f'<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img">',
        f"<title>{html.escape(title)}</title>",
        f'<rect x="0.5" y="0.5" width="{width - 1}" height="{height - 1}" rx="12" fill="#0b0f14" stroke="#273142"/>',
        f'<text x="{padding}" y="26" fill="#c099ff" font-family="{FONT}" font-size="12">PI CHISEL</text>',
        f'<text x="{width - padding}" y="26" text-anchor="end" fill="#8b98ad" font-family="{FONT}" font-size="12">{html.escape(title)}</text>',
        f'<path d="M 0 42 H {width}" stroke="#273142"/>',
    ]
    for row_index, source_row in enumerate(range(first_row, last_row + 1)):
        top = header + padding + row_index * line_height
        row = screen.buffer[source_row]
        column = first_column
        while column <= last_column:
            char = row[column]
            x = padding + (column - first_column) * cell_width
            fg, bg = color(char.fg), color(char.bg, "#0b0f14")
            if char.reverse:
                fg, bg = bg, fg
            if char.bg != "default" or char.reverse:
                svg.append(
                    f'<rect x="{x:.1f}" y="{top}" width="{cell_width}" height="{line_height}" fill="{bg}"/>'
                )
            if char.data in EDGES:
                cx, cy = x + cell_width / 2, top + line_height / 2
                points = {
                    "l": (x, cy),
                    "r": (x + cell_width, cy),
                    "u": (cx, top),
                    "d": (cx, top + line_height),
                }
                path = " ".join(
                    f"M {cx:.1f} {cy:.1f} L {points[e][0]:.1f} {points[e][1]:.1f}"
                    for e in EDGES[char.data]
                )
                svg.append(
                    f'<path d="{path}" fill="none" stroke="{fg}" stroke-width="1"/>'
                )
            elif char.data.strip():
                # Keep each terminal cell positioned independently, including
                # continuation cells for wide glyphs. No font-dependent run drift.
                cells = 2 if column < last_column and row[column + 1].data == "" else 1
                weight = ' font-weight="700"' if char.bold else ""
                svg.append(
                    f'<text x="{x:.1f}" y="{top + 15}" fill="{fg}"{weight} font-family="{FONT}" '
                    f'font-size="14" textLength="{cell_width * cells:.1f}" lengthAdjust="spacingAndGlyphs">{html.escape(char.data)}</text>'
                )
            column += 1
    svg.append("</svg>\n")
    return "\n".join(svg)


class TerminalCapture:
    def __init__(
        self, directory: str | None, host: str, columns: int = 120, lines: int = 42
    ):
        self.directory = Path(directory) if directory else None
        self.host = host
        self.decoder = terminal_decoder()
        self.screen = self.stream = None
        if self.directory:
            try:
                import pyte
            except ImportError as error:
                raise SystemExit(
                    "Screenshot capture requires `uv run --with pyte test/smoke-tui.py`"
                ) from error
            self.directory.mkdir(parents=True, exist_ok=True)
            self.screen = pyte.Screen(columns, lines)
            self.stream = pyte.Stream(self.screen)

    def feed(self, chunk: bytes) -> None:
        if self.stream is not None:
            self.stream.feed(self.decoder.decode(chunk))

    def save(self, name: str, marker: str, footer: str) -> None:
        if self.directory is None:
            return
        phase = name.removeprefix("pi-chisel-")
        svg = render_svg(self.screen, f"{phase} / {self.host}", marker, footer)
        (self.directory / f"{name}.svg").write_text(svg, encoding="utf-8")
