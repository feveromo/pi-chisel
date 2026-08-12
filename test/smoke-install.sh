#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"
omp_bin=${OMP_BIN:-"$root/node_modules/.bin/omp"}
expected_version=$(node -p 'require("./package.json").devDependencies["@oh-my-pi/pi-coding-agent"]')
actual_version=$($omp_bin --version)
if [[ "$actual_version" != "omp/$expected_version" ]]; then
	printf 'Clean-install smoke requires omp/%s, got %s\n' "$expected_version" "$actual_version" >&2
	exit 1
fi

temporary_root=$(mktemp -d)
trap 'rm -rf "$temporary_root"' EXIT
home="$temporary_root/home"
plugins_dir="$home/.omp/plugins"
mkdir -p "$plugins_dir" "$home/.omp/agent"

package_name=$(node -p 'require("./package.json").name')
tarball_name=$(npm pack --ignore-scripts --pack-destination "$temporary_root" --silent)
tarball="$temporary_root/$tarball_name"
printf '{"name":"omp-chisel-clean-install","private":true,"dependencies":{}}\n' >"$plugins_dir/package.json"
(
	cd "$plugins_dir"
	bun add "$tarball" --exact --silent
)

env_args=("HOME=$home" "OMP_SKIP_SETUP=1")
plugin_list="$temporary_root/plugins.json"
env -u OMP_PROFILE -u PI_PROFILE -u PI_CODING_AGENT_DIR \
	-u XDG_CONFIG_HOME -u XDG_DATA_HOME -u XDG_STATE_HOME -u XDG_CACHE_HOME \
	"${env_args[@]}" "$omp_bin" plugin list --json >"$plugin_list"
installed_path=$(node - "$plugin_list" "$package_name" <<'NODE'
const fs = require("node:fs");
const [path, packageName] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(path, "utf8"));
const plugin = (payload.npm ?? []).find(
	(entry) => entry.name === packageName && entry.enabled === true,
);
if (!plugin?.path) {
	throw new Error(`OMP did not discover enabled plugin ${packageName}`);
}
process.stdout.write(plugin.path);
NODE
)
installed_entry=$(realpath "$installed_path/src/index.ts")
if [[ "$installed_entry" != "$temporary_root"/* ]]; then
	printf 'Packaged plugin resolved outside the clean install: %s\n' "$installed_entry" >&2
	exit 1
fi
if [[ -L "$installed_path" ]]; then
	printf 'Clean-install smoke unexpectedly resolved a linked checkout: %s\n' "$installed_path" >&2
	exit 1
fi

printf 'OMP %s discovered packaged %s at %s\n' \
	"$expected_version" "$package_name" "$installed_entry"
env -u OMP_PROFILE -u PI_PROFILE -u PI_CODING_AGENT_DIR \
	-u XDG_CONFIG_HOME -u XDG_DATA_HOME -u XDG_STATE_HOME -u XDG_CACHE_HOME \
	"${env_args[@]}" OMP_CHISEL_CONFIGURED=1 \
	OMP_CHISEL_SMOKE_SHORTCUT=ctrl+shift+k \
	OMP_BIN="$omp_bin" \
	python3 "$root/test/smoke-tui.py"
