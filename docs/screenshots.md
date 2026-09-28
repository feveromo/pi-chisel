# Reproduce the README screenshots

The README uses native Pi **0.85.0** captures from the actual PTY smoke flow with a deterministic faux provider. The prompt and response are synthetic. These are UI demonstrations, not evidence of real-model editorial quality.

From the native `pi` branch, with `pi` on PATH and development dependencies installed:

```bash
PI_CHISEL_CAPTURE_DIR=/tmp/chisel-captures \
PI_CHISEL_SMOKE_DRAFT='fix the login bug' \
PI_CHISEL_SMOKE_RESULT='Fix the login bug: trace the existing login flow, identify the root cause, and make a targeted fix. Verify the failing case and keep unrelated behavior unchanged.' \
uv run --with pyte test/smoke-tui.py
```

Set `PI_BIN` to test another installed Pi binary. The capture header records its reported version. On the OMP `main` branch, use the same command with `OMP_CHISEL_` instead of `PI_CHISEL_`; it defaults to the pinned local OMP 17.2.11 binary.

Keep capture runs isolated (do not set `PI_CHISEL_CONFIGURED` / `OMP_CHISEL_CONFIGURED`). Use a public, non-sensitive workspace: the context inspector shows actual bounded project metadata. No real provider is called, and the smoke test also checks cancellation, source exclusion, retries, history, safe replacement, and explicit-only submission.

## Rendering and review

`test/terminal_capture.py`:

- Decodes the PTY byte stream incrementally and strictly, preserving Unicode split across reads instead of introducing replacement characters.
- Crops the overlay's real frame, excluding underlying editor/footer text.
- Places text on terminal-cell coordinates and renders box-drawing frames as SVG paths. Font fallback cannot break frame joins or shift text runs.
- Preserves captured colors, escapes SVG text, and rejects replacement glyphs or incomplete captures.

Only `pyte` is needed for capture, via the one-off `uv` command; no Python dependency is added to the extension. The standard-library regressions run with `npm run test:capture` and are included in `npm run validate`.

Review all four SVGs in a browser at README width before copying them into `docs/images/`. Check the original/rewrite text, complete action rows, frame joins, Unicode arrows, and the pre-send notice. Both runtime branches carry the same native Pi README images; OMP can generate its own captures for host-specific review. Keep the README's host/version and synthetic-provider disclaimer accurate when updating them.

## Package catalog preview

`docs/images/pi-chisel-review.png` is a 2x (1602 x 844) raster export of the review
SVG for the catalog's `pi.image` metadata. Export with librsvg to preserve the
terminal-cell text placement, fonts, and frame paths. On a Linux host with Python
GObject, Cairo, librsvg, and DejaVu Sans Mono installed:

```bash
/usr/bin/python3 - <<'PY'
import cairo, gi
gi.require_version('Rsvg', '2.0')
from gi.repository import Rsvg
handle = Rsvg.Handle.new_from_file('docs/images/pi-chisel-review.svg')
width, height = 1602, 844
surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, width, height)
viewport = Rsvg.Rectangle()
viewport.x = viewport.y = 0
viewport.width, viewport.height = width, height
assert handle.render_document(cairo.Context(surface), viewport)
surface.write_to_png('docs/images/pi-chisel-review.png')
PY
```

Inspect the PNG before publishing. The version-pinned public image URL is
documented in [publishing.md](publishing.md).
