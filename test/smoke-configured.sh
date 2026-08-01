#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
pi_bin=${PI_BIN:-$(command -v pi)}
default_shortcut=$(grep -m1 -oE 'shortcut: "[^"]+"' "$root/src/config.ts" | cut -d'"' -f2)
output=$(mktemp)
ghostty_config=$(mktemp)
trap 'rm -f "$output" "$ghostty_config"' EXIT

if command -v ghostty >/dev/null 2>&1; then
  ghostty +show-config >"$ghostty_config"
  if grep -iF "$default_shortcut=" "$ghostty_config" | grep -ivE '=unbind$' >/dev/null; then
    printf 'Default shortcut %s is claimed by Ghostty:\n' "$default_shortcut" >&2
    grep -iF "$default_shortcut=" "$ghostty_config" >&2
    exit 1
  fi
  printf 'Default shortcut %s is unclaimed by effective Ghostty bindings.\n' "$default_shortcut"
fi

printf '%s\n' '{"type":"get_commands"}' \
  | PI_OFFLINE=1 timeout 30s "$pi_bin" \
      --mode rpc \
      --no-session \
      --no-context-files \
      --no-skills \
      --no-prompt-templates \
      >"$output"

jq -e --arg entry "$root/src/index.ts" '
  select(.type == "response" and .command == "get_commands")
  | .data.commands[]
  | select(.name == "prompt-optimize" and .sourceInfo.path == $entry)
' "$output" >/dev/null

printf 'Configured Pi runtime resolved prompt-optimize from %s\n' "$root/src/index.ts"
PI_CHISEL_CONFIGURED=1 python3 "$root/test/smoke-tui.py"
