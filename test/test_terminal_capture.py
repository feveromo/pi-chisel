"""Standard-library regressions; screenshot capture itself optionally uses pyte."""

import unittest
import xml.etree.ElementTree as ET
from collections import defaultdict
from types import SimpleNamespace
from pathlib import Path

from terminal_capture import color, render_svg, terminal_decoder


def screen_for(lines):
    def character(text=" "):
        return SimpleNamespace(
            data=text, fg="c099ff", bg="default", bold=False, reverse=False
        )

    columns = max(map(len, lines))
    return SimpleNamespace(
        columns=columns,
        display=lines,
        buffer={
            i: defaultdict(character, {j: character(c) for j, c in enumerate(line)})
            for i, line in enumerate(lines)
        },
    )


class CaptureTests(unittest.TestCase):
    def test_every_utf8_split_is_lossless(self):
        text = "╭─ Chisel ✦ ─╮\n│ café → 界 😀 │\n╰────────────╯"
        data = text.encode()
        for split in range(len(data) + 1):
            decoder = terminal_decoder()
            self.assertEqual(
                decoder.decode(data[:split]) + decoder.decode(data[split:], final=True),
                text,
            )
        decoder = terminal_decoder()
        self.assertEqual(
            "".join(decoder.decode(bytes([b])) for b in data)
            + decoder.decode(b"", final=True),
            text,
        )

    def test_invalid_utf8_fails_instead_of_creating_replacement_glyphs(self):
        with self.assertRaises(UnicodeDecodeError):
            terminal_decoder().decode(b"\xff")

    def test_frames_use_geometry_and_content_is_escaped(self):
        svg = render_svg(
            screen_for(
                ["╭──────────╮", "│ Chisel < │", "│ esc back │", "╰──────────╯"]
            ),
            "review & compare",
            "Chisel",
            "esc back",
        )
        root = ET.fromstring(svg)
        texts = "".join(root.itertext())
        self.assertIn("review & compare", texts)
        self.assertIn("Chisel<", texts.replace("\n", ""))
        self.assertNotIn("╭", svg)
        self.assertNotIn("─", svg)
        self.assertIn('stroke="#c099ff"', svg)
        self.assertIn('textLength="8.8"', svg)
        self.assertNotIn("calc(", svg)

    def test_bad_captures_are_not_silently_written(self):
        for lines, marker, footer in [
            (["empty"], "missing", "footer"),
            (["Chisel"], "Chisel", "missing"),
            (["Chisel �", "esc back"], "Chisel", "esc back"),
        ]:
            with self.assertRaises(ValueError):
                render_svg(screen_for(lines), "test", marker, footer)

    def test_native_overlay_crops_host_background(self):
        svg = render_svg(
            screen_for(
                [
                    "OUTSIDE ╭──────────╮ OUTSIDE",
                    "OUTSIDE │ Chisel   │ OUTSIDE",
                    "OUTSIDE │ esc back │ OUTSIDE",
                    "OUTSIDE ╰──────────╯ OUTSIDE",
                ]
            ),
            "review",
            "Chisel",
            "esc back",
        )
        texts = "".join(ET.fromstring(svg).itertext()).replace("\n", "")
        self.assertNotIn("OUTSIDE", texts)
        self.assertIn("Chisel", texts)

    def test_titled_frame_starts_at_the_marker_row(self):
        svg = render_svg(
            screen_for(
                [
                    "OUTSIDE OUTSIDE OUTSIDE OUTSIDE",
                    "OUTSIDE ╭─ Chisel ─╮ OUTSIDE",
                    "OUTSIDE │ esc back │ OUTSIDE",
                    "OUTSIDE ╰──────────╯ OUTSIDE",
                ]
            ),
            "review",
            "Chisel",
            "esc back",
        )
        texts = "".join(ET.fromstring(svg).itertext()).replace("\n", "")
        self.assertNotIn("OUTSIDE", texts)
        self.assertIn("Chisel", texts)

    def test_checked_in_images_are_clean_xml(self):
        images = list(
            (Path(__file__).resolve().parents[1] / "docs/images").glob(
                "pi-chisel-*.svg"
            )
        )
        self.assertEqual(len(images), 4)
        for image in images:
            text = image.read_text(encoding="utf-8")
            ET.fromstring(text)
            self.assertNotIn("\ufffd", text, image.name)
            self.assertNotIn("calc(", text, image.name)

    def test_pyte_truecolor_and_ansi_palette(self):
        self.assertEqual(color("c099ff"), "#c099ff")
        self.assertEqual(color("#C099FF"), "#C099FF")
        self.assertEqual(color("red"), "#ff6b7a")
        self.assertEqual(color("invalid", "#112233"), "#112233")


if __name__ == "__main__":
    unittest.main()
