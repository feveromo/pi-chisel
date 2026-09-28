# Native Pi architecture

Pi Chisel's native Pi integration is tested against `@earendil-works/pi-coding-agent` **0.87.1**. The line-numbered UI/lifecycle references below record the original **0.84.1** inspection and may have moved. The model invocation section describes the current 0.87.1 API. Source paths are relative to the installed Pi package unless another package is named.

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

1. **Workspace evidence.** Workspace identity uses project-relative paths. Trusted projects can contribute a manifest summary, README overview, landmarks, branch, and bounded in-project guidance from Pi's loaded context. Guidance outside the project root is excluded; metadata symlinks are not followed. Untrusted project files are not inspected. Source contents can themselves contain paths or sensitive material; this is not a general redactor.
2. **Active-session evidence.** Visible user/assistant text and summaries are eligible, including materialized retained dialogue on newer compaction checkpoints. `auto` favors lexical references and preserves the user instruction behind a matching assistant reply. User turns get capacity before summaries or assistant commentary, with the newest relevant user turn first. Selected items remain chronological. Thinking, hidden entries, extension metadata, telemetry, and diagnostics stay excluded.
3. **Opt-in tool evidence.** Existing paired results for `bash`, `read`, `grep`, `find`, `ls`, `edit`, and `write` in the last 64 entries can supply up to eight candidate excerpts, capped at 240 estimated tokens each. All start unchecked. The inspector permits at most three / 512 tokens, within the combined context budget. Unknown tools, arbitrary argument/detail objects, unpaired results, and recognizable credential-file targets are excluded. This is not exhaustive secret detection. Chisel never runs tools.

Explicitly referential drafts receive expanded conversation capacity; short self-contained drafts do not. `recent` removes the lexical relevance filter, not the user-priority policy. `none` disables workspace, session, and tool evidence entirely.

`src/evidence.ts` selects complete sentences/lines, favoring constraints and matching references. Truncation is marked; indivisible units can be omitted if they do not fit. Source IDs, roles, exact bounded text, and truncation flags remain available to the inspector. Lexical matching and English constraint cues are heuristics, not semantic guarantees. `estimateTokens()` is exported from `dist/index.d.ts:5`; its implementation uses Pi’s conservative characters-per-token estimate. The exact original, revision candidate/feedback, output allowance, request framing, and provider margin are reserved first, so grounding shrinks before user-controlled request text.

## Model registry, provider invocation, and transcript isolation

`ExtensionContext` exposes the current model, scoped models, and `ModelRegistry`. The registry’s public facade is `dist/core/model-registry.d.ts`:

- `getAvailable()` supplies authenticated models.
- `find()` detects removed pins.
- `getProvider()` returns the registered provider implementation.
- `getApiKeyAndHeaders(model)` resolves request credentials, model-specific headers, and provider environment.
- `streamSimple(model, context, options)` delegates to `ModelRuntime`, normalizes the ordinary request context, and handles request-time authentication, including credential-specific base URLs.

Pi 0.87.1 raw providers require a normalized `TranscriptContext`, not the request builder's ordinary `Context`. Calling the provider directly bypasses conversion of the optimizer's `systemPrompt` into a leading system message. Chisel uses the registry boundary; a real-registry/faux-provider regression verifies that the provider receives both system instructions and the user draft.

Pi Chisel uses the strongest public boundary available without modifying core:

1. Resolve the selected model from `ModelRegistry`.
2. Fetch its registered `Provider`.
3. Resolve model-specific headers/environment with `getApiKeyAndHeaders(model)`, failing early with a readable error when authentication is missing.
4. Call `modelRegistry.streamSimple()` with a fresh side-channel session ID, `cacheRetention: "none"`, `maxRetries: 0`, a bounded output cap, the overlay AbortSignal, and temperature `0.2` for non-reasoning models to reduce gratuitous variation.
5. Consume text deltas and validate the final stop reason and non-empty text. Unchanged output is valid at every intensity and preserves the original bytes. Revisions supply the original, candidate, and explicit editing feedback as separate bounded sections.

No method on `AgentSession`, `SessionManager`, or `ExtensionAPI` is used to send or append the optimizer request. As a result, neither request nor response enters the active branch, session JSONL, LLM context, transcript renderer, or usage footer.

## Context inspection and revision state

The default shortcut still generates immediately. `inspectContext: true` or `/prompt-optimize-context <draft>` opens preflight before any provider call; cancelling sends nothing. Review's **C** control opens the same inspector for the next pass, explicitly warning that it cannot unsend earlier requests. It previews the bounded source text used by request construction, sanitized only for terminal display. Inclusion is not verification or model attribution.

`src/workflow.ts` freezes the source inventory for the invocation. Exclusions are never replenished and survive failures/history navigation. If a new model or longer revision reduces capacity, the remaining source selection requires approval before sending. Tool selection is explicit and cannot silently evict user intent to fit.

Candidates keep their actual model, supplied sources, and feedback separately from next-pass selection. Retry collects feedback and retains the original as the intent anchor. Errors/cancellation return to the current candidate; **B** swaps with one previous candidate after a successful retry or manual edit. View/scroll state survives dialogs. Revision history, tool selections, exclusions, and feedback remain in memory only.

Focused diff regions support next/previous-change navigation, while full original/rewrite views remain accessible. An unchanged draft displays **ALREADY GOOD** and acceptance is a no-op. Light cleans up, Standard clarifies and organizes, and Strong actively enriches rough ideas with relevant context and sensible supporting detail. All intensities preserve the underlying goal, request type, uncertainty, voice, literals, conditions, and explicit limits—not necessarily the original brevity or low detail. Focused investigation/verification can strengthen a repair; a question must not become implementation. See [editorial-quality.md](editorial-quality.md) for 25 synthetic contrasts and a human-review rubric; deterministic tests do not score live model quality.

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
6. A **Fresh off the Chisel** overlay names the model and context supplied, then offers use, tune, focused changes/navigation, full views, context inspection, feedback-driven retry, model selection, previous candidate, or keeping the original. Its copy explicitly states that using the result cannot submit.
7. Acceptance re-reads the editor. An exact match allows replacement; any mismatch forces replace/merge/cancel choice.
8. A temporary confirmation overlay offers immediate restore. Replacement/restore recheck the editor and invocation lifetime after asynchronous merge/conflict dialogs before writing.
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
