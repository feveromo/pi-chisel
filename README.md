# Pi Chisel

Pi Chisel is a native Pi extension that turns rough drafts into clear, send-ready prompts without submitting them. The original stays in the editor until you review the rewrite and explicitly choose to use it, edit it, compare versions, retry, switch models, or keep what you wrote.

This release is verified against `@earendil-works/pi-coding-agent` **0.84.1**.

## Install

Install the pinned native Pi release from GitHub:

```bash
pi install git:github.com/feveromo/pi-chisel@pi-v0.1.0
```

Run `/reload` in an open Pi session, or start a new one, then verify the package:

```bash
pi list
```

Try it for one session without installing:

```bash
pi -e git:github.com/feveromo/pi-chisel@pi-v0.1.0
```

For local development:

```bash
git clone --branch pi https://github.com/feveromo/pi-chisel.git
cd pi-chisel
npm ci --ignore-scripts --legacy-peer-deps
pi install .
```

## Use

1. Type a draft in Pi's editor.
2. Press **Ctrl+Shift+K**.
3. Review the result **Fresh off the Chisel**:
   - **Enter** or **A** replaces the draft without submitting it.
   - **E** opens the complete rewrite for editing.
   - **Tab** or **V** cycles rewrite, changes, and original views.
   - **D** / **O** jumps to changes or the original.
   - **R** runs another pass with an additional request.
   - **M** opens the optimizer model picker.
   - **Escape** or **Q** keeps the original.
4. After replacement, press **U** to restore the previous draft, or close the confirmation to keep the rewrite.
5. Submit normally when you're ready.

Commands:

- `/prompt-optimize <draft>` optimizes an explicit draft. Pi slash commands occupy the editor and may trim the outer command line, so use the shortcut when byte-for-byte preservation matters.
- `/prompt-optimize-model` chooses the optimizer model.
- `/prompt-optimize-settings` configures context, budget, intensity, preview, model, and shortcut.
- `/prompt-optimize-restore` restores the most recently replaced draft while it remains available in memory.

## Models and settings

Pi Chisel follows the current chat model by default. Pinning another model affects only the optimizer and never changes the conversation model. The extension uses Pi's registered provider and resolved authentication, including OAuth credentials, provider headers, provider-scoped environment, and credential-specific base URLs.

Settings are written atomically with mode `0600` to:

```text
~/.pi/agent/prompt-optimizer.json
```

The file contains model IDs and UI preferences, never credentials or drafts. Configure it through `/prompt-optimize-settings`; use Pi's `/login` or `/model` first when a provider isn't configured.

## Context and privacy

- `auto` includes a bounded trusted-workspace snapshot and adapts recent-session context to the draft.
- `recent` uses the workspace snapshot plus as much recent-session context as fits the configured budget.
- `none` sends only the draft and optimizer instruction.

Pi Chisel doesn't persist drafts, context, responses, credentials, or telemetry. Its provider request uses a fresh side-channel session ID, no tools, no prompt caching, and no provider retries. It never enters Pi's transcript or main agent loop.

The exact draft and output allowance always take priority when context must shrink. Workspace and session context are marked as untrusted evidence, thinking and tool traffic are excluded, and untrusted projects aren't inspected beyond workspace identity.

## Safety

- Escape aborts the active request; a 120-second timeout does the same.
- Empty, unchanged, malformed, truncated, errored, unauthenticated, rate-limited, and network-failed responses never replace the draft.
- Dynamic terminal content is sanitized before rendering.
- Concurrent invocations are rejected.
- Replacement and restore verify that the editor still contains the expected text before writing.
- Shutdown and `/reload` abort active work and dismiss temporary UI.

Pi 0.84.1 exposes the whole editor buffer but no selection or cursor-range operation, so Pi Chisel optimizes the complete draft.

## Develop and test

```bash
npm ci --ignore-scripts --legacy-peer-deps
npm run validate
```

`npm run validate` runs formatting and lint checks, TypeScript, unit tests, an isolated Pi PTY smoke test, and a configured-runtime smoke test. Implementation details are in [`docs/architecture.md`](docs/architecture.md).

Pi Chisel is available under the [MIT License](LICENSE).
