#!/usr/bin/env python3
"""Record the README demo GIF from a real Pi session and a real model.

Unlike the screenshots, this sends one live request: the rewrite is whatever the
model returns, so every recording differs. Pi runs with an isolated agent
directory in a generated demo project, so frames show none of your settings,
sessions, or files. See docs/screenshots.md for the full command.
"""

from __future__ import annotations

import argparse
import atexit
import fcntl
import json
import os
import pty
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

import pyte

from terminal_capture import render_screen_svg, terminal_decoder

ROOT = Path(__file__).resolve().parents[1]
COLUMNS, LINES = 100, 36
DEFAULT_DRAFT = (
    "login breaks when ppl type there email w/ capitals?? "
    "fix it but dont touch the session stuff"
)
# Chisel reads the manifest, README start, and top-level names; file bodies only
# need to exist so the listing looks like a real project.
DEMO_PROJECT = {
    "README.md": "# tasknest\n\nA small team task board: an Express API with SQLite storage and cookie sessions.\n\n```bash\nnpm install\nnpm test\n```\n",
    "package.json": json.dumps(
        {
            "name": "tasknest",
            "version": "1.4.0",
            "private": True,
            "type": "module",
            "scripts": {"start": "node src/server.js", "test": "node --test"},
            "dependencies": {"better-sqlite3": "^12.2.0", "express": "^5.1.0"},
        },
        indent=2,
    )
    + "\n",
    "src/server.js": "import { app } from './app.js';\napp.listen(3000);\n",
    "src/app.js": "import express from 'express';\nexport const app = express();\n",
    "src/auth/login.js": "export async function login(db, email, password) {}\n",
    "src/auth/session.js": "export function createSession(res, user) {}\n",
    "test/login.test.js": "import test from 'node:test';\n",
}
RASTERIZE = r"""
import sys, cairo, gi
gi.require_version("Rsvg", "2.0")
from gi.repository import Rsvg
scale, width, height = float(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
for path in sys.argv[4:]:
    surface = cairo.ImageSurface(cairo.FORMAT_RGB24, round(width * scale), round(height * scale))
    viewport = Rsvg.Rectangle()
    viewport.x = viewport.y = 0
    viewport.width, viewport.height = width * scale, height * scale
    assert Rsvg.Handle.new_from_file(path).render_document(cairo.Context(surface), viewport)
    surface.write_to_png(path[:-4] + ".png")
"""


def kitty_shortcut(value: str) -> bytes:
    *modifiers, key = value.lower().split("+")
    bits = {"shift": 1, "alt": 2, "ctrl": 4, "super": 8}
    code = 1 + sum(bits[modifier] for modifier in modifiers)
    shifted = ord(key.upper()) if "shift" in modifiers else ord(key)
    return f"\x1b[{ord(key)}::{shifted};{code}u".encode()


parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
parser.add_argument("output", type=Path, help="GIF to write")
parser.add_argument("--model", required=True, help="provider/model for Chisel to use")
parser.add_argument(
    "--extension",
    action="append",
    default=[],
    help="extra Pi extension to load, such as the model's provider",
)
parser.add_argument(
    "--agent-file",
    action="append",
    default=[],
    type=Path,
    help="non-secret config file to copy into the isolated agent directory",
)
parser.add_argument("--draft", default=DEFAULT_DRAFT)
parser.add_argument("--shortcut", default="ctrl+shift+k")
parser.add_argument("--scale", type=float, default=2.0)
parser.add_argument("--keep-frames", type=Path, help="also keep SVG/PNG frames here")
args = parser.parse_args()

pi_bin = os.environ.get("PI_BIN") or shutil.which("pi")
if pi_bin is None:
    raise SystemExit("pi is not on PATH")
rsvg_python = os.environ.get("RSVG_PYTHON", "/usr/bin/python3")
provider, _, model = args.model.partition("/")
version = subprocess.check_output([pi_bin, "--version"], text=True, timeout=10).strip()

# A fixed path keeps the footer readable; a random temp suffix would show in every frame.
workspace = Path(tempfile.gettempdir()) / "tasknest"
if workspace.exists():
    raise SystemExit(f"{workspace} already exists; remove it or finish the other recording")
scratch = Path(tempfile.mkdtemp(prefix="pi-chisel-demo-"))
agent_dir, frames_dir = scratch / "agent", scratch / "frames"
for directory in (agent_dir, frames_dir):
    directory.mkdir()
(agent_dir / "settings.json").write_text(json.dumps({"quietStartup": True}) + "\n")
for path in args.agent_file:
    shutil.copy(path.expanduser(), agent_dir / path.name)
for name, text in DEMO_PROJECT.items():
    (workspace / name).parent.mkdir(parents=True, exist_ok=True)
    (workspace / name).write_text(text)
subprocess.run(["git", "init", "-q", "-b", "main"], cwd=workspace, check=True)

master_fd, slave_fd = pty.openpty()
fcntl.ioctl(slave_fd, termios.TIOCSWINSZ, struct.pack("HHHH", LINES, COLUMNS, 0, 0))
env = os.environ | {
    "PI_CODING_AGENT_DIR": str(agent_dir),
    "PI_SKIP_VERSION_CHECK": "1",
    "TERM": "xterm-256color",
    "COLORTERM": "truecolor",
}
command = [pi_bin, "--no-session", "--no-context-files", "--no-skills"]
command += ["--no-prompt-templates", "--approve", "--no-extensions"]
for extension in [*args.extension, str(ROOT / "src/prompt-optimizer.ts")]:
    command += ["-e", str(Path(extension).expanduser())]
command += ["--provider", provider, "--model", model]
process = subprocess.Popen(
    command,
    cwd=workspace,
    env=env,
    stdin=slave_fd,
    stdout=slave_fd,
    stderr=slave_fd,
    start_new_session=True,
    close_fds=True,
)
os.close(slave_fd)


def cleanup() -> None:
    with suppress(OSError):
        os.close(master_fd)
    if process.poll() is None:
        with suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            with suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
    shutil.rmtree(scratch, ignore_errors=True)
    shutil.rmtree(workspace, ignore_errors=True)


atexit.register(cleanup)
screen = pyte.Screen(COLUMNS, LINES)
stream = pyte.Stream(screen)
decoder = terminal_decoder()
frames: list[list] = []
caption = ""


def pump(duration: float) -> None:
    deadline = time.monotonic() + duration
    while (remaining := deadline - time.monotonic()) > 0:
        ready, _, _ = select.select([master_fd], [], [], remaining)
        if not ready:
            return
        try:
            chunk = os.read(master_fd, 65536)
        except OSError:
            return
        if not chunk:
            return
        stream.feed(decoder.decode(chunk))


def visible(text: str) -> bool:
    return text in "\n".join(screen.display)


def wait_for(text: str, timeout: float = 20.0) -> None:
    deadline = time.monotonic() + timeout
    while not visible(text):
        if process.poll() is not None or time.monotonic() > deadline:
            tail = "\n".join(line.rstrip() for line in screen.display)
            raise SystemExit(f"Timed out waiting for {text!r}\n\n{tail}")
        pump(0.1)


def wait_gone(text: str, timeout: float = 10.0) -> None:
    deadline = time.monotonic() + timeout
    while visible(text):
        if process.poll() is not None or time.monotonic() > deadline:
            raise SystemExit(f"Timed out waiting for {text!r} to close")
        pump(0.1)


def snap(seconds: float) -> None:
    svg = render_screen_svg(screen, caption)
    if frames and frames[-1][0] == svg:
        frames[-1][1] += seconds
    else:
        frames.append([svg, seconds])


def send(data: bytes, settle: float = 0.08) -> None:
    os.write(master_fd, data)
    pump(settle)


wait_for(model)
pump(1.0)
caption = "type a rough draft"
snap(1.0)
for char in args.draft:
    send(char.encode(), 0.04)
    snap(0.05)
snap(1.0)

caption = "+".join(part.capitalize() for part in args.shortcut.split("+")) + "  ·  Chisel it"
send(kitty_shortcut(args.shortcut))
wait_for("Chisel · working")
# Show the spinner briefly; the model's real wait is not worth replaying.
for _ in range(14):
    pump(0.12)
    snap(0.12)
wait_for("Fresh off the Chisel", timeout=180)
wait_for("keep original")
pump(0.4)
caption = "review the rewrite  ·  nothing is sent yet"
snap(5.0)

send(b"d")
wait_for("CHANGES")
pump(0.3)
caption = "D  ·  see exactly what changed"
snap(4.0)

send(b"\r")
wait_for("Chiseled draft ready")
pump(0.3)
caption = "Enter  ·  use it"
snap(2.0)
send(b"\r")
wait_gone("Chiseled draft ready")
pump(0.4)
caption = "your editor now holds the rewrite  ·  send it when ready"
snap(4.5)

send(b"\x03")
send(b"\x04", 0.3)
deadline = time.monotonic() + 8
while process.poll() is None and time.monotonic() < deadline:
    pump(0.1)

width = round(COLUMNS * 8.8 + 44)
height = 42 + LINES * 21 + 44
paths = []
for index, (svg, _) in enumerate(frames):
    path = frames_dir / f"frame{index:04d}.svg"
    path.write_text(svg, encoding="utf-8")
    paths.append(str(path))
subprocess.run(
    [rsvg_python, "-I", "-c", RASTERIZE, str(args.scale), str(width), str(height), *paths],
    check=True,
)
pngs = [path[:-4] + ".png" for path in paths]
timeline = frames_dir / "frames.txt"
entries = []
for png, (_, seconds) in zip(pngs, frames):
    entries += [f"file '{Path(png).name}'", f"duration {seconds:.2f}"]
# The concat demuxer drops the last duration unless its file is listed again.
entries.append(f"file '{Path(pngs[-1]).name}'")
timeline.write_text("\n".join(entries) + "\n")
if args.keep_frames:
    shutil.copytree(frames_dir, args.keep_frames, dirs_exist_ok=True)
args.output.parent.mkdir(parents=True, exist_ok=True)
source = ["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(timeline)]
palette = frames_dir / "palette.png"
# One palette for the whole clip keeps colors from shifting between frames.
subprocess.run(
    [*source, "-vf", "palettegen=max_colors=128:stats_mode=full", str(palette)],
    check=True,
)
subprocess.run(
    [*source, "-i", str(palette), "-lavfi", "paletteuse=dither=none:diff_mode=rectangle"]
    + ["-fps_mode", "passthrough", "-loop", "0", str(args.output.resolve())],
    check=True,
)
total = sum(seconds for _, seconds in frames)
size = args.output.stat().st_size
print(
    f"Wrote {args.output}: {len(frames)} frames, {total:.1f}s, {size / 1024:.0f} KiB "
    f"(Pi {version}, {args.model})"
)
