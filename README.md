# Pi Chisel

Pi Chisel is a native Pi extension that rewrites the unsent prompt in the editor without submitting it. Press **Ctrl+Alt+P**, review the result in a compact prompt bubble, then accept, edit, compare, retry, switch optimizer models, or cancel.

It targets the installed `@earendil-works/pi-coding-agent` **0.83.0** API. It doesn’t patch Pi, start a daemon, use the clipboard, add persistent UI, or write optimizer traffic into the session transcript.

## Install on this machine

The checkout is `/home/fever/Dev/pi-chisel`. Install it as a local Pi package so Pi keeps loading this editable working tree:

```bash
pi install /home/fever/Dev/pi-chisel
```

Then run `/reload` in any open Pi session, or start a new one. Pi records the local package path in `~/.pi/agent/settings.json`; it doesn’t copy the extension into the installed Pi package.

For a one-off test without installing it:

```bash
pi --no-extensions -e /home/fever/Dev/pi-chisel/src/index.ts
```

## Use it

1. Type a draft in Pi’s normal editor.
2. Press **Ctrl+Alt+P**. The draft remains in the editor while a cancellable overlay streams one optimizer request.
3. Review the result. Accepting only replaces the draft; it never submits:
   - **Enter** or **A** accepts and replaces the draft.
   - **E** opens the complete optimized text in Pi’s multiline editor for inspection or editing.
   - **Tab** or **V** cycles optimized, color-highlighted diff, and original views. **D** jumps to diff; **O** jumps to original.
   - **Up/Down**, **Page Up/Page Down**, **Home**, and **End** navigate long reviews.
   - **R** retries with one new request.
   - **M** opens the optimizer model picker.
   - **Escape** or **Q** cancels and leaves the original untouched.
4. After replacement, press **U** in the confirmation bubble to restore the previous draft, or press **Enter/Escape** to continue with the optimized draft.
5. Submit normally only when you’re ready.

The fallback command is:

```text
/prompt-optimize <draft>
```

Pi slash commands occupy the editor themselves, so the command form takes the draft as its argument. Use the shortcut when preserving the currently typed draft byte-for-byte matters; Pi trims the outer command line before dispatching slash-command arguments.

Other commands:

- `/prompt-optimize-model` opens the searchable optimizer model picker.
- `/prompt-optimize-settings` opens native settings for context, budget, intensity, preview, model, and shortcut.
- `/prompt-optimize-restore` restores the last replacement when the previous draft is still available in this extension runtime. The immediate **U** action is the normal restore path because entering a slash command replaces editor text.

## Model selection

The picker reads Pi’s live authenticated model snapshot and shows provider, model ID, and display name. Its first entry is **Use current chat model**.

Choosing a concrete model pins only the optimizer. It never calls `pi.setModel()`, so the active conversation model does not change. The selection is stored in:

```text
~/.pi/agent/prompt-optimizer.json
```

If a pin disappears or loses authentication, the bubble says exactly what happened and uses the current chat model for that invocation. The missing pin stays configured until you explicitly replace it.

The request uses Pi’s registered provider object and resolved authentication, including OAuth credentials, provider headers, provider-scoped environment, and credential-specific base URLs. OpenAI Codex therefore follows the same authenticated provider path as the installed Pi runtime.

## Settings

Run `/prompt-optimize-settings`:

- Use **Up/Down** and **Enter** to change context mode, token budget, editing intensity, and the initial review view.
- Press **M** to choose the optimizer model.
- Press **K** to enter a new shortcut. Pi’s resolved keybindings are checked first; a built-in conflict is rejected. Pi reloads after saving a new shortcut.
- Press **Escape** to save and close.

Default configuration:

```json
{
  "version": 1,
  "model": null,
  "contextMode": "auto",
  "contextTokenBudget": 1800,
  "intensity": "standard",
  "shortcut": "ctrl+alt+p",
  "previewMode": "optimized"
}
```

Writes are atomic and mode `0600`. The file contains model IDs and UI preferences only, never credentials.

### Context modes

- `none` sends only the current draft.
- `recent` walks backward through visible user and assistant text until the token budget is full.
- `auto` does the same only when the draft looks dependent on prior conversation, such as “do that again,” “fix the previous version,” or “use the same style.”

Pi’s exported conservative token estimator enforces the budget. Message boundaries and roles are retained. Thinking blocks, tool calls, tool results, custom entries, extension metadata, telemetry, and model diagnostics are excluded. If the newest visible turn alone is too large, only its tail is retained with an omission marker. The draft itself is never truncated; context shrinks first.

### Intensity

- `light` stays close to wording, structure, and length.
- `standard` improves clarity, structure, specificity, and ordering.
- `strong` reconstructs more aggressively while preserving intent and concrete constraints.

The reusable optimizer instruction lives in [`src/optimizer-instruction.ts`](src/optimizer-instruction.ts).

## Safety behavior

- Escape aborts the active provider stream and closes the loader immediately.
- A 120-second timeout aborts the request and leaves the draft untouched.
- Empty, malformed, truncated, errored, unauthenticated, rate-limited, and network-failed responses never reach the editor.
- Prompt previews and dynamic provider/error labels neutralize terminal control characters before rendering.
- A second invocation is ignored while one is active.
- Before replacement, the extension compares the current editor text with the captured draft. If another actor changed it, Pi asks whether to replace it, open a merge editor, or cancel.
- Restore performs the same comparison and never silently overwrites edits made after replacement.
- `session_shutdown` aborts active work and dismisses the overlay during quit, reload, session switch, fork, or clone.
- The provider call uses a fresh side-channel session ID, no tools, no prompt caching, and no provider retries. It never calls `sendMessage`, `sendUserMessage`, `appendEntry`, or the main agent loop.

## Known Pi and terminal limitations

- Pi 0.83.0 exposes whole-editor get/set methods but no composer selection or cursor-range API. Pi Chisel therefore optimizes the whole draft; it does not guess at terminal selection state or wrap the editor.
- The default is **Ctrl+Alt+P**. It is unclaimed by the effective Ghostty configuration, GNOME, Pi’s built-ins, installed extensions, and user keybindings on this host. Do not use Ctrl+Shift+O here: Ghostty binds it to `new_split:right`. F6 remains configurable if the terminal emits it.
- Restore history is intentionally in memory. Persisting draft contents in global configuration or session metadata would create an unnecessary privacy and transcript footprint.
- The picker uses Pi’s current authenticated registry snapshot. Use Pi’s `/login` or `/model` flow first when a provider has not been configured.

## Develop and test

```bash
cd /home/fever/Dev/pi-chisel
npm ci --ignore-scripts --legacy-peer-deps
npm run lint
npm run check
npm test
npm run test:smoke
npm run smoke:configured
```

`npm run validate` runs that full sequence. `npm test` covers pure logic, terminal sanitization, and the provider boundary. `npm run test:smoke` starts the real installed Pi TUI in a PTY with an in-process faux provider and verifies Ctrl+Alt+P invocation, Escape cancellation, review, safe replacement, and that acceptance does not submit until a later normal Enter. `npm run smoke:configured` checks that this machine’s active Pi settings resolve the command to this checkout, then repeats the PTY flow with all configured packages loaded.

See [`docs/architecture.md`](docs/architecture.md) for the verified Pi hooks and source references.
