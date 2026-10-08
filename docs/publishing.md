# Publishing Pi Chisel

Publish the native Pi integration from the `pi` branch. The `main` branch contains
the separate OMP integration and is intentionally private on npm.

The [Pi package catalog](https://pi.dev/packages) discovers npm packages with the
`pi-package` keyword. This branch already declares that keyword and the native
entry point in `pi.extensions`. There is no separate catalog submission step.

## Prepare a release

From the native Pi checkout:

```bash
git branch --show-current # must be pi
npm ci --ignore-scripts --legacy-peer-deps
npm run validate
```

`validate` includes a configured-runtime smoke check and expects this checkout to
be linked in the maintainer's Pi installation. The isolated smoke test is
`npm run test:smoke`.

Review the version and package contents before publishing. The first npm release
was `0.1.0`; subsequent releases need an unused npm version. The existing Git tag
`pi-v0.1.0` predates this npm release and is not a source tag for this artifact.

The catalog preview uses `pi.image`, pointing to the PNG shipped in npm release
`0.2.1` through jsDelivr. Keep that version-pinned URL for later releases unless
the screenshot changes. When replacing the screenshot, point the URL at the new
release containing it and verify the image URL after publishing.

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
npm view pi-chisel version keywords pi --json --registry=https://registry.npmjs.org/
```

After publication, users can install with:

```bash
pi install npm:pi-chisel
```

Run `/reload` in an existing Pi session. Check the catalog after npm indexing has
caught up; the catalog documentation does not promise a refresh interval.

Keep the npm command as the primary installation example in the README, retaining
the Git command as an alternative.
