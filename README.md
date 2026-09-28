# Pi Chisel

Chisel is a [Pi](https://pi.dev) extension that turns a rough prompt draft into a clearer one and shows you the result before anything changes. It never submits for you.

Type `fix the login bug`, press **Ctrl+Shift+K**, and review what comes back:

![Chisel's review overlay with the rewritten login-bug prompt, a note that it's still unsent, and the available keys](docs/images/pi-chisel-review.svg)

*Captured in Pi 0.87.1 with a scripted model, so it shows the real UI but not real rewrite quality. [How the screenshots are made](docs/screenshots.md).*

Use the rewrite, edit it, compare it with your original, send it back for another pass with notes, or throw it away. Your draft stays put until you accept, and accepting only swaps the editor text.

Chisel adds a little context from your project and conversation so the rewrite can be specific, and you can see and trim exactly what it sends. The request runs off to the side: it never enters your session, and Chisel doesn't save drafts or responses. Rewrites keep your goal, hedges, limits, and tone, so a question stays a question. Chisel uses the model you're chatting with, or one you pin just for it.

## Install

### Pi

You need Pi 0.87.1 or newer (tested on 0.87.1) and a model set up with `/login` or `/model`.

```bash
pi install npm:pi-chisel
```

Run `/reload` in any open session, or start a new one. `pi list` should now show the package.

To install from Git instead, use `pi install git:github.com/feveromo/pi-chisel@pi`. To try Chisel for one session without installing it, run `pi -e npm:pi-chisel`.

### OMP

A separate build for [OMP](https://omp.sh) (oh-my-pi) lives on the `main` branch. It's tested on OMP 18.4.0; later versions may work but aren't tested. Set up a model with `/login` or `/model`, then:

```bash
omp plugin install github:feveromo/pi-chisel
```

Run `/reload` or start a new session, and check it with `omp plugin list`. Remove it with `omp plugin uninstall pi-chisel`. To run it from a `main` checkout without installing:

```bash
omp --no-extensions -e ./src/prompt-optimizer.ts
```

## Use

Type a draft and press **Ctrl+Shift+K**. Chisel opens a review once the rewrite is ready. Press **Esc** while it's working to cancel, and nothing changes.

In the review:

| Key | What it does |
|---|---|
| **Enter** or **A** | Use the rewrite. It replaces your draft but isn't sent. |
| **E** | Edit the rewrite first. |
| **Tab** or **V** | Cycle through the rewrite, the changes, and your original. |
| **D** / **O** | Jump to the changes or the original. |
| **N** / **P** | Next or previous change. **]** and **[** work too. |
| **R** | Another pass. Say what to change, or leave it blank for a fresh take. |
| **B** | Go back to the previous candidate after another pass or an edit. |
| **C** | Review or change the context for the next pass. |
| **M** | Switch the model Chisel uses. |
| **Esc** or **Q** | Keep your original. |

After you accept, press **U** in the confirmation to put your old draft back, or run `/chisel-restore` later in the same session. Then send the prompt the way you normally would.

The changes view shows what the rewrite added and removed:

![Changes view showing the one-line original above the longer rewrite, with added text highlighted](docs/images/pi-chisel-comparison.svg)

Enter, Esc, the arrow keys, and PgUp/PgDn follow your `tui.select.*` keybindings, and the hints on screen show what you've actually bound. Chisel always works on the whole draft, not a selection. If your terminal or desktop grabs Ctrl+Shift+K, set a different shortcut in `/chisel-settings`.

### Commands

| Command | What it does |
|---|---|
| `/chisel <draft>` | Chisel the text after the command. |
| `/chisel-context <draft>` | Same, but show the context before anything is sent. |
| `/chisel-model` | Choose Chisel's model. |
| `/chisel-settings` | Change the context, inspection, budget, intensity, review view, model, and shortcut. |
| `/chisel-restore` | Put back the draft Chisel last replaced. |

A slash command can lose spaces around its text, so use the shortcut when exact whitespace matters. Before 0.2.0 these commands were `/prompt-optimize*`; your shortcut and settings carry over.

## Settings

Change these with `/chisel-settings`. They're saved to `~/.pi/agent/prompt-optimizer.json`, or `~/.omp/agent/prompt-optimizer.json` on OMP. (The filename predates the rename.) The file holds only model IDs and preferences, never credentials or drafts, and is written atomically with `0600` permissions.

| Setting | Default | Options |
|---|---|---|
| `contextMode` | `auto` | `auto`, `recent`, or `none`. See [Context](#context). |
| `inspectContext` | `false` | `true` shows the context before every request. |
| `contextTokenBudget` | `1800` | Most context tokens per request. The menu offers 512 to 8192. |
| `intensity` | `standard` | `light`, `standard`, or `strong`. |
| `previewMode` | `optimized` | The view the review opens on: `optimized`, `diff`, or `original`. |
| `shortcut` | `ctrl+shift+k` | Any key combination that isn't already bound. |
| `model` | `null` | `null` follows your chat model. See [Models](#models). |

### Intensity

- `light` fixes wording and grammar and stays close to what you wrote.
- `standard` clarifies and organizes, adding a little detail where it's missing.
- `strong` builds a rough idea into a fuller prompt with relevant context and sensible supporting steps.

At `strong`, `fix the login bug` might become:

> Fix the login bug: trace the existing login flow, identify the root cause, and make a targeted fix. Verify the failing case and keep unrelated behavior unchanged.

That shows the kind of rewrite Chisel aims for, not a promise about what your model will write.

Every level keeps your goal, your uncertainty, conditions and exclusions, length limits, exact text like names and code, and how you sound. `strong` can make a short draft longer, but "keep it brief" still wins, and a question won't turn into a to-do list. If your prompt is already fine, the model can hand it back unchanged. The review then says **ALREADY GOOD**, and accepting does nothing.

The full instruction is in [`src/optimizer-instruction.ts`](src/optimizer-instruction.ts). It's a set of editing rules, not a guarantee, so read the rewrite before you use it.

### Models

Chisel uses your current chat model unless you pin another with `/chisel-model`. A pin only affects Chisel, never your conversation. If the pinned model isn't available, Chisel tells you and uses the chat model for that pass.

Requests go through Pi's own model registry, so Chisel uses the same credentials Pi would, including OAuth logins, provider headers, and custom base URLs. The OMP build does the same with OMP's registry.

## Context

A rewrite is better when it knows what you're working on, so Chisel sends a small, bounded amount of context with your draft, up to `contextTokenBudget` tokens. Your draft, the candidate being revised, and your notes always come first. Context gets whatever room is left.

- **Workspace:** the project name, relative working directory, git branch, a manifest summary, the start of the README, top-level files and folders, and in-project guidance files the host already loaded. In a project you haven't trusted, Chisel uses only the directory and project name and reads no files.
- **Session:** recent conversation, favoring what your draft refers to and your own messages over the assistant's. Summaries are labeled as lossy. Thinking, hidden entries, extension data, and tool output are left out (see [Tool excerpts](#tool-excerpts) for the opt-in).

The `contextMode` setting controls how Chisel picks:

- `auto` keeps what looks relevant to the draft. Drafts that point back at earlier work, like "do that again" or "as we discussed", get more history.
- `recent` uses the recent conversation without the relevance filter.
- `none` sends only your draft, plus the candidate and your notes on another pass.

### See what gets sent

The shortcut sends right away. To check the context first, turn on **Inspect before sending** in settings, or use `/chisel-context <draft>`. The inspector lists every source with the exact text that would go out. Uncheck what you don't want, then press **Enter**. Backing out sends nothing.

![Context inspector before the first request, with four checked workspace sources and a preview of the selected one](docs/images/pi-chisel-context.svg)

| Key | What it does |
|---|---|
| **↑** / **↓** | Pick a source. |
| **Space** | Include or exclude it. |
| **PgUp** / **PgDn**, **Home** / **End** | Scroll the excerpt. |
| **0** | Uncheck everything and send the draft alone. |
| **T** | Jump to tool excerpts. |
| **Enter** | Generate. |
| **Esc** | Go back and discard your changes. |

Pressing **C** during review opens the same inspector for the next pass. It can't unsend earlier requests. Sources marked *supplied* are the ones used for the candidate you're looking at. Your choices last for that Chisel run, including retries, and unchecking a source never pulls in a replacement. If a different model or a longer revision leaves less room, Chisel shows the inspector again instead of quietly dropping sources.

### Tool excerpts

Chisel can include output from earlier tool calls in the session, but only the ones you check. It offers up to eight completed `bash`, `read`, `grep`, `find`, `ls`, `edit`, and `write` results from the last 64 session entries, all unchecked. You can pick up to three, totaling 512 tokens, within the overall budget. Each one shows its tool, the command or path, and whether the tool reported an error at the time.

Unknown tools, results without their original call, and anything aimed at a credential-looking file (`.env`, `.npmrc`, SSH keys, and so on) are skipped. That filter isn't a secret scanner, so read an excerpt before you check it. Chisel never runs tools itself, and `none` mode turns tool excerpts off too.

## Privacy and safety

Each pass sends your draft to your model's provider, along with the context you've allowed (none in `none` mode). Another pass also sends the current candidate and your notes. What the provider keeps depends on the provider and your account.

Chisel doesn't store drafts, context, responses, or credentials, and it has no telemetry. Each request is a one-off side call with a fresh session ID, no tools, and no prompt caching, and it never shows up in your conversation or the main agent loop.

- **Esc** cancels a request immediately, and requests time out after 120 seconds.
- An empty, malformed, cut-off, failed, unauthorized, or rate-limited response never touches your draft.
- Replacing and restoring both check that the editor still holds the text Chisel expects. If you've typed something since, Chisel asks before overwriting it.
- Context is marked to the model as untrusted data, not instructions, and terminal control characters are escaped before anything is displayed.
- Chisel doesn't put absolute paths in the workspace summary, read guidance files outside the project, or follow symlinked metadata files. It isn't a redactor, though: sensitive text inside a file it does read can still be sent.
- Only one Chisel run happens at a time. Reloading or quitting cancels it and closes its overlays.

## Development

The Pi and OMP builds live on separate branches, `pi` and `main`, because they compile against different host APIs. Everything host-specific is in `src/host.ts`, and the rest of `src/` is identical on both branches. Make a shared change on one branch, copy it to the other, and check that `git diff main pi -- src ':!src/host.ts'` prints nothing. Tests, fixtures, and packaging are per-branch.

### Pi build

You need Node 22.19 or newer, Pi 0.87.1 or newer on your `PATH`, and Python 3 for the terminal smoke tests.

```bash
git clone --branch pi https://github.com/feveromo/pi-chisel.git pi-chisel-pi
cd pi-chisel-pi
npm ci --ignore-scripts --legacy-peer-deps
pi install .
npm run validate
```

`validate` runs Biome, TypeScript, the unit tests, the screenshot renderer's tests, and a package check. It then drives Pi in a pseudo-terminal with an isolated copy of Chisel, and finally runs `smoke:configured` against the checkout you linked with `pi install .`.

### OMP build

You need Bun 1.3.14 or newer, npm, OMP 18.4.0, and Python 3.

```bash
git clone https://github.com/feveromo/pi-chisel.git
cd pi-chisel
npm ci --ignore-scripts
omp plugin link .
npm run validate
npm run smoke:configured
```

The OMP `validate` also audits production dependencies and smoke-tests a clean install of the packed plugin.

### Tests

Unit tests cover context selection, opt-in and exclusion, request boundaries, cancellation, retry recovery, candidate history, no-op acceptance, and races with the editor and shutdown. The smoke tests walk the real TUI through preflight, exclusion, feedback, failed and cancelled retries, and replacement, and check that nothing is submitted on its own.

None of this measures rewrite quality. For that, [docs/editorial-quality.md](docs/editorial-quality.md) has 25 synthetic good and bad examples and a rubric for reviewing real output.

[docs/architecture.md](docs/architecture.md) covers the host hooks each build relies on, and differs per branch. To report a vulnerability, see [SECURITY.md](SECURITY.md). Pi Chisel is MIT licensed; see [LICENSE](LICENSE).
