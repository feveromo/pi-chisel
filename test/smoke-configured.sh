#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
pi_bin=${PI_BIN:-$(command -v pi)}
default_shortcut=$(grep -m1 -oE 'shortcut: "[^"]+"' "$root/src/config.ts" | cut -d'"' -f2)
agent_dir=${PI_CODING_AGENT_DIR:-"$HOME/.pi/agent"}
optimizer_config="$agent_dir/prompt-optimizer.json"
shortcut=$default_shortcut
if [[ -f "$optimizer_config" ]]; then
  configured_shortcut=$(jq -er '.shortcut | select(type == "string" and length > 0)' "$optimizer_config" 2>/dev/null || true)
  if [[ -n "$configured_shortcut" ]]; then
    shortcut=$configured_shortcut
  fi
fi
output=$(mktemp)
ghostty_config=$(mktemp)
trap 'rm -f "$output" "$ghostty_config"' EXIT

if command -v ghostty >/dev/null 2>&1; then
  ghostty +show-config >"$ghostty_config"
  if grep -iF "$shortcut=" "$ghostty_config" | grep -ivE '=unbind$' >/dev/null; then
    printf 'Effective shortcut %s is claimed by Ghostty:\n' "$shortcut" >&2
    grep -iF "$shortcut=" "$ghostty_config" >&2
    exit 1
  fi
  printf 'Effective shortcut %s is unclaimed by effective Ghostty bindings.\n' "$shortcut"
fi

PI_BIN="$pi_bin" OUTPUT="$output" PI_OFFLINE=1 python3 - <<'PY'
import os
import subprocess
from pathlib import Path

command = [
    os.environ["PI_BIN"],
    "--mode",
    "rpc",
    "--no-session",
    "--no-context-files",
    "--no-skills",
    "--no-prompt-templates",
]
result = subprocess.run(
    command,
    input='{"type":"get_commands"}\n',
    text=True,
    capture_output=True,
    timeout=30,
    env=os.environ,
    check=False,
)
Path(os.environ["OUTPUT"]).write_text(result.stdout)
if result.returncode != 0:
    raise SystemExit(result.stderr or f"Pi RPC exited with {result.returncode}")
PY

python3 - "$output" "$root/src/prompt-optimizer.ts" <<'PY'
import json
import re
import sys
from pathlib import Path

expected = Path(sys.argv[2]).resolve()
commands = []
for line in Path(sys.argv[1]).read_text().splitlines():
    response = json.loads(line)
    if response.get("type") == "response" and response.get("command") == "get_commands":
        commands = response.get("data", {}).get("commands", [])

for name in ("prompt-optimize", "prompt-optimize-context"):
    command = next((item for item in commands if item.get("name") == name), None)
    if not command or not command.get("sourceInfo", {}).get("path"):
        raise SystemExit(f"Configured Pi did not register {name}")
    entry = Path(command["sourceInfo"]["path"]).expanduser().resolve()
    if entry != expected:
        # Allow one plain re-export used to give a local extension a display name.
        wrapper = re.fullmatch(r'''\s*(?://[^\n]*\n\s*)*export\s*\{\s*default\s*\}\s*from\s*["']([^"']+)["'];?\s*''', entry.read_text())
        if not wrapper or (entry.parent / wrapper[1]).resolve() != expected:
            raise SystemExit(f"{name} resolves to {entry}, not {expected} or its plain re-export")
PY

printf 'Configured Pi runtime resolved prompt-optimize from %s\n' "$root/src/prompt-optimizer.ts"
PI_CHISEL_CONFIGURED=1 PI_CHISEL_SMOKE_SHORTCUT="$shortcut" PI_BIN="$pi_bin" \
  python3 "$root/test/smoke-tui.py"
