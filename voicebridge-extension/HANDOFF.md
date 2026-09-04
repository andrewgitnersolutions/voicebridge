# VoiceBridge — Session Handoff

**Branch:** `feature/gdoc-voice-player` · **Base:** `4660791` · **Tests:** 114 passing
**Packaged:** `dist/voicebridge-v1.2.0.zip` (version bumped from 1.1.0; no permission
or OAuth-scope changes, so this should not trigger a fresh Web Store permission review)
**State:** 15 files modified plus `assets/fonts/`, nothing committed. Run `python3 run_tests.py` from `voicebridge-extension/` before you touch anything, so you know the baseline is green.

**Since the last handoff:** all of P0-1 and P0-4, the actionable halves of P0-2 and P0-3, every P1 except P1-8, and a P2 pass. What is left is listed in §6–§8 with the blockers named. Three things need a person, not a patch — see §12.

---

## 0. Orientation — read these four things first

1. `manifest.json` — content script load order is load-bearing (§3).
2. `content/player.js:26` — `CANVAS_SELECTOR`, the single most bug-prone constant in the codebase (§4).
3. `content/content.js:94–160` — `looksLikeCommentField` / `isPublicClassStream` / `collectInboxTargets`, the detection core.
4. §5 of this document — the verification playbook. **Do not write a DOM test before reading it.** Two full sessions were lost to harnesses that passed while the real product was broken.

**Then read §12.** Three items are blocked on something only a person with a real
Classroom and two Workspace accounts can do, and one of them is a regression check
on this session's riskiest change.

---

## 1. What this is, and what shipped

Chrome MV3 extension letting students and teachers leave **voice comments** in Google Docs, Slides and Classroom. Audio uploads to the recorder's own Drive; a link goes into the comment; anyone with the extension sees an inline player instead of the raw link. Marketed for SpEd / K-12 and as FERPA-safe — **privacy defects outrank features here.**

Shipped this session:

- **In-box recorder.** Mic button inside each comment box → records in place → on ✓ writes the Drive link into the box → user presses Comment. Produces a **native Docs comment that persists in the margin**, which was the actual product requirement.
- **Player card** in posted comments: Rewind 5s + Play/Pause, scrubber, `x1.0` speed.
- **Brand palette** aligned to https://voicebridge-ext.web.app (`#4f46e5` / `#4338ca`); root `assets/css/styles.css` is the source of truth.
- **Icon fill hardening** so Docs' CSS can't recolour glyphs.
- Merged two duplicate injectors into one detector; removed a large amount of dead code (§8).

---

## 2. Current file map

| Concern | File |
|---|---|
| Player card factory, posted-comment scanning | `content/player.js` |
| In-box recorder, modal, insertion, floating bubble | `content/content.js` |
| Drive upload, OAuth, audio fetch + cache | `background/service-worker.js` |
| MediaRecorder, level metering, silence detection | `offscreen/offscreen.js` |
| Standalone offline playback page | `player/listen.js` + `listen.html` |
| Popup UI and settings | `popup/` |

**Message pipeline** — reused by both the modal and the in-box recorder. Do not add a parallel one:
`START_RECORDING` → `STOP_RECORDING` → `UPLOAD_TO_DRIVE` → `FETCH_DRIVE_AUDIO` (playback), plus `CANCEL_RECORDING`, `AUDIO_LEVEL_UPDATE`, `SILENCE_WARNING_TRIGGERED`.

**Direction matters.** `chrome.runtime.sendMessage` from the offscreen document
reaches extension pages but **not content scripts** — a content script only receives
`chrome.tabs.sendMessage`. `AUDIO_LEVEL_UPDATE` and `SILENCE_WARNING_TRIGGERED` were
sent the wrong way and had never once arrived, so the live level meter and the "we
didn't hear any sound" warning were dead in both recorders despite being listed
accessibility features. The service worker now relays them to the tab that holds the
recording session. If you add another offscreen→content message, relay it too.

---

## 3. Invariants — breaking any of these breaks the product silently

**Load order.** `manifest.json` → `content_scripts[0].js = ["content/player.js", "content/content.js"]`. `player.js` runs first and both share one isolated world. `content.js` reads `window.VoiceBridgePlayer.CANVAS_SELECTOR` **at module scope**, so if that order flips, `content.js` throws on load and nothing works. The programmatic injection at `popup/popup.js:207` also loads both, in order — keep them in sync.

**Single sources of truth.** Each of these is single *because* duplication already caused a bug:

| Constant / function | Location | Why single |
|---|---|---|
| `CANVAS_SELECTOR` | `player.js:26`, re-exported to `content.js` | Two copies meant fixing it in one file left the other broken |
| `isPublicClassStream()` | `content.js:121`, called only from `add()` | Every detection path funnels through one privacy gate |
| `writeTextIntoInput()` | `content.js` | The only place text enters a comment box |
| `--vb-primary` | `content/content.css` | The player accent derives from it, so themes retint in one place |
| `cacheAudioLocally()` | `service-worker.js` | The only place audio enters storage, so no write can fail silently again |
| `recordingSessionKey()` | `service-worker.js` | One way to name a recording session, so the guard and the relay always agree |
| `renderPosition()` | `player.js` | Every scrubber/time update goes through it, so none can disagree about the duration |
| `detectPageAccount()` | `content.js` | Both upload paths report the account the same way |

---

## 4. Landmines

**A. The canvas guard must never include app-shell wrappers.**
`.kix-appview`, `#docs-editor` and `.docs-ui-unprintable` wrap the *entire* Docs editor, comment sidebar included. Guarding on them rejects every comment box and every posted comment as if it were the drawing canvas — no mic button, no player, and **no error anywhere**. Cover only `.docs-texteventtarget-iframe`, `.kix-page`, `.kix-canvas-tile-content` and the Punch equivalents. Pinned by `test_canvas_guard_excludes_only_the_drawing_surface`.

**B. SVG `fill="currentColor"` is a presentation attribute** — the lowest-priority way to set fill. Any Docs rule matching `svg` or `path` beats it. CSS must restate the fill *and* target the child shapes (`path`, `polyline`, `rect`); a rule matching only the `svg` element leaves Docs' `path` rule winning. This is why the play triangle rendered grey.

**C. Never pin Google's class names.** Detection is structural on purpose. `.docos-input-textarea` alone was an old-UI class and broke on current Docs.

**E. The Classroom gate now fails closed.** On `classroom.google.com`, a surface that
cannot be positively identified as private gets *nothing* — no mic button. If the
feature "disappears" on Classroom, look at `isPrivateClassroomSurface` before
anything else. Docs and Slides are excluded from this rule on purpose; do not
generalise it to them or every comment box loses its button.

**F. Do not add colour literals to the player card.** Every surface, text and error
colour is a token so the dark-surface and high-contrast variants can retint in one
place. `test_card_surface_is_tokenised_for_dark_hosts` fails on any literal
`background:`/`color:` hex inside the player block.

**D. Never mutate the Docs/Slides canvas.** Insertion targets comment boxes only. Body-text insertion would require the `documents` OAuth scope — a scope change with verification consequences, not a code change.

---

## 5. Verification playbook

`python3 run_tests.py` runs 114 static source assertions plus a small DOM simulator. Fast, but it **cannot catch rendering, cascade, or runtime bugs**. It will happily stay green while the extension does nothing in a real document.

**Proven again this session.** A `let` was read above its own declaration inside
`createPlayerCard` — a temporal-dead-zone throw that took down every card on the
page. All 113 tests passed, and `node --check` passed too, because it is valid
syntax. The harness found it in one page load, from the console. If you touch
`player.js` or `content.js`, load them in a browser before you believe the suite.

For anything DOM- or CSS-related:

1. Write a throwaway harness HTML in `voicebridge-extension/`.
2. Serve it — `python3 -m http.server 8791` — because `file://` blocks script execution in the preview pane.
3. Shim `window.chrome` with `runtime.sendMessage`, `runtime.onMessage.addListener`, `storage.onChanged.addListener`, `runtime.getURL` so the content scripts run.
4. Drive it with the browser tools; assert on computed styles and DOM state, not just on screenshots.
5. **Delete the harness and kill the server.** The working tree should stay clean.

**The lesson that cost the most time:** a harness built from the same assumption as the code cannot falsify that assumption. Twice, a mock shaped to match the selector passed while the real Docs DOM could not possibly work. Two rules follow:

- **Build harnesses from real captured DOM.** Ask the user to paste console output from the live document. The snippet that worked:
  ```js
  [...document.querySelectorAll('textarea, input[type=text], [contenteditable=true]')]
    .filter(e => e.getBoundingClientRect().width > 40)
    .map(e => ({ tag: e.tagName, editable: e.isContentEditable, role: e.getAttribute('role'),
      label: e.getAttribute('aria-label') || e.getAttribute('placeholder'),
      cls: (e.className||'').toString().slice(0,80),
      docosAncestor: !!e.closest('[class*="docos-"]') }))
  ```
- **Include hostile host-page rules** so the cascade is actually exercised, e.g.
  `.docos-replyview-body svg path { fill: #5f6368 }`. Without these the icon bug is invisible.

**Preview-pane quirks:** `window.innerHeight` **and `innerWidth`** can read `0`, and
then every element in the page measures 0 wide too (the code treats 0 as "viewport
unknown" — don't "fix" that). Anything that depends on real geometry — the scrubber
is `flex: 1`, so it collapses — needs `resize_window` to a concrete size first, and
`preset: "desktop"` afterwards. Computed styles and screenshots taken immediately
after a class change can be pre-recalc, so wait then re-read; `setTimeout` is
throttled, so don't rely on timer ordering.

**Two more things worth copying from this session's harness:**

- **Measure contrast, don't eyeball it.** Compute the relative-luminance ratio in
  the page. Two colour pairs looked fine and were 2.5:1 and 4.41:1.
- **A card embedded in a Docs comment is `background: transparent` by design**, so
  measuring contrast against the card's own background compares text to nothing.
  Walk up to the first ancestor with alpha > 0.5 — the same walk `surfaceIsDark()`
  does — and measure against that.

---

## 6. P0 — before any classroom pilot

### ~~P0-1 · Local audio cache serves one person's recording to another~~ — DONE

The `vb_fallback_` / `Simulated` branch is gone; `FETCH_DRIVE_AUDIO` serves only the
exact `audio_${fileId}` key and otherwise falls through to Drive. `listen.js` no
longer falls back to `latest_audio` and no longer defaults `id` to `latest`; a
missing key now says the recording is not on this device. All three `latest_audio`
writes are removed.

Guarded by `test_no_shared_latest_audio_key_anywhere` (the string may not appear in
any `.js` file at all) and `test_audio_cache_is_served_only_by_exact_file_id`. Both
were confirmed to fail when the leak is reintroduced.

**One consequence to know about.** The OAuth-failure path used to write the audio to
`latest_audio` "so the user does not lose their recording". Nothing could read that
key except the leak, so it went with it. A recording is now lost if OAuth fails at
upload time. If that matters, give that path a real `vb_fallback_` id and an
addressable `audio_<id>` write, the way the network-failure path already does.

### P0-2 · Public/private Classroom gate — PARTLY DONE, needs real DOM

**Done.** Steps 4, 5 and 6. `content/content.js` now has three word lists
(`COMMENT_WORDS`, `PRIVATE_WORDS`, `CLASS_STREAM_WORDS`) covering ~23 locales, and
the gate **fails closed on Classroom**: `isPublicClassStream` returns true unless
`isPrivateClassroomSurface` can positively identify the surface. Docs and Slides are
explicitly excluded from the fail-closed rule (`IS_CLASSROOM &&`), so ordinary
comment boxes there are unaffected. `looksLikeCommentField`'s English-only regex is
replaced by the same word-list match.

Pinned by `test_class_stream_is_excluded_in_every_shipped_locale`,
`test_private_surfaces_are_recognised_in_every_shipped_locale` and
`test_classroom_gate_fails_closed`. The locale tests read the shipped arrays out of
the source and match them against real Classroom labels, so they test the data
rather than a re-implementation.

**Still open — steps 1 to 3.** The word lists are a stopgap and say so in the code.
The durable fix is a structural discriminator, and that needs Classroom markup
nobody has captured. `isPrivateClassroomSurface` is written as the single place it
plugs in: add the container attribute check as the FIRST test and leave the word
match as the fallback.

**Treat `data-is-private="true"` as unverified.** It predates this work — it is in
the Classroom selector at `content.js:318` and in the fixture at
`test_browser_workflow.py:110`, which *constructs* an element carrying that exact
attribute. So the test passes because the test invented the DOM the code expects,
which is the §5 trap. Nobody has seen it in live Classroom markup. When the DOM is
captured, either confirm it or delete it from both places so the suite stops
validating an assumption.

**Regression check: PASSED (2026-09-04, English locale).** The mic button still
appears on a real Classroom private comment box under the fail-closed gate, so the
change did not kill the feature on its primary surface.

**Exclusion half: also PASSED (2026-09-04, English).** The public "Add class
comment…" box on an assignment gets no mic button. Both sides of the gate are
therefore confirmed in English — the private box works, the class stream is refused.

What that check still does *not* settle:

- **English cannot distinguish the two code paths.** `isPrivateClassroomSurface`
  returns true if `[data-is-private="true"]` matches *or* if an ancestor label
  contains a word from `PRIVATE_WORDS`. In English, "Add private comment" satisfies
  the second on its own — so a pass is consistent with `data-is-private` not
  existing at all (see below).
- **Nor which rule refused the stream box.** The exclusion (`CLASS_STREAM_WORDS`
  matched "class comment") and the fail-closed rule both produce "no button", and a
  screenshot cannot tell them apart. Harmless — the safety property holds either
  way, and the stream is in fact protected twice over — but do not read the pass as
  evidence that the exclusion list is right in any other locale.

**A real locale gap was found and fixed off the back of this.** Brazilian Portuguese
Classroom labels the box "Comentário particular" — *particular*, not *privado*, so
none of the `priv-` stems matched it. Under fail-closed that is not a cosmetic miss:
it removes the mic button entirely for pt-BR. `'particular'` is now in
`PRIVATE_WORDS` with a pt-BR fixture in
`test_private_surfaces_are_recognised_in_every_shipped_locale`.

**Read that as a warning about the method, not a closed issue.** The other ~20
locales in the list have been checked against Classroom strings from knowledge, not
against a live UI. pt-BR was the one that turned out wrong, and there is no reason to
assume it is the only one. The word lists remain a stopgap; the structural
discriminator is the fix.

### P0-3 · Verify the teacher can actually play the audio — STEP 5 DONE, 1-4 BLOCKED

**Done — step 5.** The two-second `⚠️ Error` flash is gone. `FETCH_DRIVE_AUDIO` now
returns a `reason` (`not_shared` / `not_found` / `not_authenticated` / `network` /
`invalid_id` / `drive_error`), the player keeps that reason across the direct-URL
fallback in `lastFailureReason`, and an `error` listener on the audio element
catches the fallback failing — Drive answers a denied request with an HTML sign-in
page, which the element can only report as a decode error. The message renders in a
`role="status"` row inside the card. Contrast measured in a browser: 5.91:1 light,
6.81:1 dark, 5.84:1 high-contrast.

**Blocked — steps 1 to 4.** These need two real accounts in one Workspace domain and
a district-policy configuration. Nothing in the code can substitute. See §12.

The error path is already written for the likely outcome: `drive.file` is
per-app-per-user, so the teacher's token should 403 on the student's file, which now
says "You do not have access to this recording yet. Ask whoever recorded it to share
the file with you." If step 4 shows link sharing is also blocked by policy, that
message is honest but the product still does not work — and that is the
product-level decision this item was really about.

### P0-4 · Multi-account mismatch — STEPS 1-3 DONE, step 4 not started

`detectPageAccount()` in `content.js` reads the `/u/<n>/` index and the signed-in
address from whatever labels the account switcher (attribute probes, no class
names), and both upload paths send it. The service worker resolves the token's own
identity with `drive/v3/about?fields=user(emailAddress)` and, on a positive
mismatch, **stops before `getOrCreateDriveFolder`** — checking after it would leave
a stray "VoiceBridge Recordings" folder in the wrong Drive even on a refused upload.
The message names both addresses and both ways out, and is shown for 12 seconds
rather than the default 4.

It fails open by design: an unresolvable address means "cannot compare", and the
upload proceeds exactly as before. Only a positive mismatch blocks anything.
Pinned by `test_account_mismatch_is_checked_before_any_drive_write`,
`test_account_mismatch_names_both_accounts` and `test_account_check_fails_open`.

**Note.** On a blocked mismatch the recording is discarded and the message says to
record again. If that is too harsh, cache it under a `vb_fallback_` id first.

**Step 4** (`launchWebAuthFlow` with `login_hint`/`authuser`) is untouched — the
original note says to get agreement before building it, and detection is most of
the value.

## 7. P1 — before wider rollout

**All done except P1-8, which is blocked on real Classroom.**

**P1-1 · Maximum recording length — DONE.** `MAX_RECORDING_SECONDS = 300`, enforced
in *both* recorders' own 1-second timers (`content.js`), which are the timers that
actually run. The in-box and modal timers flip to a countdown over the last 30
seconds (`.vb-inbox-timer-ending` / `.vb-timer-ending`) so the stop is announced,
then auto-finish and **keep** the audio. `offscreen.js` carries a backstop 5 seconds
later that `pause()`es the recorder — pause, not stop, because a paused recorder
still answers `requestData()` and `stop()`, whereas stopping would leave the later
`STOP_RECORDING` with an inactive recorder and throw the recording away.

**P1-2 · Storage quota — DONE, by eviction rather than `unlimitedStorage`.** All
three cache writes go through `cacheAudioLocally()`, which evicts oldest-first
against a 6 MB budget and never swallows a failure. Optional writes (post-upload,
post-fetch) skip items over 2 MB, since Drive already has those; the offline
fallback write is `required: true`, ignores the item cap, and its result is
reported — telling a user "audio saved locally" when that write failed sends them
looking for a file that does not exist. `unlimitedStorage` was rejected
deliberately: it would let student voice accumulate indefinitely on a shared
Chromebook, which is the wrong default for this product. **While here:** the 24-hour
`cleanupExpiredRecordings` was parsing the fallback records' `timestamp`, which is a
filename-safe ISO string with hyphens for colons that `Date()` cannot parse — so it
had never deleted anything. It now reads the numeric `cachedAt`.

**P1-3 · OpenDyslexic — DONE.** Both weights bundled at
`assets/fonts/opendyslexic-{regular,bold}.woff2` (SIL OFL 1.1, `OFL.txt` alongside),
with `@font-face` rules in `content.css`, entries in `web_accessible_resources`, and
`assets/` added to `build-zip.sh` — the packaging step would otherwise have shipped
CSS pointing at a missing file, which is the same silent failure again.
`test_every_declared_resource_exists_on_disk` now asserts every path the manifest
names actually exists; `test_bundled_font_backs_the_dyslexic_option` resolves each
`@font-face` `url()` the way Chrome does and checks the file is real.

**P1-4 · Zero-length recordings — DONE.** `MIN_RECORDING_SECONDS = 1`, checked in
both recorders before anything is uploaded, with a message rather than silence.

**P1-5 · Two notes in one comment — DONE.** The guard is keyed per note
(`.voicebridge-inline-player[data-voicebridge-file-id="…"]`) instead of per parent.
Verified in a browser: two links in one comment body render two players.
**This surfaced the P3 `extractDuration` bug** — both players were labelled with the
first note's length — so that is fixed too: `textBefore(link)` supplies only the run
of text up to each link, and `extractDuration` takes the *last* match in it rather
than the first.

**P1-6 · Dark theme — DONE, and not with `prefers-color-scheme`.** The card's
surface colours are tokens (`--vb-player-surface`, `--vb-player-text`,
`--vb-player-text-muted`, `--vb-player-border`, `--vb-player-hover`), with a
`.vb-dark-surface` variant. The class is applied by **measuring** the brightness of
the first opaque ancestor behind the card (`surfaceIsDark()` in `player.js`), not
from the media query: that reports the OS setting, so a Doc left in light mode on a
dark-themed machine would get an unreadable dark card. Docs exposes no stable class
for its own theme; the measured colour is true either way, and it covers any other
dark host page for free. Verified in a browser through a *transparent* comment body
onto a dark host, which is exactly the Docs case.

**P1-7 · Recording state in an evictable worker — DONE.** `activeRecordingSession`
is gone. State lives in `chrome.storage.session` under `vb_recording_session_<tabId>`
(`markRecordingSession` / `clearRecordingSession` / `hasRecordingSession`), so a
worker recycled mid-recording no longer rejects the upload that follows. Keying by
tab also closes the second half: `START_RECORDING` now refuses when another tab
already holds the single offscreen recorder, and `chrome.tabs.onRemoved` releases it
when a tab closes mid-recording.

**P1-8 · Classroom may ignore direct `.value` assignment — NOT STARTED, blocked.**
Unchanged, deliberately: the original note says to test on real Classroom before
writing a fix, and that has not happened. See §12.

## 8. P2 — quality and robustness

**Done this session:**

- **Seeking now works.** `audio.duration` is `Infinity` for MediaRecorder webm, and
  every control divided by it, so all of them bailed out first — the scrubber never
  moved, the total never appeared, clicking and arrowing did nothing.
  `effectiveDuration()` falls back to the chip text parsed by `parseClock()`, all
  position rendering funnels through one `renderPosition()`, and `seekTo()` handles
  click, arrows, Home and End. A guarded `probeDurationOnce()` also seeks past the
  end **while paused** to make Chrome scan for the real duration, after which
  `audio.duration` takes over. Verified in a browser: mid-track click → 1.50s of
  3.00s, quarter click → 0.75s.
- **`role="slider"`** instead of `progressbar` (the track takes arrow keys and
  clicks; progressbar tells assistive tech the opposite), with `aria-valuetext`
  giving a time — "0:01 of 0:03" — rather than a bare percentage.
- **Playback speed is remembered** across notes and sessions in
  `chrome.storage.local.playbackRate`. **While here:** `toFixed(1)` was rendering and
  announcing the 1.25× step as "1.3×", a speed the player never plays at;
  `formatSpeed()` fixes it.
- **Both polls pause on hidden tabs** (`document.hidden` guard plus a
  `visibilitychange` catch-up) — these are whole-document queries running twice a
  second forever on classroom Chromebooks.
- **Stop and upload have deadlines.** A `chrome.runtime.sendMessage` callback simply
  never fires if the worker is torn down mid-request, which left "Saving to your
  Google Drive…" on screen forever. All four long requests go through
  `sendMessageWithTimeout()` (15s stop, 120s upload).
- **The recorder and the player announce themselves.** Toasts carry
  `role="status"` / `aria-live="polite"`, and the player's failure row is a live
  region.

**Not done, still open:**

- **Mic button is keyboard-unreachable in context** — `position: fixed` on `body`
  puts it at the end of the tab order, detached from its comment box. Needs an
  `aria-controls` association at minimum.
- **Ancestor clipping ignored** — `visibleRectOf` checks the viewport only, so the
  button floats when its box scrolls out of the sidebar's own scroll container. An
  `IntersectionObserver` against the scroll parent would fix both this and the
  remaining polling cost.
- **`hideRawCommentContent` can hide the user's own words** when a comment mixes
  typed text with a voice note.
- **Offline fallback inserts a `chrome-extension://` link** that is useless to anyone
  else and publishes the extension ID.
- **Both content scripts run on Google Forms** — `docs.google.com/*` matches
  `/forms/*`, so a field labelled "Your feedback" gets a mic button alongside
  `forms-readaloud.js`. Left alone because it is a product decision, not a bug: if
  it is unwanted, exclude `/forms/*` in `manifest.json`.

## 9. P3 — verify or watch

OAuth consent screen may still be in Testing (100-user cap — **confirm before any pilot**) · Lexend loads from `fonts.googleapis.com` via `@import` in an injected stylesheet (CSP, blocked school networks, FERPA optics — note OpenDyslexic is now bundled locally, so Lexend is the only remaining network font) · stale `selectedAudioDeviceId` after a permission reset · mic disconnect mid-recording is unhandled · extension reload mid-recording orphans the offscreen document · `document.execCommand` is deprecated and is now the main Docs insertion path · Docs undo behaviour after an `execCommand` insert · browser zoom and display scaling with `getBoundingClientRect`-positioned overlays · a player throwing after `hideRawCommentContent` leaves a visibly empty comment · Docs sidebar virtualisation with edited and resolved comments · RTL locales.

Cleared since the last handoff: `extractDuration` grabbing any parenthetical (fixed
with P1-5) · a deleted Drive file leaving a dead play button (it now says the
recording is no longer in Drive).

---

## 10. Do not restore these

Removed deliberately after an audit; re-adding them re-introduces dead code:

`currentActiveTargetInput` · `voiceBubbleAnchor` · `opts.autoplay` · `__voicebridgeControls.play/pause/rewind/audio` · `VoiceBridgePlayer.formatTime` / `.createInlinePlayer` / `.scan` exports · `window.__voicebridgeShowVoiceCommentBubble` / `...Dismiss...` · CSS classes `vb-voice-bubble`, `vb-is-playing`, `vb-gdoc-close-btn` · the separate `injectClassroomPrivateCommentButtons` and `injectSlidesSpeakerNotesButton` functions.

The floating bubble still exists but fires **only when the link had nowhere to land** (`insertLinkIntoComment` returns false). When it goes into a comment box, the comment carries it. Intentional, not dead code.

One genuinely dead item left untouched because it predates this work: `vb-btn-label` in the floating trigger markup is neither styled nor selected.

Added to this list since: `vb-has-error` — a state class the player set on itself
that nothing styled or selected. Report failures through the `.vb-gdoc-error` row.

---

## 11. Conventions

- **Tests pin root causes, not symptoms.** See `test_canvas_guard_excludes_only_the_drawing_surface` — it asserts on the *contents of the constant*, not on whole-file text, so the specific failure cannot return.
- **Colours come from tokens, never literals** — `--vb-primary` and the `--vb-player-*` family. A test asserts the old blue is absent from both stylesheets.
- **Privacy guards fail closed and live on a single path.**
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Do not commit or push unless asked.**

---

## 13. Release notes for 1.2.0

Packaged with `bash build-zip.sh`, which now reads the version from `manifest.json`
rather than restating it — the name was hardcoded to `1.1.0` and would have shipped
an archive labelled with the wrong version after any bump.

**Found while packaging.** `popup.js` opened `test-classroom-simulation.html` from
four places whenever Quick Record could not reach the page — browser-internal pages,
PDFs, or a failed injection. That file is a developer fixture and has never been in
the build, so in every real install those paths opened a blank 404. Replaced with an
in-popup message naming the surfaces that do work; the popup now stays open so the
message can be read.

Both that and the OpenDyslexic bug were the same shape: code naming a file the
package does not contain, invisible to every existing test because neither is a
syntax error. `test_dist_zip_package` now walks every `chrome.runtime.getURL()` call
in the source and fails if the target is not in the archive. Confirmed to fail when
the old reference is put back.

**Before uploading:** confirm the OAuth consent screen is out of Testing (§9) — the
100-user cap applies while it is, and it is the one thing that will stop a pilot
regardless of what is in the package.

---

## 12. Needs a person, not a patch

Three things are blocked on something only you can do. Everything else in §6–§8 is
either done or actionable from the code.

**1. Capture Classroom's markup (unblocks P0-2 steps 1-3, and P1-8).**
Open an assignment that shows *both* a private comment box and the class stream, and
paste the output of this in the console:

```js
[...document.querySelectorAll('textarea, input[type=text], [contenteditable=true]')]
  .filter(e => e.getBoundingClientRect().width > 40)
  .map(e => ({ tag: e.tagName, editable: e.isContentEditable, role: e.getAttribute('role'),
    label: e.getAttribute('aria-label') || e.getAttribute('placeholder'),
    cls: (e.className||'').toString().slice(0,80),
    jscontroller: e.closest('[jscontroller]')?.getAttribute('jscontroller'),
    ancestorData: JSON.stringify(Object.assign({}, e.closest('[data-is-private], [jsname]')?.dataset)),
    docosAncestor: !!e.closest('[class*="docos-"]') }))
```

That gives the structural discriminator to drop into `isPrivateClassroomSurface`.

**Status:** both halves confirmed in English on 2026-09-04 — the private box gets a
button, the public class-comment box does not. This is now hardening, not a release
blocker.

What is still worth doing, in order of value:

1. **Test one non-English UI locale you actually ship to** — switch the Google
   account language at `myaccount.google.com/language` and reload Classroom. pt-BR is
   the obvious candidate; a gap was already found and fixed there by inspection, and
   nothing has confirmed the fix against the live UI.
2. **Capture the DOM** (snippet above) to replace the word lists with a structural
   check, and to settle whether `data-is-private` is real.

**2. The two-account playback test (P0-3 steps 1-4).**
A student account posts a voice comment in a Doc shared with a teacher account in the
same Workspace domain; the teacher presses Play with the extension installed. Capture
the service worker console and the network tab, and note which path succeeded — cache,
`files.get`, or the direct Drive URL. Then repeat with link sharing disabled by admin
policy, which is the realistic district configuration. If both fail there, that is a
product-level decision (share-at-upload, or a different storage model), not a code fix.

**3. Confirm the OAuth consent screen is out of Testing** before any pilot — the
100-user cap applies while it is in Testing.
