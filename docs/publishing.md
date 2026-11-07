# Publishing OMP Chisel

Publish the OMP integration from the `main` branch as `omp-chisel`. The native Pi
build on the `pi` branch is published separately as `pi-chisel`; see that
branch's `docs/publishing.md`.

## Prepare a release

From the OMP checkout:

```bash
git branch --show-current # must be main
npm ci --ignore-scripts
npm run validate
```

`validate` ends by installing the packed plugin into an isolated OMP 18.4.0 and
driving it through the terminal smoke test. Run `npm run smoke:configured` too
when this checkout is linked into your own OMP.

Keep the version in step with the `pi` branch while `src/` matches it
(`git diff main pi -- src ':!src/host.ts'` prints nothing), so both packages
carry the same Chisel under the same number. Tag OMP releases `omp-vX.Y.Z`.

## Publish

Authenticate interactively; do not put npm tokens in the repository:

```bash
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm publish --dry-run
npm publish
```

The manifest sets the public npm registry and public access. Complete any npm
authentication or two-factor challenge presented during publication.

## Verify

```bash
npm view omp-chisel version keywords omp --json --registry=https://registry.npmjs.org/
```

Then install it into a clean OMP home and confirm `omp plugin list` shows
`omp-chisel` enabled. GitHub installs made before the npm release registered as
`pi-chisel`; the README tells those users to uninstall that copy first, so two
copies don't claim the same shortcut and commands.
