# Verified Pi 0.84.1 architecture

Pi Chisel's native Pi integration is designed and tested against `@earendil-works/pi-coding-agent` **0.84.1**. Source references below are relative to that installed package unless another package is named.

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

Pi’s complete default map is in `docs/keybindings.md` and `dist/core/keybindings.d.ts`. Ctrl+Shift+K has no binding in Pi or OMP and is unclaimed by the effective Ghostty configurations on macOS and Linux. Ctrl+Alt+P is excluded because macOS intercepts it on this setup; Ctrl+Shift+J is excluded because Linux Ghostty binds it to `write_screen_file`; Ctrl+Shift+O remains reserved by Ghostty.

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

Pi Chisel composes only native `Container`, `Text`, `Input`, `SelectList`, `SettingsList`, `CancellableLoader`, `DynamicBorder`, key matching, fuzzy filtering, and theme functions. Every view is transient; there is no widget, footer, status, header, or transcript entry. The visible journey uses one product voice: **Pi Chisel at Work** while generating, **Fresh off the Chisel** for review, and **Chiseled draft ready** after replacement. Model, grounding, unsent status, and destructive choices stay literal so the personality never obscures behavior.

## Layered grounding context

`ExtensionContext.sessionManager` is the public read-only session facade at `dist/core/extensions/types.d.ts:209-249`. `ReadonlySessionManager.buildContextEntries()` is defined in `dist/core/session-manager.d.ts`; unlike a raw branch walk, it honors Pi’s current compaction checkpoint and retained context. `ExtensionContext.getSystemPrompt()` exposes the current effective system prompt, and `isProjectTrusted()` preserves Pi’s project trust boundary.

Grounding has two independently bounded layers:

1. **Workspace evidence.** Every `auto` or `recent` invocation includes at least the current workspace identity. A trusted workspace can also contribute the detected project root and branch, a package/language manifest summary, a short README overview, top-level landmarks, and bounded project guidance extracted from Pi’s `<project_context>`. An untrusted workspace is never inspected beyond its identity.
2. **Active-session evidence.** The builder retains recent user and assistant text plus compaction and branch summaries. It intentionally excludes thinking blocks, tool calls, tool results, hidden custom entries, extension metadata, telemetry, and model diagnostics.

`auto` no longer makes a binary “context needed” decision. Brief or explicitly referential drafts receive the expanded remaining session budget; developed drafts receive a smaller ambient slice, which keeps them session-aware without letting unrelated history dominate. `recent` uses the full remaining session budget, while `none` is the explicit draft-only opt-out.

Context items use explicit `[USER]`, `[ASSISTANT]`, `[SESSION_SUMMARY]`, and `[BRANCH_SUMMARY]` boundaries. A per-item cap prevents one long response from evicting the preceding request, and oversized items preserve both their beginning and end around an omission marker. `estimateTokens()` is exported from `dist/index.d.ts:5`; its implementation uses Pi’s conservative characters-per-token estimate. The exact draft, output allowance, request framing, and provider margin are reserved first, so grounding shrinks before the draft ever could.

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
5. Call `provider.streamSimple()` with a fresh side-channel session ID, `cacheRetention: "none"`, `maxRetries: 0`, a bounded output cap, the overlay AbortSignal, and temperature `0.2` for non-reasoning models to reduce gratuitous variation.
6. Consume text deltas and validate the final stop reason, non-empty text, and—at standard or strong intensity—that the model did not return the draft unchanged.

No method on `AgentSession`, `SessionManager`, or `ExtensionAPI` is used to send or append the optimizer request. As a result, neither request nor response enters the active branch, session JSONL, LLM context, transcript renderer, or usage footer.

A small future core improvement would be a public `ctx.modelRegistry.streamSimple()` delegating to `ModelRuntime.streamSimple()`. That would centralize request preparation and extension request hooks. It is not required for the installed providers because the existing public provider and auth APIs expose the needed pieces.

## Independent model persistence

Pi’s extension API has no generic settings namespace or key/value store. Session custom entries are intentionally branch-local and would retain private prompt-adjacent state. First-party `examples/extensions/preset.ts:79-118` instead reads extension configuration under `getAgentDir()`.

Pi Chisel follows that convention with `~/.pi/agent/prompt-optimizer.json`. It loads once in the async extension factory and writes only after an explicit settings change using a same-directory temporary file plus atomic rename. No credential or prompt content is persisted.

The model preference is either `null` for “follow current chat model” or `{ provider, id }` for a pin. Selection never calls `pi.setModel()`, so it cannot alter the main conversation model.

## End-to-end flow

1. The shortcut handler captures `ctx.ui.getEditorText()` exactly once.
2. It resolves a pinned/current model and computes remaining grounding capacity after reserving the full draft, instruction, output, reference framing, and provider safety margin.
3. It builds trusted workspace evidence plus a compaction-aware recent-session window. A fresh session still receives workspace grounding.
4. Workspace evidence, session evidence, deterministic draft metadata, and the exact draft are placed in separate explicit boundaries under the optimizer instruction.
5. A native cancellable **Pi Chisel at Work** overlay streams one provider request.
6. A **Fresh off the Chisel** overlay names the model and grounding used, then offers use, tune, bounded changes, scrollable chiseled/original views, another pass, model selection, or keeping the original. Its copy explicitly states that using the result cannot submit.
7. Acceptance re-reads the editor. An exact match allows replacement; any mismatch forces replace/merge/cancel choice.
8. A temporary confirmation overlay offers immediate restore. Restore rechecks the editor before writing.
9. Submission remains the normal Pi editor action and is never synthesized by the extension.

## File responsibilities

```text
src/index.ts                    extension factory and Pi registrations
src/controller.ts               lifecycle and single-invocation ownership
src/state.ts                    mutable config state with atomic persistence
src/config.ts                   schema, validation, shortcut checks, file store
src/draft-analysis.ts           deterministic brief/referential draft classification
src/context-builder.ts          compaction-aware session extraction and token budgeting
src/project-context.ts          trusted bounded workspace evidence
src/grounding.ts                adaptive workspace/session allocation and UI summary
src/optimizer-instruction.ts    grounded editing method and intensity directive
src/request-builder.ts          separated evidence boundaries, estimates, output sizing
src/model-selection.ts          pin/current/fallback resolution and context capacity
src/model-client.ts             generic provider stream and response validation
src/workflow.ts                 generation/review/retry orchestration
src/replacement.ts              changed-draft conflict and restore safety
src/overlay.ts                  native overlay adapters
src/ui/*                        focused optimizer/review components, bounded diff, viewport logic
test/*.test.ts                  pure and provider-boundary tests
test/smoke-tui.py               real Pi PTY integration smoke test
test/smoke-configured.sh        active-settings checkout resolution smoke test
```
