# Verified Pi 0.83.0 architecture

This extension was designed against the exact installation at:

```text
/home/fever/.local/lib/node_modules/@earendil-works/pi-coding-agent
```

The package reports version `0.83.0`. References below are relative to that directory unless another package is named.

## Extension lifecycle and discovery

Pi loads TypeScript extensions through Jiti. User extensions are discovered from `~/.pi/agent/extensions`, project extensions from `.pi/extensions` after trust, explicit paths from `-e`, and local packages from `settings.json` or `pi install`.

- `docs/extensions.md:1-177` documents discovery, async factories, imports, and Jiti loading.
- `dist/core/extensions/loader.js:186-312` constructs the public `ExtensionAPI`; `registerShortcut()` records the shortcut on the current extension instance at `211-213`.
- `dist/core/extensions/loader.js:438-516` resolves extension files and package directories.
- `dist/core/extensions/runner.js:319-348` merges extension shortcuts, reports built-in and extension conflicts, and applies deterministic precedence.
- `dist/core/extensions/types.d.ts:463-468` defines `session_shutdown`; `docs/extensions.md:507-523` specifies quit, reload, new, resume, and fork teardown.
- Runtime invalidation is built into `ExtensionRuntimeState` in `dist/core/extensions/types.d.ts:1137-1163`, so a reloaded extension cannot keep using stale Pi actions.

Pi Chisel starts no resources in its async factory. It owns one active request controller and one overlay dismissal callback, both cleared by `session_shutdown`.

## Keyboard dispatch and focus

`ExtensionAPI.registerShortcut(shortcut, handler)` is public at `dist/core/extensions/types.d.ts:894-899`.

`InteractiveMode.setupExtensionShortcuts()` in `dist/modes/interactive/interactive-mode.js:1359-1413` attaches the resulting dispatcher to `defaultEditor.onExtensionShortcut`. That placement has two useful consequences:

1. The shortcut sees the normal editor’s current draft.
2. It does not run while a selector, editor dialog, or custom overlay owns focus.

Pi’s complete default map is in `docs/keybindings.md:1-198` and `dist/core/keybindings.d.ts`. Ctrl+Alt+P has no binding in Pi, the installed extensions, the effective Ghostty configuration, GNOME, or this installation’s `~/.pi/agent/keybindings.json`; Ghostty reports it unambiguously through Kitty CSI-u. Ctrl+Shift+O is intentionally excluded because Ghostty binds it to `new_split:right`. A physical F6 press in the active Ghostty session was not dispatched even though Pi correctly handles the legacy F6 sequence in a PTY.

A configured key is validated locally, checked against the injected `KeybindingsManager.getResolvedBindings()`, then registered normally after reload. The runner remains the final authority for conflicts with other extensions.

## Reading and replacing the unsent draft

The public `ExtensionUIContext` is defined at `dist/core/extensions/types.d.ts:68-192`:

- `getEditorText()` at `132-133`
- `setEditorText()` at `129-130`
- `editor()` at `135-136`
- `custom()` at `111-126`

The interactive implementation is `InteractiveMode.createExtensionUIContext()` at `dist/modes/interactive/interactive-mode.js:1674-1726`. It reads expanded paste markers with:

```text
this.editor.getExpandedText?.() ?? this.editor.getText()
```

and writes through the active core editor’s `setText()`.

Pi’s `EditorComponent` contract in `@earendil-works/pi-tui/dist/editor-component.d.ts:8-38` exposes text, change callbacks, insertion, and rendering, but no selection or cursor-range methods. The concrete `Editor` has a cursor getter internally, yet `ExtensionUIContext` deliberately does not expose it. Selection-only optimization therefore requires a new upstream editor-range API; wrapping or monkey-patching terminal input would violate Pi’s extension boundary and this extension’s safety goals.

## Native temporary UI

`ctx.ui.custom()` temporarily gives a Pi component keyboard focus. Passing `{ overlay: true }` uses the native overlay compositor rather than replacing the chat/editor layout.

- `docs/tui.md:111-196` documents overlay sizing, anchoring, focus, and disposal.
- `InteractiveMode.showExtensionCustom()` at `dist/modes/interactive/interactive-mode.js:1921-1988` creates, focuses, closes, and disposes custom components.
- `@earendil-works/pi-tui/dist/tui.d.ts:73-103` defines `OverlayOptions`.
- `BorderedLoader` and `CancellableLoader` establish Pi’s native spinner/AbortSignal pattern in `dist/modes/interactive/components/bordered-loader.js:1-53` and `@earendil-works/pi-tui/dist/components/cancellable-loader.d.ts:1-22`.
- Theme tokens and helpers are documented in `docs/themes.md:95-251`.

Pi Chisel composes only native `Container`, `Text`, `Input`, `SelectList`, `SettingsList`, `CancellableLoader`, `DynamicBorder`, key matching, fuzzy filtering, and theme functions. Every view is transient; there is no widget, footer, status, header, or transcript entry.

## Visible conversation context

`ExtensionContext.sessionManager` is the public read-only session facade at `dist/core/extensions/types.d.ts:209-249`. `ReadonlySessionManager` and `getBranch()` are defined in `dist/core/session-manager.d.ts:1-123, 240-267`.

The context builder accepts only active-branch message entries whose role is `user` or `assistant`, then extracts text blocks. This intentionally excludes:

- assistant thinking blocks
- tool calls and tool-result messages
- compaction/custom/label/model-change entries
- extension metadata and diagnostics

It walks newest to oldest and formats explicit `[USER]` and `[ASSISTANT]` boundaries. `estimateTokens()` is exported from `dist/index.d.ts:5`; its implementation at `dist/core/compaction/compaction.js:188-226` uses Pi’s conservative characters-per-token estimate. The current draft is budgeted separately and is never shortened.

## Model registry, provider invocation, and transcript isolation

`ExtensionContext` exposes the current model, scoped models, and `ModelRegistry` at `dist/core/extensions/types.d.ts:223-237`. The registry’s public facade is `dist/core/model-registry.d.ts:19-42`:

- `getAvailable()` supplies authenticated models.
- `find()` detects removed pins.
- `getProvider()` returns the registered provider implementation.
- `getApiKeyAndHeaders(model)` resolves request credentials, model-specific headers, and provider environment.
- `getProviderAuth(provider)` retains credential-specific request data such as an OAuth-derived base URL.

The native provider contract is `@earendil-works/pi-ai/dist/models.d.ts:42-79`. Every provider owns a generic `streamSimple(model, context, options)` implementation and returns an `AssistantMessageEventStream`.

Pi does **not** expose `ModelRuntime.streamSimple()` directly on `ExtensionContext` or `ModelRegistry`. The internal all-in-one request preparation is visible at `dist/core/model-runtime.js:309-348`, while first-party `examples/extensions/qna.ts` and `handoff.ts` show the established side-channel pattern of resolving registry auth and invoking pi-ai outside `AgentSession`.

Pi Chisel uses the strongest public boundary available without modifying core:

1. Resolve the selected model from `ModelRegistry`.
2. Fetch its registered `Provider`.
3. Resolve model-specific headers/environment with `getApiKeyAndHeaders(model)`.
4. Resolve credential-specific base URL with `getProviderAuth(provider)` and project it onto a request-local model copy.
5. Call `provider.streamSimple()` with a fresh side-channel session ID, `cacheRetention: "none"`, `maxRetries: 0`, a bounded output cap, and the overlay AbortSignal.
6. Consume text deltas and validate the final stop reason and non-empty text.

No method on `AgentSession`, `SessionManager`, or `ExtensionAPI` is used to send or append the optimizer request. As a result, neither request nor response enters the active branch, session JSONL, LLM context, transcript renderer, or usage footer.

A small future core improvement would be a public `ctx.modelRegistry.streamSimple()` delegating to `ModelRuntime.streamSimple()`. That would centralize request preparation and extension request hooks. It is not required for the installed providers because the existing public provider and auth APIs expose the needed pieces.

## Independent model persistence

Pi’s extension API has no generic settings namespace or key/value store. Session custom entries are intentionally branch-local and would retain private prompt-adjacent state. First-party `examples/extensions/preset.ts:79-118` instead reads extension configuration under `getAgentDir()`.

Pi Chisel follows that convention with `~/.pi/agent/prompt-optimizer.json`. It loads once in the async extension factory and writes only after an explicit settings change using a same-directory temporary file plus atomic rename. No credential or prompt content is persisted.

The model preference is either `null` for “follow current chat model” or `{ provider, id }` for a pin. Selection never calls `pi.setModel()`, so it cannot alter the main conversation model.

## End-to-end flow

1. The shortcut handler captures `ctx.ui.getEditorText()` exactly once.
2. It resolves a pinned/current model and computes remaining context capacity after reserving the full draft, instruction, output, and provider safety margin.
3. The bounded visible reference and exact draft are placed in explicit data boundaries under the compact system instruction.
4. A native cancellable overlay streams one provider request.
5. A review overlay offers accept, full-text editing, bounded token diff, scrollable optimized/original views, retry, model selection, or cancel. Its copy explicitly states that acceptance cannot submit.
6. Acceptance re-reads the editor. An exact match allows replacement; any mismatch forces replace/merge/cancel choice.
7. A second temporary bubble offers immediate restore. Restore rechecks the editor before writing.
8. Submission remains the normal Pi editor action and is never synthesized by the extension.

## File responsibilities

```text
src/index.ts                    extension factory and Pi registrations
src/controller.ts               lifecycle and single-invocation ownership
src/state.ts                    mutable config state with atomic persistence
src/config.ts                   schema, validation, shortcut checks, file store
src/context-builder.ts          visible-turn extraction and token budgeting
src/optimizer-instruction.ts    reusable editing instruction and intensity directive
src/request-builder.ts          request boundaries, estimates, output sizing
src/model-selection.ts          pin/current/fallback resolution and context capacity
src/model-client.ts             generic provider stream and response validation
src/workflow.ts                 generation/review/retry orchestration
src/replacement.ts              changed-draft conflict and restore safety
src/overlay.ts                  native overlay adapters
src/ui/*                        focused prompt-bubble components, bounded diff, viewport logic
test/*.test.ts                  pure and provider-boundary tests
test/smoke-tui.py               real Pi PTY integration smoke test
test/smoke-configured.sh        active-settings checkout resolution smoke test
```
