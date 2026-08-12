#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
omp_bin=${OMP_BIN:-$(command -v omp)}
default_shortcut=$(grep -m1 -oE 'shortcut: "[^"]+"' "$root/src/config.ts" | cut -d'"' -f2)
agent_dir=${PI_CODING_AGENT_DIR:-"$HOME/.omp/agent"}
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

"$omp_bin" plugin list --json >"$output"

plugin_path=$(jq -er '
  .npm[]
  | select(.name == "pi-chisel" and .enabled == true)
  | .path
' "$output")
configured_entry=$(realpath "$plugin_path/src/index.ts")
working_entry=$(realpath "$root/src/index.ts")
if [[ "$configured_entry" != "$working_entry" ]]; then
	printf 'Configured OMP plugin resolves to %s, expected %s\n' \
		"$configured_entry" "$working_entry" >&2
	exit 1
fi

printf 'Configured OMP plugin resolves prompt-optimize from %s\n' "$working_entry"
OMP_CHISEL_CONFIGURED=1 OMP_CHISEL_SMOKE_SHORTCUT="$shortcut" OMP_BIN="$omp_bin" \
	python3 "$root/test/smoke-tui.py"
