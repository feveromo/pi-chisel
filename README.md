# Pi Chisel

Pi Chisel turns rough drafts into clear, send-ready prompts without submitting them. Your original stays in the editor until you review the rewrite and explicitly choose what to do next.

- **Review before replacing** — use the rewrite, edit it, compare versions, retry, switch models, or keep the original.
- **Nothing is auto-submitted** — accepting a rewrite only updates the editor.
- **Grounded when useful** — optionally includes bounded workspace and recent-session context.
- **Private by design** — drafts and responses aren't persisted or added to the conversation transcript.
- **Provider-independent** — follows the current chat model or uses a separately pinned optimizer model.

## See it in action

Invoke Pi Chisel while the original draft remains untouched:

![Pi Chisel generation overlay showing the selected faux model, bounded workspace grounding, and Escape-to-cancel action](docs/images/pi-chisel-invoking.svg)

Review the rewritten draft and choose the next action:

![Pi Chisel review overlay showing a synthetic release-audit prompt, unsent status, and review actions](docs/images/pi-chisel-review.svg)

Compare the original and rewritten versions before replacing anything:

![Pi Chisel comparison overlay showing the synthetic original and rewritten release-audit prompts with use and keep-original actions](docs/images/pi-chisel-comparison.svg)

The screenshots use a deterministic faux provider and synthetic content only.

## Install

Pi Chisel currently ships with a native Oh My Pi integration, verified against OMP **17.2.11** and its canonical `@oh-my-pi/*` APIs. Later versions may work but aren't part of this release's tested compatibility boundary.

Requirements:

- `omp --version` reports `omp/17.2.11`.
- A model is configured through `/login` or `/model`.

Install from GitHub:

```bash
omp plugin install github:feveromo/pi-chisel
```

Run `/reload` in an open session, or start a new one, then verify the installation:

```bash
omp plugin list
```

To work from a checkout instead:

```bash
git clone https://github.com/feveromo/pi-chisel.git
cd pi-chisel
npm ci --ignore-scripts
omp plugin link .
```

Run directly without installing:

```bash
omp --no-extensions -e ./src/index.ts
```

Uninstall with:

```bash
omp plugin uninstall pi-chisel
```

## Use

1. Type a draft in the editor.
2. Press **Ctrl+Shift+K**.
3. Review the result **Fresh off the Chisel**:
   - **Enter** or **A** — replace the draft without submitting it.
   - **E** — edit the complete rewrite.
   - **Tab** or **V** — cycle rewrite, changes, and original views.
   - **D** / **O** — jump to changes or the original.
   - **R** — run another pass with an additional request.
   - **M** — choose the optimizer model.
   - **Escape** or **Q** — keep the original.
4. After replacement, press **U** to restore the previous draft, or close the confirmation to keep the rewrite.
5. Submit normally when you're ready.

Commands:

- `/prompt-optimize <draft>` — optimize an explicit draft. Because slash commands occupy the editor and may trim the outer command line, use the shortcut when byte-for-byte preservation matters.
- `/prompt-optimize-model` — choose the optimizer model.
- `/prompt-optimize-settings` — configure context, budget, intensity, preview, model, and shortcut.
- `/prompt-optimize-restore` — restore the most recently replaced draft when it's still available in memory.

## Models and settings

Pi Chisel follows the current chat model by default. Pinning another model affects only the optimizer; it doesn't change the conversation model. If the pinned model becomes unavailable, Pi Chisel reports the fallback and uses the current model for that pass.

The OMP integration uses the host's authenticated model registry, credential resolver, provider headers, and credential-specific base URL. OAuth-backed models therefore follow the same authentication path as the active session.

Run `/prompt-optimize-settings` to configure Pi Chisel. Settings are written atomically with mode `0600` to:

```text
~/.omp/agent/prompt-optimizer.json
```

The file contains model IDs and UI preferences, never credentials or drafts.

Default configuration:

```json
{
  "version": 1,
  "model": null,
  "contextMode": "auto",
  "contextTokenBudget": 1800,
  "intensity": "standard",
  "shortcut": "ctrl+shift+k",
  "previewMode": "optimized"
}
```

### Context modes

- `auto` — includes a bounded workspace snapshot and adapts recent-session context to the draft.
- `recent` — uses the workspace snapshot plus as much recent-session context as fits the configured budget.
- `none` — sends only the draft and optimizer instruction.

Workspace context can include the project name, relative working directory, branch, manifest summary, README overview, top-level landmarks, and in-project guidance already loaded by the host. Absolute paths aren't added, guidance outside the project root is excluded, and metadata-file symlinks aren't followed.

Session context includes recent user and assistant text plus compaction and branch summaries. It excludes thinking, tool calls and results, hidden entries, extension metadata, telemetry, and diagnostics. The exact draft and output allowance always take priority when context must shrink.

OMP 17.2.11 doesn't expose the former Pi project-trust predicate to extensions. Use `none` when Pi Chisel must not inspect or send workspace or session context.

### Intensity

- `light` — stays close to the original wording, structure, and length.
- `standard` — improves clarity, structure, specificity, and ordering.
- `strong` — reconstructs more aggressively while preserving intent and constraints.

The optimizer instruction lives in [`src/optimizer-instruction.ts`](src/optimizer-instruction.ts).

## Privacy and safety

Every pass sends the draft to the selected model provider. `auto` and `recent` also send the bounded context described above; `none` sends only the draft and optimizer instruction. Provider-side retention is governed by the selected provider and account.

Pi Chisel doesn't persist drafts, context, responses, credentials, or telemetry. Its provider request uses a fresh side-channel session ID, no tools, and no prompt caching, and it doesn't enter the conversation transcript or main agent loop.

Additional safeguards:

- Escape aborts the active request immediately; a 120-second timeout does the same.
- Empty, unchanged, malformed, truncated, errored, unauthenticated, rate-limited, and network-failed responses never replace the draft.
- Dynamic terminal content is sanitized before rendering.
- Workspace and session context are explicitly marked as untrusted evidence.
- Concurrent invocations are rejected.
- Replacement and restore both verify that the editor still contains the expected text before writing.
- Shutdown and reload abort active work and dismiss temporary UI.

The current OMP API exposes the whole editor buffer but no selection or cursor-range operation, so this integration optimizes the complete draft. The default **Ctrl+Shift+K** binding is unclaimed by OMP 17.2.11, but a terminal or desktop environment may intercept it; change it through `/prompt-optimize-settings` if needed.

## Develop and test

```bash
npm ci --ignore-scripts
npm run validate
```

`npm run validate` runs formatting and lint checks, TypeScript, unit tests, a production dependency audit, package inspection, an OMP 17.2.11 PTY smoke test, and a clean packaged-install smoke test.

After linking the checkout, verify the active host configuration too:

```bash
npm run smoke:configured
```

Implementation details and verified integration hooks are documented in [`docs/architecture.md`](docs/architecture.md). Report vulnerabilities through [`SECURITY.md`](SECURITY.md). Pi Chisel is available under the [MIT License](LICENSE).
