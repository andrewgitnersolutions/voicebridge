/**
 * VoiceBridge — Voice Comment Bubble Renderer
 * Builds a Google Docs comment-styled bubble card with a large Play/Pause button
 * and a Rewind 5s button, so students can listen to a voice note — and re-hear the
 * bit they missed — without ever leaving the Doc, Slide, or Classroom page.
 *
 * The same card component is reused in two places:
 *   1. Inline — replacing VoiceBridge Drive links found inside comment threads.
 *   2. Post-recording — the confirmation bubble content.js pops open right after
 *      a recording is uploaded (see window.VoiceBridgePlayer.createPlayerCard).
 */

(function () {
  if (window.__voicebridgePlayerInjected) return;
  window.__voicebridgePlayerInjected = true;

  const PROCESSED_ATTR = 'data-voicebridge-rendered';
  const DRIVE_LINK_REGEX = /https:\/\/drive\.google\.com\/(?:file\/d\/|(?:uc|open)\?(?:[\w=&]*\b)?id=)([a-zA-Z0-9_-]+)/;
  const REWIND_SECONDS = 5;

  // Google Docs (Kix) & Google Slides (Punch) drawing surface — never touch it.
  // Scoped to the rendered page and the hidden edit iframe ONLY. It must not
  // include app-shell wrappers like .kix-appview, #docs-editor or
  // .docs-ui-unprintable: those wrap the whole editor, comment sidebar included,
  // so guarding on them hides every comment from the player.
  const CANVAS_SELECTOR =
    '.docs-texteventtarget-iframe, .kix-page, .kix-canvas-tile-content, ' +
    '.punch-canvas, .punch-viewer-page, .punch-texteventtarget-iframe, ' +
    '.punch-stage, .punch-full-window-overlay';
  const SPEEDS = [1.0, 1.25, 1.5, 2.0, 0.75];

  // A listener needs to know which of these happened. "Not shared with you" is a
  // person-to-person fix, "deleted" is unrecoverable and "network" is worth
  // retrying — a single generic error told a teacher none of that.
  const ERROR_MESSAGES = {
    not_shared: 'You do not have access to this recording yet. Ask whoever recorded it to share the file with you.',
    not_found: 'This recording is no longer in Google Drive. It may have been deleted.',
    not_authenticated: 'Sign in to your Google account to play this recording.',
    network: 'Could not reach Google Drive. Check your connection, then try again.',
    invalid_id: 'This voice note link is not readable.',
    drive_error: 'Google Drive could not return this recording.',
    playback: 'This recording could not be played.'
  };

  // Crisp inline SVG glyphs — no emoji font fallbacks, scale cleanly at any zoom
  const ICONS = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.29-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><rect x="6" y="4" width="4.5" height="16" rx="1.5"/><rect x="13.5" y="4" width="4.5" height="16" rx="1.5"/></svg>',
    rewind: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3.5 12a8.5 8.5 0 1 0 2.9-6.4"/><polyline points="3.2 3.6 3.2 9.4 9 9.4"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3z"/><path d="M18 11a1 1 0 1 0-2 0 4 4 0 0 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.91V19H9a1 1 0 1 0 0 2h6a1 1 0 0 0 0-2h-2v-2.09A6 6 0 0 0 18 11z"/></svg>'
  };

  let isScanning = false;
  let debounceTimeout = null;

  // Playback speed was per-card and per-session, so a student who needs 0.75x
  // reset it on every note they opened. Remembered across notes and sessions.
  let preferredSpeed = SPEEDS[0];
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    try {
      chrome.storage.local.get(['playbackRate'], (stored) => {
        const rate = Number(stored && stored.playbackRate);
        if (SPEEDS.indexOf(rate) !== -1) preferredSpeed = rate;
      });
    } catch (e) {}
  }

  // toFixed(1) rendered the 1.25x step as "x1.3" and announced it as 1.3x —
  // a speed the player never actually plays at.
  function formatSpeed(rate) {
    return Number.isInteger(rate) ? rate.toFixed(1) : String(rate);
  }

  function rememberSpeed(rate) {
    preferredSpeed = rate;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try { chrome.storage.local.set({ playbackRate: rate }); } catch (e) {}
    }
  }

  function isExcludedOrEditing(el) {
    if (!el) return true;

    // 1. Never inject inside Google Docs link hovercards, bubbles, or smart chip popups
    if (el.closest?.(
      '.docs-bubble, .docs-linkbubble-bubble, .appsElementsLinkPreview, .docos-linkbubble, #docos-link-bubble, ' +
      '.docs-hovercard-bubble, .docs-material-hovercard, ' +
      '.docs-link-bubble, .docs-chip-hovercard, .docs-hovercard, ' +
      '.docos-hovercard, [role="tooltip"], .sketchy-bubble'
    )) {
      return true;
    }

    // 2. Never touch active editing targets (inputs, textareas, active comment editing boxes)
    if (
      el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.isContentEditable ||
      el.closest?.('.docos-input-textarea, .docos-streamdocos-input, textarea, input, [contenteditable="true"]')
    ) {
      return true;
    }

    // 3. Never touch the Google Docs or Google Slides drawing surface
    if (el.closest?.(CANVAS_SELECTOR)) {
      return true;
    }

    // 4. Never inject inside VoiceBridge's own elements
    if (el.closest?.('.voicebridge-inline-player, #voicebridge-modal-overlay, #voicebridge-floating-trigger, #voicebridge-voice-bubble')) {
      return true;
    }

    return false;
  }

  function formatTime(totalSeconds) {
    const secs = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const mins = Math.floor(secs / 60);
    return `${mins}:${(secs % 60).toString().padStart(2, '0')}`;
  }

  // "0:12" / "1:05:30" -> seconds. The inverse of formatTime, used because the
  // chip text is the only reliable length a Drive-streamed note carries.
  function parseClock(text) {
    if (!text) return 0;
    const parts = String(text).trim().split(':').map(Number);
    if (!parts.length || parts.some(isNaN)) return 0;
    return parts.reduce((total, part) => total * 60 + part, 0);
  }

  function extractDuration(rawText) {
    if (!rawText) return '';
    // Last match, not first. The text handed in runs UP TO the link, so with two
    // notes in one comment the run before the second link still contains the
    // first note's label — taking the first match labelled both notes 0:05.
    const labelled = rawText.match(/VoiceBridge Note\s*\(([^)]+)\)/gi);
    if (labelled && labelled.length) {
      const last = labelled[labelled.length - 1].match(/\(([^)]+)\)/);
      if (last) return last[1];
    }
    const any = rawText.match(/\(([^)]+)\)/g);
    if (any && any.length) {
      const last = any[any.length - 1].match(/\(([^)]+)\)/);
      if (last) return last[1];
    }
    return '';
  }

  // Text running up to the link, so the duration read for a note is the one
  // written next to it rather than the first one in the whole comment.
  function textBefore(link) {
    let text = '';
    let node = link.previousSibling;
    while (node && text.length < 240) {
      text = (node.textContent || '') + text;
      node = node.previousSibling;
    }
    return text;
  }

  /**
   * Builds the voice comment bubble card.
   *
   * @param {Object} options
   * @param {string} [options.fileId]          Google Drive file id to stream from.
   * @param {string} [options.localSrc]        Blob/object URL played directly (skips Drive fetch).
   * @param {string} [options.durationText]    Pre-formatted duration, e.g. "0:12".
   * @param {number} [options.durationSeconds] Duration in seconds (used when durationText is absent).
   * @param {string} [options.title]           Header label. Defaults to "Voice Note".
   * @param {string} [options.subtitle]        Header sub-label. Defaults to the duration.
   * @param {boolean} [options.insideComment]  True when nested in a native Google Docs comment card.
   * @param {boolean} [options.bubble]         True for the free-floating speech-bubble variant.
   * @param {Function} [options.onDismiss]     When given, the header shows a close button.
   */
  function createPlayerCard(options) {
    const opts = options || {};
    // Sanitize file ID (only safe alphanumeric, underscore, hyphen)
    const safeFileId = String(opts.fileId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const localSrc = opts.localSrc || '';
    const durationStr = opts.durationText || (opts.durationSeconds ? formatTime(opts.durationSeconds) : '');

    // Main Google Docs-style comment container
    const playerContainer = document.createElement('div');
    playerContainer.className = 'voicebridge-inline-player vb-gdoc-comment-card' +
      (opts.insideComment ? ' vb-inside-gdoc-comment' : '') +
      (opts.bubble ? ' vb-bubble-variant' : '');
    playerContainer.setAttribute('role', 'group');
    playerContainer.setAttribute('aria-label', 'Voice comment player');
    // Identifies which note this card plays, so the scanner can tell "already
    // rendered" from "a second, different note in the same comment"
    if (safeFileId) playerContainer.setAttribute('data-voicebridge-file-id', safeFileId);

    // 1. Google Docs Comment Header (Avatar, Author, Timestamp, Kebab / Close)
    const header = document.createElement('div');
    header.className = 'vb-gdoc-comment-header vb-player-header';

    const avatar = document.createElement('div');
    avatar.className = 'vb-gdoc-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.innerHTML = `<span class="vb-gdoc-avatar-icon">${ICONS.mic}</span>`;

    const authorMeta = document.createElement('div');
    authorMeta.className = 'vb-gdoc-author-meta';

    const authorName = document.createElement('span');
    authorName.className = 'vb-gdoc-author-name vb-player-title';
    authorName.textContent = opts.title || 'Voice Note';

    const timestamp = document.createElement('span');
    timestamp.className = 'vb-gdoc-timestamp';
    timestamp.textContent = opts.subtitle || (durationStr ? `${durationStr} recording` : 'Just now');

    authorMeta.appendChild(authorName);
    authorMeta.appendChild(timestamp);

    const menuBtn = document.createElement('button');
    menuBtn.className = 'vb-gdoc-menu-btn';
    menuBtn.type = 'button';
    menuBtn.setAttribute('title', opts.onDismiss ? 'Close' : 'Options');
    menuBtn.setAttribute('aria-label', opts.onDismiss ? 'Close voice comment' : 'Options');
    menuBtn.textContent = opts.onDismiss ? '✕' : '⋮';
    if (opts.onDismiss) {
      menuBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        opts.onDismiss();
      });
    }

    header.appendChild(avatar);
    header.appendChild(authorMeta);
    header.appendChild(menuBtn);

    // 2. Comment body: Rewind 5s and a big Play/Pause — no raw link text
    const commentBody = document.createElement('div');
    commentBody.className = 'vb-gdoc-comment-body';

    const controlsRow = document.createElement('div');
    controlsRow.className = 'vb-gdoc-player-controls vb-player-controls';

    // Rewind button (left circular arrow)
    const rewindBtn = document.createElement('button');
    rewindBtn.type = 'button';
    rewindBtn.className = 'vb-gdoc-btn vb-gdoc-circle-btn vb-gdoc-rewind-btn';
    rewindBtn.setAttribute('title', `Rewind ${REWIND_SECONDS} seconds`);
    rewindBtn.setAttribute('aria-label', `Rewind ${REWIND_SECONDS} seconds`);
    rewindBtn.innerHTML = `<span class="vb-gdoc-btn-icon">${ICONS.rewind}</span>`;

    // Play / Pause button (large centered circle)
    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'vb-gdoc-btn vb-gdoc-play-btn vb-play-btn';
    playBtn.setAttribute('title', 'Play');
    playBtn.setAttribute('aria-label', 'Play voice comment');
    playBtn.innerHTML = `<span class="vb-gdoc-btn-icon">${ICONS.play}</span>`;

    controlsRow.appendChild(rewindBtn);
    controlsRow.appendChild(playBtn);

    // Timeline / Scrubber Row
    const scrubberRow = document.createElement('div');
    scrubberRow.className = 'vb-gdoc-scrubber-row';

    const timeCurrent = document.createElement('span');
    timeCurrent.className = 'vb-gdoc-time-current vb-time-display';
    timeCurrent.textContent = '0:00';

    const scrubberTrack = document.createElement('div');
    scrubberTrack.className = 'vb-gdoc-scrubber-track vb-scrubber-track';
    // Slider, not progressbar: this track responds to arrow keys and clicks, and
    // a progressbar tells assistive technology the opposite — that it is
    // read-only. aria-valuetext gives a time rather than a bare percentage.
    scrubberTrack.setAttribute('role', 'slider');
    scrubberTrack.setAttribute('aria-label', 'Playback position');
    scrubberTrack.setAttribute('aria-valuemin', '0');
    scrubberTrack.setAttribute('aria-valuemax', '100');
    scrubberTrack.setAttribute('aria-valuenow', '0');
    scrubberTrack.setAttribute('aria-valuetext', '0:00');
    scrubberTrack.setAttribute('tabindex', '0');

    const progressBar = document.createElement('div');
    progressBar.className = 'vb-gdoc-scrubber-progress vb-scrubber-progress';
    scrubberTrack.appendChild(progressBar);

    const timeDuration = document.createElement('span');
    timeDuration.className = 'vb-gdoc-time-duration';
    timeDuration.textContent = durationStr || '0:00';

    const speedBtn = document.createElement('button');
    speedBtn.type = 'button';
    speedBtn.className = 'vb-gdoc-speed-btn vb-speed-btn';
    speedBtn.setAttribute('title', 'Playback Speed');
    speedBtn.setAttribute('aria-label', `Playback speed ${formatSpeed(preferredSpeed)}x`);
    speedBtn.textContent = `x${formatSpeed(preferredSpeed)}`;

    scrubberRow.appendChild(timeCurrent);
    scrubberRow.appendChild(scrubberTrack);
    scrubberRow.appendChild(timeDuration);
    scrubberRow.appendChild(speedBtn);

    // Failure message. Lives in the card rather than flashing through the time
    // display, so it is readable, announced, and stays put long enough to act on.
    const errorRow = document.createElement('div');
    errorRow.className = 'vb-gdoc-error';
    errorRow.setAttribute('role', 'status');
    errorRow.setAttribute('aria-live', 'polite');
    errorRow.hidden = true;

    commentBody.appendChild(controlsRow);
    commentBody.appendChild(scrubberRow);
    commentBody.appendChild(errorRow);

    // 3. In-page audio element (100% self-contained, no tab opening)
    const audio = document.createElement('audio');
    audio.preload = localSrc ? 'metadata' : 'none';
    audio.style.display = 'none';
    if (localSrc) audio.src = localSrc;

    playerContainer.appendChild(header);
    playerContainer.appendChild(commentBody);
    playerContainer.appendChild(audio);

    // MediaRecorder writes webm with no duration header, so audio.duration reads
    // Infinity for every Drive-streamed note. Every control that divided by it
    // bailed out early: the scrubber never moved, the total never appeared, and
    // clicking or arrowing along the track silently did nothing. The chip text
    // carries the real length, so fall back to that.
    const declaredSeconds = parseClock(durationStr) || Number(opts.durationSeconds) || 0;

    function effectiveDuration() {
      if (audio.duration && isFinite(audio.duration) && audio.duration > 0) return audio.duration;
      return declaredSeconds;
    }

    function renderPosition(seconds) {
      const total = effectiveDuration();
      const clamped = Math.max(0, total ? Math.min(seconds, total) : seconds);
      const progress = total ? (clamped / total) * 100 : 0;
      progressBar.style.width = `${progress}%`;
      scrubberTrack.setAttribute('aria-valuenow', Math.round(progress));
      scrubberTrack.setAttribute(
        'aria-valuetext',
        total ? `${formatTime(clamped)} of ${formatTime(total)}` : formatTime(clamped)
      );
      timeCurrent.textContent = formatTime(clamped);
      if (total) timeDuration.textContent = formatTime(total);
    }

    let currentSpeedIdx = Math.max(0, SPEEDS.indexOf(preferredSpeed));
    // Applied here, not where the element is built: currentSpeedIdx is declared
    // below that point and reading it earlier is a temporal-dead-zone throw that
    // takes the whole scan down with it.
    audio.playbackRate = SPEEDS[currentSpeedIdx];
    let audioBlobUrl = null;
    let isFetching = false;
    // Why the API read failed, kept while the direct-Drive-URL fallback is tried.
    // If that fallback also fails, this is the reason worth reporting — the audio
    // element itself can only ever say "format not supported".
    let lastFailureReason = null;

    function ensureAudioSource(allowInteractive) {
      if (audio.src) return Promise.resolve();
      if (isFetching) return Promise.reject('Fetching already in progress');
      isFetching = true;

      return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            action: 'FETCH_DRIVE_AUDIO',
            payload: { fileId: safeFileId, interactive: !!allowInteractive }
          }, (res) => {
            isFetching = false;
            if (chrome.runtime.lastError) lastFailureReason = 'network';
            if (res && res.success && res.base64Audio) {
              lastFailureReason = null;
              try {
                const parts = res.base64Audio.split(',');
                const byteCharacters = atob(parts[1] || parts[0]);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                  byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'audio/webm' });
                audioBlobUrl = URL.createObjectURL(blob);
                audio.src = audioBlobUrl;
                resolve();
                return;
              } catch (e) {
                console.warn('[VoiceBridge] Failed to parse proxied audio:', e);
                lastFailureReason = 'playback';
              }
            } else if (res && res.reason) {
              lastFailureReason = res.reason;
            }
            // Fallback to the direct stream URL. This only works when the file was
            // successfully link-shared at upload time, which district policy often
            // forbids — so keep the reason above for when it does not.
            audio.src = `https://drive.google.com/uc?export=download&id=${safeFileId}`;
            resolve();
          });
        } else {
          isFetching = false;
          audio.src = `https://drive.google.com/uc?export=download&id=${safeFileId}`;
          resolve();
        }
      });
    }

    function setPlayState(isPlaying) {
      const icon = playBtn.querySelector('.vb-gdoc-btn-icon');
      if (isPlaying) {
        playBtn.classList.add('vb-playing');
        if (icon) icon.innerHTML = ICONS.pause;
        playBtn.setAttribute('title', 'Pause');
        playBtn.setAttribute('aria-label', 'Pause voice comment');
      } else {
        playBtn.classList.remove('vb-playing');
        if (icon) icon.innerHTML = ICONS.play;
        playBtn.setAttribute('title', 'Play');
        playBtn.setAttribute('aria-label', 'Play voice comment');
      }
    }

    function showError(reason) {
      errorRow.textContent = ERROR_MESSAGES[reason] || ERROR_MESSAGES.playback;
      errorRow.hidden = false;
      setPlayState(false);
    }

    function clearError() {
      errorRow.hidden = true;
      errorRow.textContent = '';
    }

    function startPlayback() {
      clearError();
      return ensureAudioSource(true).then(() => {
        return audio.play().then(() => {
          setPlayState(true);
          clearError();
        });
      }).catch((err) => {
        console.warn('[VoiceBridge] Audio stream blocked:', err);
        // Stay in page, do not open a separate tab
        showError(lastFailureReason || 'playback');
      });
    }

    // The direct-URL fallback fails here: Drive answers a denied request with an
    // HTML sign-in page, which the audio element reports only as a decode error.
    audio.addEventListener('error', () => {
      if (!audio.src) return;
      showError(lastFailureReason || 'playback');
    });

    // Play / Pause toggle
    playBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (audio.paused) {
        startPlayback();
      } else {
        audio.pause();
        setPlayState(false);
      }
    });

    // Rewind button — steps back a few seconds, leaving play/pause state alone
    rewindBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      ensureAudioSource(true).then(() => {
        const target = Math.max(0, audio.currentTime - REWIND_SECONDS);
        audio.currentTime = target;
        renderPosition(target);
      }).catch(() => showError(lastFailureReason || 'playback'));
    });

    // Chrome only learns a headerless webm's real length by scanning to the end,
    // which a seek past the end forces. Once the duration is known, seeking works
    // properly and audio.duration takes over from the chip text.
    //
    // Only ever while paused: the probe moves the playhead, so running it during
    // playback would cut the audio off mid-word.
    let durationProbed = false;

    function probeDurationOnce() {
      if (durationProbed || !audio.paused) return;
      if (!audio.duration || isFinite(audio.duration)) return;
      durationProbed = true;
      const onResolved = () => {
        if (!isFinite(audio.duration)) return;
        audio.removeEventListener('durationchange', onResolved);
        try { audio.currentTime = 0; } catch (e) {}
        renderPosition(0);
      };
      audio.addEventListener('durationchange', onResolved);
      try { audio.currentTime = 1e101; } catch (e) {}
    }

    audio.addEventListener('loadedmetadata', () => {
      renderPosition(audio.currentTime || 0);
      probeDurationOnce();
    });

    audio.addEventListener('durationchange', () => {
      if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
        renderPosition(audio.currentTime || 0);
      }
    });

    // Time update and scrubber
    audio.addEventListener('timeupdate', () => {
      renderPosition(audio.currentTime);
    });

    audio.addEventListener('ended', () => {
      setPlayState(false);
      audio.currentTime = 0;
      renderPosition(0);
    });

    audio.addEventListener('pause', () => setPlayState(false));

    // Scrubber click + keyboard seeking
    function seekTo(seconds) {
      const total = effectiveDuration();
      if (!total) return;
      const target = Math.max(0, Math.min(seconds, total));
      ensureAudioSource(true).then(() => {
        audio.currentTime = target;
        renderPosition(target);
      }).catch(() => showError(lastFailureReason || 'playback'));
    }

    scrubberTrack.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = scrubberTrack.getBoundingClientRect();
      if (!rect.width) return;
      seekTo(((e.clientX - rect.left) / rect.width) * effectiveDuration());
    });

    scrubberTrack.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekTo(audio.currentTime + 5);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekTo(audio.currentTime - 5);
      } else if (e.key === 'Home') {
        e.preventDefault();
        seekTo(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        seekTo(effectiveDuration());
      }
    });

    // Playback speed cycle
    speedBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      currentSpeedIdx = (currentSpeedIdx + 1) % SPEEDS.length;
      const newSpeed = SPEEDS[currentSpeedIdx];
      audio.playbackRate = newSpeed;
      speedBtn.textContent = `x${formatSpeed(newSpeed)}`;
      speedBtn.setAttribute('aria-label', `Playback speed ${formatSpeed(newSpeed)}x`);
      rememberSpeed(newSpeed);
    });

    // Exposed so content.js can focus and tear down the card it mounts
    playerContainer.__voicebridgeControls = {
      focusPlay: () => playBtn.focus(),
      destroy: () => {
        try { audio.pause(); } catch (e) {}
        if (audioBlobUrl) URL.revokeObjectURL(audioBlobUrl);
        audioBlobUrl = null;
      }
    };

    return playerContainer;
  }

  function createInlinePlayer(fileId, originalLink, rawText, isInsideComment) {
    return createPlayerCard({
      fileId: fileId,
      durationText: extractDuration(rawText),
      insideComment: isInsideComment
    });
  }

  // Hide the original raw comment text and Drive link so only the Google Docs player is shown
  function hideRawCommentContent(element) {
    if (!element) return;
    element.classList.add('vb-hide-raw-text');
    element.style.display = 'none';

    // Also hide adjacent text or sibling nodes that mention VoiceBridge or Drive
    const parent = element.parentElement;
    if (parent) {
      Array.from(parent.childNodes).forEach((node) => {
        if (node === element || (node.classList && node.classList.contains('voicebridge-inline-player'))) return;
        if (node.nodeType === 3 /* Node.TEXT_NODE */) {
          const content = node.textContent || '';
          if (content.includes('VoiceBridge') || content.includes('🎙️') || content.includes('drive.google.com') || content.includes('Listen:')) {
            const span = document.createElement('span');
            span.className = 'vb-hide-raw-text';
            span.style.display = 'none';
            node.replaceWith(span);
            span.appendChild(node);
          }
        } else if (node.nodeType === 1 /* Element */) {
          const text = node.textContent || '';
          if (text.includes('VoiceBridge') || text.includes('🎙️') || text.includes('Listen:')) {
            node.classList.add('vb-hide-raw-text');
            node.style.display = 'none';
          }
        }
      });
    }
  }

  function extractDriveFileInfo(link) {
    if (!link) return null;
    const candidates = [
      link.getAttribute('data-rawhref'),
      link.getAttribute('href'),
      link.href
    ];
    for (const raw of candidates) {
      if (!raw) continue;
      let match = raw.match(DRIVE_LINK_REGEX);
      if (match && match[1]) {
        return { fileId: match[1], url: raw };
      }
      try {
        const decoded = decodeURIComponent(raw);
        match = decoded.match(DRIVE_LINK_REGEX);
        if (match && match[1]) {
          return { fileId: match[1], url: decoded };
        }
      } catch (e) {}
    }
    return null;
  }

  // Any Docs/Slides comment widget. Kept broad on purpose: this only decides
  // whether the card renders chromeless (Docs already draws its own author row).
  const NATIVE_COMMENT_SELECTOR = '[class*="docos-"]';

  // --- Host surface brightness ------------------------------------------------
  //
  // Google Docs' dark theme is not exposed as a stable class or attribute, and
  // prefers-color-scheme reports the OS setting rather than the document's — a Doc
  // left in light mode on a dark-themed machine would get a dark, unreadable card.
  // So measure the surface the card is actually sitting on. That is true whatever
  // Docs decides to call its theme, and it covers any other dark host page for free.

  function parseCssColor(value) {
    const match = /rgba?\(([^)]+)\)/.exec(value || '');
    if (!match) return null;
    const parts = match[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some(isNaN)) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }

  // Perceived brightness, 0 (black) to 1 (white). sRGB coefficients.
  function brightnessOf(color) {
    return (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255;
  }

  function surfaceIsDark(el) {
    let node = el;
    // Walk up until something actually paints. Comment cards are usually
    // transparent over the sidebar, so the first opaque ancestor is the answer.
    for (let depth = 0; node && depth < 12; depth++) {
      const color = parseCssColor(getComputedStyle(node).backgroundColor);
      if (color && color.a > 0.5) return brightnessOf(color) < 0.45;
      node = node.parentElement;
    }
    const bodyColor = document.body && parseCssColor(getComputedStyle(document.body).backgroundColor);
    return bodyColor ? brightnessOf(bodyColor) < 0.45 : false;
  }

  // Call once the card is in the document — computed styles need it mounted.
  function applySurfaceTheme(playerContainer) {
    if (!playerContainer || !playerContainer.isConnected) return;
    try {
      playerContainer.classList.toggle('vb-dark-surface', surfaceIsDark(playerContainer.parentElement));
    } catch (e) {}
  }

  function scanAndRenderPlayers() {
    if (isScanning) return;
    isScanning = true;

    try {
      // 1. Scan for anchor tags containing Drive voice links (including google.com/url wrappers and data-rawhref)
      const links = document.querySelectorAll(
        'a[href*="drive.google.com"]:not([' + PROCESSED_ATTR + ']), ' +
        'a[data-rawhref*="drive.google.com"]:not([' + PROCESSED_ATTR + ']), ' +
        'a[href*="google.com/url?q="]:not([' + PROCESSED_ATTR + '])'
      );
      links.forEach((link) => {
        if (isExcludedOrEditing(link)) return;

        const info = extractDriveFileInfo(link);
        if (info && info.fileId) {
          const fileId = info.fileId;
          const rawText = link.closest('div, p, span')?.textContent || link.textContent;

          const isAudioLink = rawText.includes('VoiceBridge') ||
                              rawText.includes('🎙️') ||
                              rawText.includes('Voice Note') ||
                              /\.(webm|mp3|wav|ogg|m4a)/i.test(rawText) ||
                              /\.(webm|mp3|wav|ogg|m4a)/i.test(info.url) ||
                              info.url.includes('export=download');

          if (isAudioLink) {
            const parent = link.parentElement;
            // Keyed per note, not per parent. A comment holding two voice notes
            // used to render only the first: the second was marked processed
            // before this guard, so it got no player, never retried on a later
            // scan, and — because hideRawCommentContent lives inside the guard —
            // left its raw Drive URL on screen.
            const alreadyRendered = parent && parent.querySelector(
              '.voicebridge-inline-player[data-voicebridge-file-id="' + fileId + '"]'
            );
            link.setAttribute(PROCESSED_ATTR, 'true');
            if (parent && !alreadyRendered) {
              const isInsideNativeGDocComment = !!link.closest?.(NATIVE_COMMENT_SELECTOR);
              // Duration comes from the text beside this link; rawText (the whole
              // enclosing block) is only used above to decide it is one of ours
              const player = createInlinePlayer(
                fileId, info.url, textBefore(link) || rawText, isInsideNativeGDocComment
              );
              // Hide raw text and insert Google Docs comment player
              hideRawCommentContent(link);
              parent.appendChild(player);
              applySurfaceTheme(player);
            }
          }
        }
      });

      // 2. Scan for plain text in submitted comment cards (strict leaf elements only)
      const textContainers = document.querySelectorAll(
        '[class*="docos-replyview"], [class*="docos-anchoredreplyview"], ' +
        '[class*="docos-docoview"], [class*="docos-streamdocos"], ' +
        'div[data-message-id], .vb-rendered-comment'
      );
      textContainers.forEach((container) => {
        if (container.getAttribute(PROCESSED_ATTR) || isExcludedOrEditing(container)) return;
        if (container.querySelector('.voicebridge-inline-player, textarea, input, [contenteditable="true"]')) return;

        const text = container.textContent;
        if (text.includes('VoiceBridge') && text.includes('drive.google.com')) {
          let match = text.match(DRIVE_LINK_REGEX);
          if (!match) {
            try {
              match = decodeURIComponent(text).match(DRIVE_LINK_REGEX);
            } catch (e) {}
          }
          if (match && match[1]) {
            container.setAttribute(PROCESSED_ATTR, 'true');
            const fileId = match[1];
            const isInsideNativeGDocComment = !!container.closest?.(NATIVE_COMMENT_SELECTOR);
            const player = createInlinePlayer(fileId, match[0], text, isInsideNativeGDocComment);
            // Hide the raw text content inside the comment container
            const bodyEl = container.querySelector('.docos-docoview-body, .docos-body, .docos-comment-content, p') || container;
            if (bodyEl && bodyEl !== container) {
              bodyEl.classList.add('vb-hide-raw-text');
              bodyEl.style.display = 'none';
            }
            container.appendChild(player);
            applySurfaceTheme(player);
          }
        }
      });
    } finally {
      isScanning = false;
    }
  }

  function scheduleScan() {
    if (debounceTimeout) clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      scanAndRenderPlayers();
    }, 60);
  }

  // Periodic scan for dynamic Google Docs comment threads.
  // Skipped while the tab is hidden: this runs whole-document queries twice a
  // second forever, and the machines this ships to are classroom Chromebooks on
  // battery. A hidden tab cannot show a player anyway, and the visibilitychange
  // handler catches up the moment it comes back.
  setInterval(() => {
    if (document.hidden) return;
    scanAndRenderPlayers();
  }, 500);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleScan();
  });

  // Run on load and observe dynamic DOM changes
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanAndRenderPlayers);
  } else {
    scanAndRenderPlayers();
  }

  window.__voicebridgeScanAndRenderPlayers = scanAndRenderPlayers;
  window.VoiceBridgePlayer = {
    createPlayerCard: createPlayerCard,
    // Cards mounted by content.js need the same surface check
    applySurfaceTheme: applySurfaceTheme,
    // Shared with content.js so the guard has exactly one definition
    CANVAS_SELECTOR: CANVAS_SELECTOR
  };

  const observer = new MutationObserver((mutations) => {
    // Ignore mutations that originate from VoiceBridge players to prevent loops
    let shouldScan = false;
    for (const mutation of mutations) {
      if (mutation.target && (
        mutation.target.classList?.contains('voicebridge-inline-player') ||
        mutation.target.closest?.('.voicebridge-inline-player, #voicebridge-modal-overlay, #voicebridge-voice-bubble')
      )) {
        continue;
      }
      shouldScan = true;
      break;
    }

    if (shouldScan) {
      scheduleScan();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
})();
