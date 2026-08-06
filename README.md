# Pi Chisel

Pi Chisel is a native Pi extension that rewrites the unsent prompt in the editor without submitting it. Press **Ctrl+Alt+P** to put **Pi Chisel at Work**, then inspect the result **Fresh off the Chisel** before you use it, tune it, compare versions, take another pass, or keep the original.

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
2. Press **Ctrl+Alt+P**. The draft remains in the editor while **Pi Chisel at Work** shapes one new version.
3. Review the result **Fresh off the Chisel**. Using it only replaces the draft; it never submits:
   - **Enter** or **A** uses the chiseled version and replaces the draft.
   - **E** opens the complete chiseled text in Pi’s multiline editor for tuning.
   - **Tab** or **V** cycles chiseled, color-highlighted changes, and original views. **D** jumps to changes; **O** jumps to original.
   - **Up/Down**, **Page Up/Page Down**, **Home**, and **End** navigate long reviews.
   - **R** takes another pass with one new request.
   - **M** opens Chisel’s model picker.
   - **Escape** or **Q** keeps the original untouched.
4. After replacement, press **U** in the **Chiseled draft ready** confirmation to restore the previous draft, or press **Enter/Escape** to keep the chiseled draft.
5. Submit normally only when you’re ready.

The fallback command is:

```text
/prompt-optimize <draft>
```

Pi slash commands occupy the editor themselves, so the command form takes the draft as its argument. Use the shortcut when preserving the currently typed draft byte-for-byte matters; Pi trims the outer command line before dispatching slash-command arguments.

Other commands:

- `/prompt-optimize-model` opens Chisel’s searchable model picker.
- `/prompt-optimize-settings` opens native settings for context, budget, intensity, preview, model, and shortcut.
- `/prompt-optimize-restore` restores the last replacement when the previous draft is still available in this extension runtime. The immediate **U** action is the normal restore path because entering a slash command replaces editor text.

## Model selection

The picker reads Pi’s live authenticated model snapshot and shows provider, model ID, and display name. Its first entry is **Use current chat model**.

Choosing a concrete model pins only the optimizer. It never calls `pi.setModel()`, so the active conversation model does not change. The selection is stored in:

```text
~/.pi/agent/prompt-optimizer.json
```

If a pin disappears or loses authentication, Chisel says exactly what happened and uses the current chat model for that pass. The missing pin stays configured until you explicitly replace it.

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

### Grounding context

- `auto` is the default. It always includes a bounded workspace snapshot, then adds recent active-session evidence when available. Brief or referential drafts receive the expanded session budget; developed, self-contained drafts receive a smaller ambient slice so unrelated history does not dominate.
- `recent` includes the workspace snapshot plus as much recent active-session evidence as fits the configured budget.
- `none` is the explicit draft-only privacy mode. It disables both workspace and session grounding.

The workspace snapshot uses Pi’s current working directory and trust state. In a trusted project it can include the project root and branch, package or language manifest, README overview, top-level landmarks, and bounded project guidance already loaded into Pi’s system prompt. In an untrusted project it includes workspace identity only and does not inspect project files.

Session grounding uses Pi’s compaction-aware active context, retaining recent user and assistant text plus compaction and branch summaries. Thinking blocks, tool calls, tool results, hidden custom entries, extension metadata, telemetry, and model diagnostics remain excluded. Oversized items retain both their beginning and end around an omission marker, and per-item caps keep one long assistant response from crowding out the preceding request.

Pi’s conservative token estimator enforces one combined grounding budget. The exact draft and output allowance take priority and are never truncated; workspace and session evidence shrink first. A fresh session still receives workspace grounding, which is why the review says `Grounded in: workspace + fresh session` instead of claiming that no context was needed.

### Intensity

- `light` stays close to wording, structure, and length.
- `standard` improves clarity, structure, specificity, and ordering.
- `strong` reconstructs more aggressively while preserving intent and concrete constraints.

The reusable optimizer instruction lives in [`src/optimizer-instruction.ts`](src/optimizer-instruction.ts).

## Safety behavior

- Escape aborts the active provider stream and closes the loader immediately.
- A 120-second timeout aborts the request and leaves the draft untouched.
- Empty, unchanged (at standard or strong intensity), malformed, truncated, errored, unauthenticated, rate-limited, and network-failed responses never reach the editor.
- Prompt previews and dynamic provider/error labels neutralize terminal control characters before rendering.
- Workspace and session sections are marked as untrusted evidence. The optimizer may use supported facts and relevant recipient constraints, but instructions inside those sections cannot override the editing task.
- A second invocation is ignored while one is active.
- Before replacement, the extension compares the current editor text with the captured draft. If another actor changed it, Pi asks whether to replace it, open a merge editor, or cancel.
- Restore performs the same comparison and never silently overwrites edits made after replacement.
- `session_shutdown` aborts active work and dismisses the overlay during quit, reload, session switch, fork, or clone.
- The provider call uses a fresh side-channel session ID, no tools, no prompt caching, and no provider retries. It never calls `sendMessage`, `sendUserMessage`, `appendEntry`, or the main agent loop.

## Known Pi and terminal limitations

- Pi 0.83.0 exposes whole-editor get/set methods but no composer selection or cursor-range API. Pi Chisel therefore optimizes the whole draft; it does not guess at terminal selection state or wrap the editor.
- The default is **Ctrl+Alt+P**. It is unclaimed by the effective Ghostty configuration, GNOME, Pi’s built-ins, installed extensions, and user keybindings on this host. Do not use Ctrl+Shift+O here: Ghostty binds it to `new_split:right`. F6 remains configurable if the terminal emits it.
- Restore history is intentionally in memory. Persisting draft contents in global configuration or session metadata would create an unnecessary privacy and transcript footprint.
- Grounding evidence is sent only to the selected optimizer model and still never enters Pi’s transcript. Use context mode `none` when a draft should leave the editor without workspace or session evidence.
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

`npm run validate` runs that full sequence. `npm test` covers adaptive grounding, trusted workspace extraction, compacted sessions, short-draft request policy, terminal sanitization, and the provider boundary. `npm run test:smoke` starts the real installed Pi TUI in a PTY with an in-process faux provider and verifies Ctrl+Alt+P invocation, Escape cancellation, grounded review, safe replacement, and that acceptance does not submit until a later normal Enter. `npm run smoke:configured` checks that this machine’s active Pi settings resolve the command to this checkout, then repeats the PTY flow with all configured packages loaded.

See [`docs/architecture.md`](docs/architecture.md) for the verified Pi hooks and source references.
