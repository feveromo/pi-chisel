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

ROOT = Path(__file__).resolve().parents[1]
PI = shutil.which("pi")
if PI is None:
    raise SystemExit("pi is not on PATH")

configured_runtime = os.environ.get("PI_CHISEL_CONFIGURED") == "1"
config_dir = None if configured_runtime else tempfile.mkdtemp(prefix="pi-chisel-smoke-")
master_fd, slave_fd = pty.openpty()
fcntl.ioctl(slave_fd, termios.TIOCSWINSZ, struct.pack("HHHH", 42, 120, 0, 0))

env = os.environ.copy()
env.update(
    {
        "PI_OFFLINE": "1",
        "PI_SKIP_VERSION_CHECK": "1",
        "TERM": "xterm-256color",
        "COLORTERM": "truecolor",
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
            str(ROOT / "src/index.ts"),
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


atexit.register(cleanup)


def pump(duration: float = 0.1) -> None:
    deadline = time.monotonic() + duration
    while time.monotonic() < deadline:
        ready, _, _ = select.select([master_fd], [], [], max(0.0, deadline - time.monotonic()))
        if not ready:
            break
        try:
            chunk = os.read(master_fd, 65536)
        except OSError:
            break
        if not chunk:
            break
        output.extend(chunk)
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


# Let Pi finish extension/provider initialization and focus the editor.
pump(1.2)
if process.poll() is not None:
    fail("Pi failed during startup")

# Escape must cancel an active request and preserve the original editor draft.
send(b"slow original")
send(b"\x1b[112;7u")  # Ctrl+Alt+P in Kitty CSI-u form
wait_for("Pi Chisel at Work")
wait_for("Shaping a sharper prompt")
send(b"\x1b")
pump(0.5)
if "Fresh off the Chisel" in decoded():
    fail("A cancelled Chisel pass reached the review screen")
if "slow original" not in plain_tail():
    fail("Cancelling Chisel did not preserve the original draft")

# Clear the preserved draft, then exercise review, replacement, and explicit submission.
send(b"\x03")  # Ctrl+C clears the editor
send(b"make this clearer")
send(b"\x1b[112::112;7u")  # Alternate-key form emitted by enhanced terminals
wait_for("Fresh off the Chisel")
wait_for("CHISELED")
wait_for("Please make this clearer")
wait_for("Grounded in: workspace")
wait_for("fresh session")
wait_for("Still unsent")
wait_for("nothing gets submitted")
wait_for("use this")
wait_for("tune it")
wait_for("another pass")
wait_for("switch model")
wait_for("keep original")
send(b"\t")
wait_for("CHANGES")
wait_for("--- original")
wait_for("+++ chiseled")
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
wait_for("MAIN RECEIVED: Please make this clearer", timeout=8.0)

# Exit cleanly with an empty editor after the faux response settles.
pump(0.3)
send(b"\x04")
try:
    process.wait(timeout=5)
except subprocess.TimeoutExpired:
    fail("Pi did not exit cleanly after the smoke test")
if process.returncode != 0:
    fail(f"Pi exited with status {process.returncode}")

runtime_label = "configured package" if configured_runtime else "isolated extension"
print(
    f"Pi TUI smoke test passed ({runtime_label}): Ctrl+Alt+P, Escape cancellation, "
    "chiseled/changes/original review, replacement, and explicit submission."
)
