#!/usr/bin/env python3
"""PTY smoke test for isolated or actively configured Pi using a faux provider."""

from __future__ import annotations

import atexit
import fcntl
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

from terminal_capture import TerminalCapture

ROOT = Path(__file__).resolve().parents[1]
PI = os.environ.get("PI_BIN") or shutil.which("pi")
if PI is None:
    raise SystemExit("pi is not on PATH")


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


shortcut = os.environ.get("PI_CHISEL_SMOKE_SHORTCUT", "ctrl+shift+k")
demo_draft = os.environ.get("PI_CHISEL_SMOKE_DRAFT", "make this clearer")
optimized_draft = os.environ.get(
    "PI_CHISEL_SMOKE_RESULT",
    "Please make this clearer while preserving the exact intent.",
)
capture_dir = os.environ.get("PI_CHISEL_CAPTURE_DIR")
version = (
    subprocess.check_output([PI, "--version"], text=True, timeout=10).strip()
    if capture_dir
    else ""
)
capture = TerminalCapture(capture_dir, f"Pi {version}")
configured_runtime = os.environ.get("PI_CHISEL_CONFIGURED") == "1"
config_dir = None if configured_runtime else tempfile.mkdtemp(prefix="pi-chisel-smoke-")
counter_dir = tempfile.mkdtemp(prefix="chisel-counter-")
counter_path = Path(counter_dir) / "requests"
master_fd, slave_fd = pty.openpty()
fcntl.ioctl(slave_fd, termios.TIOCSWINSZ, struct.pack("HHHH", 42, 120, 0, 0))

env = os.environ.copy()
env.update(
    {
        "PI_OFFLINE": "1",
        "PI_SKIP_VERSION_CHECK": "1",
        "TERM": "xterm-256color",
        "COLORTERM": "truecolor",
        "CHISEL_SMOKE_COUNTER": str(counter_path),
    }
)
if config_dir is not None:
    env["PI_CODING_AGENT_DIR"] = config_dir

command = [
    PI,
    "--no-session",
    "--no-context-files",
    "--no-skills",
    "--no-prompt-templates",
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
            str(ROOT / "src/prompt-optimizer.ts"),
        ]
    )
command.extend(
    [
        "--provider",
        "prompt-optimizer-faux",
        "--model",
        "faux-model",
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
    shutil.rmtree(counter_dir, ignore_errors=True)


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
        capture.feed(chunk)
        if len(output) > 1_000_000:
            del output[:-750_000]


def decoded() -> str:
    return output.decode("utf-8", errors="replace")


def wait_for(text: str, timeout: float = 8.0) -> None:
    deadline = time.monotonic() + timeout
    while text not in decoded():
        if process.poll() is not None:
            fail(f"Pi exited before rendering {text!r}")
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


def fail(message: str) -> None:
    raise AssertionError(f"{message}\n\n--- Pi output tail ---\n{plain_tail()}")


def request_count() -> int:
    try:
        return int(counter_path.read_text() or "0")
    except (FileNotFoundError, ValueError):
        return 0


def wait_requests(count: int) -> None:
    deadline = time.monotonic() + 8
    while request_count() < count:
        if time.monotonic() >= deadline:
            fail(f"Expected {count} optimizer requests, saw {request_count()}")
        pump(0.1)


# Wait for session_start after the TUI/input handlers initialize, not a cold-start guess.
deadline = time.monotonic() + 20
while not counter_path.exists():
    if process.poll() is not None or time.monotonic() >= deadline:
        fail("Pi did not initialize its interactive extension context")
    pump(0.1)
pump(0.2)

# Preflight is a real transmission boundary, not a post-hoc privacy claim.
send(b"/prompt-optimize-context inspect this draft")
send(b"\r")
wait_for("Before Chisel sends")
if request_count() != 0:
    fail("Initial context inspection sent a provider request")
capture.save("pi-chisel-context", "Before Chisel sends", "esc back")
send(b"\x1b")
send(b"\x03")

# Escape must cancel an active request and preserve the original editor draft.
send(b"slow original")
send(kitty_shortcut(shortcut))
wait_for("Pi Chisel at Work")
wait_for("Shaping a sharper prompt")
wait_for("keep original")
capture.save("pi-chisel-invoking", "Pi Chisel at Work", "keep original")
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
# Configured users can open on any review view. Navigate explicitly without
# changing their saved preferences: changes -> original -> rewrite.
send(b"d")
wait_for("CHANGES")
send(b"\t")
wait_for("ORIGINAL")
send(b"\t")
wait_for("CHISELED")
wait_for(optimized_draft[:48])
wait_for("Context supplied: workspace")
wait_for("Still unsent")
wait_for("nothing gets submitted")
wait_for("use this")
wait_for("tune it")
wait_for("another pass")
wait_for("switch model")
wait_for("keep original")
capture.save("pi-chisel-review", "Fresh off the Chisel", "keep original")
send(b"\t")
wait_for("CHANGES")
wait_for("--- original")
wait_for("+++ chiseled")
capture.save("pi-chisel-comparison", "Fresh off the Chisel", "keep original")
send(b"\t")
wait_for("ORIGINAL")

# Context exclusion regenerates; feedback and failed/cancelled retries keep a candidate.
send(b"c")
wait_for("Context supplied")
if request_count() != 2:
    fail("Opening the review inspector sent a request")
send(b"0")
send(b"\r")
wait_requests(3)
wait_for("previous candidate")
pump(0.3)
send(b"r")
wait_for("what should change?")
send(b"Keep it casual.")
send(b"\r")
wait_requests(4)
pump(0.4)
send(b"r")
send(b"CHISEL_SMOKE_FAIL_RETRY")
send(b"\r")
wait_requests(5)
wait_for("Synthetic retry failure")
send(b"r")
send(b"CHISEL_SMOKE_SLOW_RETRY")
send(b"\r")
wait_requests(6)
send(b"\x1b")
wait_for("Pass cancelled")
send(b"b")
pump(0.2)
if request_count() != 6:
    fail("Candidate history navigation sent a request")
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
# Keep draining the PTY while Pi shuts down. A configured runtime can render
# enough final UI output to fill the PTY buffer and otherwise block its own exit.
deadline = time.monotonic() + 5.0
while process.poll() is None and time.monotonic() < deadline:
    pump(0.1)
if process.poll() is None:
    fail("Pi did not exit cleanly after the smoke test")
if process.returncode != 0:
    fail(f"Pi exited with status {process.returncode}")

runtime_label = "configured runtime" if configured_runtime else "isolated extension"
print(
    f"Pi TUI smoke test passed ({runtime_label}, {shortcut}): Escape cancellation, "
    "preflight without transmission, context exclusion, steerable retry, failure/cancel recovery, "
    "candidate history, review, replacement, and explicit submission."
)
