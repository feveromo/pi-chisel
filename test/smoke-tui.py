#!/usr/bin/env python3
"""PTY smoke test for isolated or actively configured OMP using a faux provider."""

from __future__ import annotations

import atexit
import fcntl
import html
import importlib
import os
import pty
import re
import select
import shutil
import signal
import struct
import subprocess
import tempfile
import termios
import time
from contextlib import suppress
from pathlib import Path
from typing import Any, NoReturn

ROOT = Path(__file__).resolve().parents[1]
SUPPORTED_OMP = ROOT / "node_modules" / ".bin" / "omp"
OMP = os.environ.get("OMP_BIN") or (
    str(SUPPORTED_OMP) if SUPPORTED_OMP.exists() else shutil.which("omp")
)
if OMP is None:
    raise SystemExit("omp is not on PATH and the supported local OMP is not installed")


def kitty_shortcut(value: str, *, alternate: bool = False) -> bytes:
    parts = value.strip().lower().split("+")
    key = parts.pop() if parts else ""
    modifier_values = {"shift": 1, "alt": 2, "ctrl": 4, "super": 8}
    if (
        len(key) != 1
        or len(parts) != len(set(parts))
        or any(modifier not in modifier_values for modifier in parts)
    ):
        raise SystemExit(
            f"Smoke test only supports a modified single-character shortcut, got {value!r}"
        )
    modifiers = 1 + sum(modifier_values[modifier] for modifier in parts)
    codepoint = ord(key)
    if alternate:
        alternate_codepoint = ord(key.upper()) if "shift" in parts else codepoint
        return f"\x1b[{codepoint}::{alternate_codepoint};{modifiers}u".encode()
    return f"\x1b[{codepoint};{modifiers}u".encode()


shortcut = os.environ.get("OMP_CHISEL_SMOKE_SHORTCUT", "ctrl+shift+k")
demo_draft = os.environ.get("OMP_CHISEL_SMOKE_DRAFT", "make this clearer")
optimized_draft = os.environ.get(
    "OMP_CHISEL_SMOKE_RESULT",
    "Please make this clearer while preserving the exact intent.",
)
capture_dir_value = os.environ.get("OMP_CHISEL_CAPTURE_DIR")
capture_dir = Path(capture_dir_value) if capture_dir_value else None
terminal_screen: Any | None = None
terminal_stream: Any | None = None
if capture_dir is not None:
    try:
        pyte = importlib.import_module("pyte")
    except ImportError as error:
        raise SystemExit(
            "Screenshot capture requires pyte; run with `uv run --with pyte test/smoke-tui.py`"
        ) from error
    capture_dir.mkdir(parents=True, exist_ok=True)
    terminal_screen = pyte.Screen(120, 42)
    terminal_stream = pyte.Stream(terminal_screen)

configured_runtime = os.environ.get("OMP_CHISEL_CONFIGURED") == "1"
config_dir = (
    None if configured_runtime else tempfile.mkdtemp(prefix="omp-chisel-smoke-")
)
master_fd, slave_fd = pty.openpty()
fcntl.ioctl(slave_fd, termios.TIOCSWINSZ, struct.pack("HHHH", 42, 120, 0, 0))

env = os.environ.copy()
env.update(
    {
        "PI_OFFLINE": "1",
        "PI_SKIP_VERSION_CHECK": "1",
        "OMP_SKIP_SETUP": "1",
        "TERM": "xterm-256color",
        "COLORTERM": "truecolor",
    }
)
if config_dir is not None:
    env["PI_CODING_AGENT_DIR"] = config_dir

command = [
    OMP,
    "--no-session",
    "--no-rules",
    "--no-skills",
]
if configured_runtime:
    command.extend(["-e", str(ROOT / "test/fixtures/faux-provider.ts")])
else:
    command.extend(
        [
            "--no-extensions",
            "-e",
            str(ROOT / "test/fixtures/faux-provider.ts"),
            "-e",
            str(ROOT / "src/index.ts"),
        ]
    )
command.extend(
    [
        "--model",
        "prompt-optimizer-faux/faux-model",
    ]
)
process = subprocess.Popen(
    command,
    cwd=ROOT,
    env=env,
    stdin=slave_fd,
    stdout=slave_fd,
    stderr=slave_fd,
    start_new_session=True,
    close_fds=True,
)
os.close(slave_fd)
output = bytearray()


def cleanup() -> None:
    with suppress(OSError):
        os.close(master_fd)
    if process.poll() is None:
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=2)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            with suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            with suppress(subprocess.TimeoutExpired):
                process.wait(timeout=2)
    if config_dir is not None:
        shutil.rmtree(config_dir, ignore_errors=True)


atexit.register(cleanup)


def pump(duration: float = 0.1) -> None:
    deadline = time.monotonic() + duration
    while time.monotonic() < deadline:
        ready, _, _ = select.select(
            [master_fd], [], [], max(0.0, deadline - time.monotonic())
        )
        if not ready:
            break
        try:
            chunk = os.read(master_fd, 65536)
        except OSError:
            break
        if not chunk:
            break
        output.extend(chunk)
        if terminal_stream is not None:
            terminal_stream.feed(chunk.decode("utf-8", errors="replace"))
        if len(output) > 1_000_000:
            del output[:-750_000]


def decoded() -> str:
    return output.decode("utf-8", errors="replace")


def wait_for(text: str, timeout: float = 8.0) -> None:
    deadline = time.monotonic() + timeout
    while text not in decoded():
        if process.poll() is not None:
            fail(f"OMP exited before rendering {text!r}")
        if time.monotonic() >= deadline:
            fail(f"Timed out waiting for {text!r}")
        pump(0.1)


def send(data: bytes) -> None:
    os.write(master_fd, data)
    pump(0.08)


def plain_tail() -> str:
    text = decoded()
    text = re.sub(r"\x1b\][^\x07]*(?:\x07|\x1b\\)", "", text)
    text = re.sub(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|[@-_])", "", text)
    return text[-10_000:]


def fail(message: str) -> NoReturn:
    raise AssertionError(f"{message}\n\n--- OMP output tail ---\n{plain_tail()}")


def capture_svg(name: str, marker: str, footer: str) -> None:
    if capture_dir is None or terminal_screen is None:
        return
    display = terminal_screen.display
    marker_row = next(
        (index for index, line in enumerate(display) if marker in line), None
    )
    if marker_row is None:
        fail(f"Could not find screenshot marker {marker!r}")
    footer_row = next(
        (
            index
            for index in range(marker_row, min(len(display), marker_row + 28))
            if footer in display[index]
        ),
        None,
    )
    if footer_row is None:
        fail(f"Could not find screenshot footer {footer!r}")

    first_row = max(0, marker_row - 1)
    last_row = min(len(display) - 1, footer_row + 1)
    first_column = 0
    last_column = 119

    cell_width = 8.8
    line_height = 21
    padding = 24
    header_height = 42
    columns = last_column - first_column + 1
    rows = last_row - first_row + 1
    width = round(columns * cell_width + padding * 2)
    height = header_height + rows * line_height + padding
    color_map = {
        "black": "#11151d",
        "red": "#ff6b7a",
        "green": "#7bd88f",
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
    title = {
        "chisel-invoking": "OMP Chisel · invoking",
        "chisel-review": "OMP Chisel · review",
        "chisel-comparison": "OMP Chisel · comparison",
    }.get(name, "OMP Chisel")
    svg = [
        f'<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        '<rect width="100%" height="100%" rx="14" fill="#0b0f14"/>',
        '<rect x="0.5" y="0.5" width="calc(100% - 1px)" height="calc(100% - 1px)" rx="13.5" fill="none" stroke="#273142"/>',
        '<circle cx="20" cy="21" r="5" fill="#ff6b7a"/>',
        '<circle cx="38" cy="21" r="5" fill="#f4bf75"/>',
        '<circle cx="56" cy="21" r="5" fill="#7bd88f"/>',
        f'<text x="{width / 2:.1f}" y="26" text-anchor="middle" fill="#7f8da3" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="12">{html.escape(title)}</text>',
        '<line x1="0" y1="42" x2="100%" y2="42" stroke="#202938"/>',
    ]
    for output_row, source_row in enumerate(range(first_row, last_row + 1)):
        y = header_height + padding / 2 + (output_row + 1) * line_height - 5
        current_color = None
        current_bold = False
        current_text = ""
        segment_start = 0
        row_buffer = terminal_screen.buffer[source_row]
        row_text = display[source_row].strip()
        row_override = None
        if any(
            label in row_text
            for label in ("OMP Chisel at Work", "Fresh off the Chisel", "CHISELED", "CHANGES")
        ):
            row_override = "#c099ff"
        elif row_text.startswith(("│  --- original", "│  - ")):
            row_override = "#ff8290"
        elif row_text.startswith(("│  +++ chiseled", "│  + ")):
            row_override = "#91e6a3"
        elif any(
            label in row_text
            for label in (
                "Model:",
                "Grounded in:",
                "Still unsent",
                "enter use this",
                "another pass",
                "keep original",
            )
        ):
            row_override = "#8b98ad"
        row_last_nonspace = max(
            (
                column
                for column in range(first_column, last_column + 1)
                if row_buffer[column].data != " "
            ),
            default=first_column,
        )
        for output_column, source_column in enumerate(
            range(first_column, last_column + 1)
        ):
            character = row_buffer[source_column]
            character_data = (
                " "
                if character.data == "│" and source_column == row_last_nonspace
                else character.data
            )
            color = character.fg
            if row_override is not None:
                shown_color = row_override
            elif isinstance(color, str) and color.startswith("#"):
                shown_color = color
            else:
                shown_color = color_map.get(str(color), color_map["default"])
            bold = bool(character.bold)
            if current_color is None:
                current_color = shown_color
                current_bold = bold
                segment_start = output_column
            if shown_color != current_color or bold != current_bold:
                if current_text.strip():
                    x = padding + segment_start * cell_width
                    weight = ' font-weight="700"' if current_bold else ""
                    svg.append(
                        f'<text x="{x:.1f}" y="{y:.1f}" fill="{current_color}"{weight} '
                        'font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" '
                        f'font-size="14">{html.escape(current_text)}</text>'
                    )
                current_color = shown_color
                current_bold = bold
                current_text = ""
                segment_start = output_column
            current_text += character_data
        if current_text.strip():
            x = padding + segment_start * cell_width
            weight = ' font-weight="700"' if current_bold else ""
            svg.append(
                f'<text x="{x:.1f}" y="{y:.1f}" fill="{current_color}"{weight} '
                'font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" '
                f'font-size="14">{html.escape(current_text)}</text>'
            )
    svg.append("</svg>\n")
    (capture_dir / f"{name}.svg").write_text("\n".join(svg), encoding="utf-8")


# Let OMP finish extension/provider initialization and focus the editor.
pump(1.2)
if process.poll() is not None:
    fail("OMP failed during startup")

# Escape must cancel an active request and preserve the original editor draft.
send(b"slow original")
send(kitty_shortcut(shortcut))
wait_for("OMP Chisel at Work")
wait_for("Shaping a sharper prompt")
capture_svg("chisel-invoking", "OMP Chisel at Work", "esc keep original")
send(b"\x1b")
pump(0.5)
if "Fresh off the Chisel" in decoded():
    fail("A cancelled Chisel pass reached the review screen")
if "slow original" not in plain_tail():
    fail("Cancelling Chisel did not preserve the original draft")

# Clear the preserved draft, then exercise review, replacement, and explicit submission.
send(b"\x03")  # Ctrl+C clears the editor
send(demo_draft.encode())
send(kitty_shortcut(shortcut, alternate=True))
wait_for("Fresh off the Chisel")
wait_for("CHISELED")
wait_for(optimized_draft[:48])
wait_for("Grounded in: workspace")
wait_for("fresh session")
wait_for("Still unsent")
wait_for("nothing gets submitted")
wait_for("use this")
wait_for("tune it")
wait_for("another pass")
wait_for("switch model")
wait_for("keep original")
capture_svg("chisel-review", "Fresh off the Chisel", "keep original")
send(b"\t")
wait_for("CHANGES")
wait_for("--- original")
wait_for("+++ chiseled")
capture_svg("chisel-comparison", "Fresh off the Chisel", "keep original")
send(b"\t")
wait_for("ORIGINAL")
send(b"\r")  # Use the chiseled draft; this must not submit.
wait_for("Chiseled draft ready")
wait_for("Still unsent. Submit normally when it looks right.")
wait_for("esc close")
send(b"\r")  # Keep the chiseled draft and close the confirmation overlay.
pump(0.6)
if "MAIN RECEIVED:" in decoded():
    fail("Using the chiseled draft submitted it to the conversation")

send(b"\r")  # Explicit normal editor submission.
wait_for(f"MAIN RECEIVED: {optimized_draft[:48]}", timeout=8.0)

# Exit cleanly with an empty editor after the faux response settles.
pump(0.3)
send(b"\x04")
# Keep draining the PTY while OMP shuts down. A configured runtime can render
# enough final UI output to fill the PTY buffer and otherwise block its own exit.
deadline = time.monotonic() + 5.0
while process.poll() is None and time.monotonic() < deadline:
    pump(0.1)
if process.poll() is None:
    fail("OMP did not exit cleanly after the smoke test")
if process.returncode != 0:
    fail(f"OMP exited with status {process.returncode}")

runtime_label = "configured package" if configured_runtime else "isolated extension"
print(
    f"OMP TUI smoke test passed ({runtime_label}, {shortcut}): Escape cancellation, "
    "chiseled/changes/original review, replacement, and explicit submission."
)
