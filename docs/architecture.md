# Verified OMP 17.2.11 architecture

This plugin is designed and tested against OMP `17.2.11`. Source references below are relative to `node_modules/@oh-my-pi/pi-coding-agent` unless another package is named.

## Plugin discovery and lifetime

OMP packages declare extension entry points in the `omp.extensions` package manifest field. This repository exposes `./src/index.ts`, uses the `omp-plugin` keyword, and can be linked in place with `omp plugin link .`.

`src/extensibility/plugins/types.ts` defines the plugin manifest, while `src/extensibility/extensions/loader.ts` loads the TypeScript factory and binds one `ExtensionAPI` to the active session. `src/extensibility/extensions/types.ts` defines command, shortcut, event, context, and UI contracts.

Chisel's factory in `src/index.ts` performs only bounded setup:

- Load and validate the local optimizer configuration.
- Register one shortcut and four slash commands.
- Construct one controller that owns invocation and replacement state.
- Dispose that controller on `session_shutdown`.

No provider request or persistent UI starts during extension loading. Reloading OMP creates a new extension instance; shutdown aborts any active request and dismisses its overlay.

## Keyboard dispatch and editor access

`ExtensionAPI.registerShortcut()` is OMP's public shortcut boundary. Chisel registers the configured `KeyId`, whose default is `ctrl+shift+k`. The settings overlay receives OMP's resolved keybinding map, normalizes modifier order, and rejects a conflict before persisting a replacement shortcut. OMP still performs the final registration-time conflict check against other extensions.

`ExtensionUIContext.getEditorText()` and `setEditorText()` expose the whole unsent draft. OMP 17.2.11 does not expose a cursor position, selection range, or replace-selection operation through the extension context, so Chisel intentionally optimizes the whole editor buffer. It does not intercept terminal input or patch OMP's editor.

The shortcut captures the editor text without submitting it. The slash-command fallback accepts the draft as its argument because entering a slash command has already replaced the editor contents.

## Native temporary UI

`ctx.ui.custom()` temporarily gives an extension component focus. Chisel uses OMP's overlay compositor rather than replacing the chat layout or installing a widget.

The UI is built from canonical OMP exports:

- `@oh-my-pi/pi-tui`: `Container`, `Text`, `Input`, `SelectList`, `SettingsList`, `CancellableLoader`, printable-key decoding, matching, and truncation.
- `@oh-my-pi/pi-coding-agent`: `DynamicBorder`, `Theme`, extension context types, model registry types, and settings-list theming.

All views are transient. Generation shows **OMP Chisel at Work**; review shows **Fresh off the Chisel**; replacement shows **Chiseled draft ready**. Escape reaches the focused component, aborts the provider stream, and resolves the custom UI call without changing the editor.

## Grounding context

The OMP context exposes `cwd`, `getSystemPrompt()`, and a read-only `sessionManager`. Chisel uses those public APIs only.

Grounding has two independently bounded layers:

1. **Workspace evidence.** `src/project-context.ts` finds a project root from the active working directory and collects a small manifest summary, README excerpt, top-level landmarks, branch name, and explicit in-project guidance blocks already present in OMP's system prompt. The generated identity uses project-relative paths, and guidance files outside the detected project root are excluded. OMP 17.2.11 does not expose the former Pi project-trust predicate, so context mode `none` is the hard opt-out for workspace inspection and transmission.
2. **Active-branch evidence.** `sessionManager.getBranch()` supplies the current branch. `src/context-builder.ts` retains visible user and assistant text plus compaction and branch summaries, while excluding thinking, tool traffic, hidden custom entries, and extension diagnostics.

Every evidence section is labeled untrusted. Oversized entries keep bounded prefixes and suffixes around an omission marker. Per-item caps prevent one long response from evicting the preceding request.

`estimateTokens()` comes from `@oh-my-pi/pi-agent-core/compaction`. The exact draft, output allowance, request framing, and provider margin are reserved before workspace or session evidence. Evidence shrinks first; the draft is never truncated. Models with missing context metadata use bounded conservative defaults.

## Model selection and provider invocation

`ExtensionContext.modelRegistry` is OMP's live registry. Chisel's model picker reads `getAvailable()` and displays provider, model ID, and model name. A saved pin is only a `{ provider, id }` preference; it never switches the main session model.

`src/model-client.ts` performs one transcript-isolated request through canonical `@oh-my-pi/pi-ai` APIs:

1. Verify that OMP still has the selected provider.
2. Apply OMP's current provider-specific base URL and headers.
3. Obtain an OMP `ApiKeyResolver` with `modelRegistry.resolver(model, sessionId)`.
4. Build a `Context` containing the optimizer system instruction and one user message with explicit evidence and draft boundaries.
5. Call `streamSimple()` with a fresh UUID session ID, `cacheRetention: "none"`, an abort signal, and the computed output limit.
6. Consume text events until the terminal assistant message, then reject empty, unchanged, malformed, truncated, or errored output.

This path does not call the main agent loop, append session entries, expose tools, or mutate the active model. OMP owns credential refresh and provider dispatch. Chisel only receives the resolved stream events.

OMP's source-loaded extension graph and bundled host currently keep separate custom-API registries. Production providers are built into OMP and are unaffected. The PTY faux-provider fixture explicitly registers its deterministic stream in both registries so the isolated and configured smoke paths exercise the same Chisel boundary.

## Configuration

OMP's `getAgentDir()` defaults to `~/.omp/agent`. Chisel stores its configuration at:

```text
~/.omp/agent/prompt-optimizer.json
```

`src/config.ts` validates every field and falls back per field rather than trusting parsed JSON. Writes use a same-directory temporary file, mode `0600`, and atomic rename. The file contains UI preferences and an optional model identifier; it never contains credentials or draft text.

Replacement history remains in memory. Persisting the original draft in configuration or transcript metadata would create an unnecessary privacy footprint.

## Replacement invariant

The workflow captures the draft before generation and treats that value as the compare-and-swap precondition:

1. Generate and review without touching the editor.
2. Re-read the editor immediately before acceptance.
3. Replace directly only when the editor still equals the captured draft.
4. If it changed, require an explicit replace, merge-editor, or cancel decision.
5. Record the exact before/after pair after a successful replacement.
6. Recheck the after value before restore; never overwrite later edits silently.

`src/editor-safety.ts` holds the pure decision rule, `src/replacement.ts` applies it through OMP's UI context, and `src/workflow.ts` owns the interactive sequence.

## Verification boundary

The repository verifies three layers:

- `npm test`: deterministic request, grounding, model-selection, UI framing, sanitization, and replacement contracts under Bun's test runner.
- `npm run test:smoke`: the supported OMP TUI in a PTY with isolated Chisel and faux-provider extensions. It exercises shortcut dispatch, cancellation, review modes, replacement, restore safety, and delayed explicit submission.
- `npm run smoke:install`: packs the public payload, installs it into a temporary clean OMP home, verifies OMP discovers the packaged plugin, and repeats the PTY flow against that installed copy.
- `npm run smoke:configured`: confirms the enabled `pi-chisel` plugin resolves to this checkout, checks the effective Ghostty shortcut map, and repeats the PTY flow with the user's configured OMP extensions loaded.

`npm run validate` runs formatting checks, TypeScript, contract tests, a production dependency audit, package inspection, and both portable OMP smoke paths. The configured-runtime smoke is separate because it intentionally depends on the developer's local OMP setup.
