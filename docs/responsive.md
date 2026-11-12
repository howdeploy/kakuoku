# Responsive adaptation (2026-11-01)

Scope: geometry only. Colors, fonts, type sizes, radii, icons, avatars, patterns,
SL UI controllers and touch-target sizes are unchanged. Backend, `shared/`,
`server/`, dependencies and public assets are unchanged. Claude Code implemented
the adaptation; Codex reviewed the diff, ran isolated browser QA and corrected
one regression before acceptance.

## Changed files

- `src/style.css`
- `index.html` — viewport meta gained `interactive-widget=resizes-content`.
- `docs/responsive.md` — scope, verification and deployment record.

Baseline for diff: a temporary copy of `src/style.css` before the adaptation.

## Bugs found (from BEFORE screenshots + `report.json`)

Source: temporary `before-core` screenshots and their geometry report.

| # | Symptom (before) | Cause | Fix |
|---|------------------|-------|-----|
| 1 | 320×568: whole page and every dialog 340px wide, `pageOverflowX: 20`; settings fields and «Сохранить» cut on the right (`settings-*__320x568.png`). | `body { min-width: 340px }`. | `min-width: 320px`. No `overflow-x: hidden`. |
| 2 | Chat with open «Оформление» at 320×568 and 844×390: composer and send button pushed off-screen (`#chat-message`, `.send-control` = offscreen). | `.appearance-disclosure` had `flex-shrink: 0`; the shell is `overflow: hidden`, so header + appearance + conversation (`min-height: 80px`) + controls overflowed. | Open disclosure may shrink (`min-height: 0; flex-shrink: 1`) and its clip scrolls vertically (scrollbar hidden so nothing flashes during the open animation). Closed state and grid-rows animation unchanged. |
| 3 | 844×390 multi-line composer: textarea grows to 180px, send button off-screen (`chat-composer__844x390.png`). | SL textarea controller caps at 180px, more than fits in a 358px dialog. | At `max-height: 640px` the composer control is capped at 120px with inner scroll. The controller and its inline height logic are untouched. |
| 4 | Low landscape dialogs lose 32–64px to outer margins (chat 358px, settings 326px tall at 390px). | Desktop margins. | At `max-height: 560px`: chat full height (`100dvh`), settings `100dvh − 16px` with tighter vertical paddings of the sidebar/heading/content/footer; gallery viewer `100dvh − 16px` and its media max-height recalculated for that margin. |
| 5 | 320px: six avatar options in «Оформление» overflow (6 × 46px + gaps > 280px). | Fixed 7px gap. | `≤359px`: `gap: 0; justify-content: space-between`. Button and avatar sizes unchanged. |
| 6 | Demo `.feedback-error` toast `max-width: 320px` at `right: 24px` overflows a 320px screen. | Fixed width. | `max-width: min(320px, calc(100% - 48px))`. |
| 7 | Full matrix: send button clipped at 320×568 with a very long wrapping title, two pending attachments and 12 textarea lines. | Header height was unbounded. A first fix allowing the composer to shrink introduced clipping with open appearance/delete confirmation; the targeted re-run caught it. | At `max-height: 640px`, the title scrolls within `26dvh` at its original font size; the conversation may yield its minimum height. The composer retains its original non-shrinking layout. Pending attachments scroll within 80px; the textarea is capped at 120px and scrolls internally. At `max-height: 560px`, delete confirmation uses a wrapping row. No controller or markup changes. |

Not bugs of the app: the black round button covering cards/the send button in
screenshots is the Agentation toolbar, rendered only in demo mode. Gallery
`.create-note/.sort-note covered` in the report is the hidden notes panel behind the
active gallery panel of the section slider.

## Viewport meta

`interactive-widget=resizes-content` requests resizing of both viewports when the
keyboard opens in supporting browsers; see the [Chrome documentation](https://developer.chrome.com/blog/viewport-resize-behavior#opting_in_to_a_different_behavior).
This is a browser hint, not proof of correct behavior on a real phone. The actual
on-screen keyboard and Safari/iOS have not been tested.
`viewport-fit=cover` was not added. The layout retains the browser's default
cutout handling and its existing bottom safe-area rules; physical-device checks
are still needed before changing that policy.

## Verification

QA artifacts were generated in a temporary directory outside the repository.
Each run has screenshots and a `report.json` with horizontal overflow, escaped
elements, key-action visibility/hit-testing and JavaScript errors.

- `before-core`: 28 baseline cases on 320×568, 390×844, 844×390 and 1440×900.
- `after-full`: 216 cases (27 states × 8 viewports): 320×568, 360×800, 390×844,
  430×932, 768×1024, 1024×768, 1440×900 and 844×390. No page horizontal overflow
  or JavaScript errors; one clipped send button, subsequently fixed (bug 7).
- `after-final`: an intermediate attempt failed six appearance/delete checks;
  it was rejected and was never installed in production.
- `after-corrected`: all 12 targeted cases pass on 320×568 and 844×390, including
  simultaneous open appearance + long draft + files. Both pending files can be
  removed without losing the draft; the textarea scrolls.
- `final-short`: all 62 cases pass (31 states × 320×568 and 844×390), including
  scrolling to the last pattern and a trial click, the bottom of connection/tool
  settings and pending-file removal without losing the draft. No escaped elements,
  clipped/covered key actions, page horizontal overflow or JavaScript errors.
- `desktop-reference`: four clean BEFORE states at 1440×900 (feed, appearance,
  connection settings, gallery) pass; compared visually with the AFTER screenshots.
  The layout and styling are preserved. Animated media/frame timing means this is
  not a claim of pixel-identical image files.
- `reduced`: all six cases pass (feed, end of appearance, end of tools at 320×568
  and 1440×900 with `prefers-reduced-motion: reduce`).

States covered by the matrix: feed/search/empty/error/working notices, gallery,
image/tall image/video/audio viewer, chat top/bottom/Markdown/table/code/title
editing/appearance/delete/composer/empty/research/error, profile, all three
settings tabs (including model selectors and local placeholder key fields),
sorting idle and running. Progress, error and running states use local fixtures.

The browser is a separate sandboxed Brave context. Requests are restricted to
the isolated localhost stands on 3112/3113. Both stands use new synthetic demo
databases; no production/demo user data or API keys are copied into QA. Agentation
is hidden only by the QA harness to prevent its demo-only toolbar from covering
production UI controls. Original assets and SL source files match the baseline.

Not verified: physical phones/tablets, real on-screen keyboards, Safari/iOS,
Firefox, notched-device safe areas or native mobile shells. Responsive viewport
emulation does not establish those behaviors. No paid application API calls were
made; lint, typecheck, Electron and the backend test suite were not run.

The QA process starts only its own 3112/3113 servers and closes them and the
browser in `finally`. The temporary harness and screenshots are not release
artifacts; the repository does not include a reproducible browser QA command.

## Installation

The production image includes the responsive CSS and viewport meta. Deploy it
using the backup and update procedure in [backend.md](backend.md). User data,
local backup locations and installation fingerprints are not release artifacts.
Historical production checks used HTTP only; browser scenarios used isolated
synthetic stands.
