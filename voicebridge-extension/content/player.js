/**
 * VoiceBridge — Inline Audio Player Renderer
 * Transforms VoiceBridge comment links in Google Docs, Slides, and Classroom into
 * native Google Docs-styled comment cards featuring Play and Start Over buttons.
 * Keeps playback 100% in-page without navigating away or opening separate Drive tabs.
 */

(function () {
  if (window.__voicebridgePlayerInjected) return;
  window.__voicebridgePlayerInjected = true;

  const PROCESSED_ATTR = 'data-voicebridge-rendered';
  const DRIVE_LINK_REGEX = /https:\/\/drive\.google\.com\/(?:file\/d\/|(?:uc|open)\?(?:[\w=&]*\b)?id=)([a-zA-Z0-9_-]+)/;

  let isScanning = false;
  let debounceTimeout = null;

  function isExcludedOrEditing(el) {
    if (!el) return true;

    // 1. Never inject inside Google Docs link hovercards, bubbles, or smart chip popups
    if (el.closest?.(
      '.docs-bubble, .docs-hovercard-bubble, .docs-material-hovercard, ' +
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

    // 3. Never touch Google Docs or Google Slides editor canvas surface
    if (el.closest?.(
      '.kix-appview, .docs-texteventtarget-iframe, #docs-editor, .kix-page, .kix-canvas-tile-content, ' +
      '.punch-stage, .punch-canvas, .punch-viewer-page, .punch-texteventtarget-iframe, .punch-full-window-overlay'
    )) {
      return true;
    }

    // 4. Never inject inside VoiceBridge's own elements
    if (el.closest?.('.voicebridge-inline-player, #voicebridge-modal-overlay, #voicebridge-floating-trigger')) {
      return true;
    }

    return false;
  }

  function extractDuration(rawText) {
    if (!rawText) return '';
    const match = rawText.match(/VoiceBridge Note\s*\(([^)]+)\)/i) || rawText.match(/\(([^)]+)\)/);
    return match ? match[1] : '';
  }

  function createInlinePlayer(fileId, originalLink, rawText, isInsideComment) {
    // Sanitize file ID (only safe alphanumeric, underscore, hyphen)
    const safeFileId = String(fileId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const durationStr = extractDuration(rawText);

    // Main Google Docs-style comment container
    const playerContainer = document.createElement('div');
    playerContainer.className = 'voicebridge-inline-player vb-gdoc-comment-card' + (isInsideComment ? ' vb-inside-gdoc-comment' : '');
    playerContainer.setAttribute('role', 'region');
    playerContainer.setAttribute('aria-label', 'Voice Comment Player');

    // 1. Google Docs Comment Header (Avatar, Author, Timestamp, Kebab Menu)
    const header = document.createElement('div');
    header.className = 'vb-gdoc-comment-header vb-player-header';

    const avatar = document.createElement('div');
    avatar.className = 'vb-gdoc-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.innerHTML = '<span class="vb-gdoc-avatar-icon">🎙️</span>';

    const authorMeta = document.createElement('div');
    authorMeta.className = 'vb-gdoc-author-meta';

    const authorName = document.createElement('span');
    authorName.className = 'vb-gdoc-author-name vb-player-title';
    authorName.textContent = durationStr ? `Voice Note (${durationStr})` : 'Voice Note';

    const timestamp = document.createElement('span');
    timestamp.className = 'vb-gdoc-timestamp';
    timestamp.textContent = durationStr ? durationStr : 'Just now';

    authorMeta.appendChild(authorName);
    authorMeta.appendChild(timestamp);

    const menuBtn = document.createElement('button');
    menuBtn.className = 'vb-gdoc-menu-btn';
    menuBtn.type = 'button';
    menuBtn.setAttribute('title', 'Options');
    menuBtn.setAttribute('aria-label', 'Options');
    menuBtn.textContent = '⋮';

    header.appendChild(avatar);
    header.appendChild(authorMeta);
    header.appendChild(menuBtn);

    // 2. Google Docs Comment Body: Instead of raw text, Play and Start Over buttons appear
    const commentBody = document.createElement('div');
    commentBody.className = 'vb-gdoc-comment-body';

    const controlsRow = document.createElement('div');
    controlsRow.className = 'vb-gdoc-player-controls vb-player-controls';

    // Play / Pause button
    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'vb-gdoc-btn vb-gdoc-play-btn vb-play-btn';
    playBtn.setAttribute('aria-label', 'Play comment audio');
    playBtn.innerHTML = '<span class="vb-gdoc-btn-icon">▶</span><span class="vb-gdoc-btn-label">Play</span>';

    // Start Over button
    const restartBtn = document.createElement('button');
    restartBtn.type = 'button';
    restartBtn.className = 'vb-gdoc-btn vb-gdoc-restart-btn';
    restartBtn.setAttribute('aria-label', 'Start over comment from beginning');
    restartBtn.innerHTML = '<span class="vb-gdoc-btn-icon">↺</span><span class="vb-gdoc-btn-label">Start Over</span>';

    controlsRow.appendChild(playBtn);
    controlsRow.appendChild(restartBtn);

    // Timeline / Scrubber Row
    const scrubberRow = document.createElement('div');
    scrubberRow.className = 'vb-gdoc-scrubber-row';

    const timeCurrent = document.createElement('span');
    timeCurrent.className = 'vb-gdoc-time-current vb-time-display';
    timeCurrent.textContent = '0:00';

    const scrubberTrack = document.createElement('div');
    scrubberTrack.className = 'vb-gdoc-scrubber-track vb-scrubber-track';
    scrubberTrack.setAttribute('role', 'progressbar');
    scrubberTrack.setAttribute('aria-valuemin', '0');
    scrubberTrack.setAttribute('aria-valuemax', '100');
    scrubberTrack.setAttribute('aria-valuenow', '0');
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
    speedBtn.setAttribute('aria-label', 'Playback Speed 1.0x');
    speedBtn.textContent = '1.0x';

    scrubberRow.appendChild(timeCurrent);
    scrubberRow.appendChild(scrubberTrack);
    scrubberRow.appendChild(timeDuration);
    scrubberRow.appendChild(speedBtn);

    commentBody.appendChild(controlsRow);
    commentBody.appendChild(scrubberRow);

    // 3. In-page audio element (100% self-contained, no tab opening)
    const audio = document.createElement('audio');
    audio.preload = 'none';
    audio.style.display = 'none';

    playerContainer.appendChild(header);
    playerContainer.appendChild(commentBody);
    playerContainer.appendChild(audio);

    let speeds = [1.0, 1.25, 1.5, 2.0, 0.75];
    let currentSpeedIdx = 0;
    let audioBlobUrl = null;
    let isFetching = false;

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
            if (res && res.success && res.base64Audio) {
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
              }
            }
            // Fallback to direct stream URL
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
      const label = playBtn.querySelector('.vb-gdoc-btn-label');
      if (isPlaying) {
        playBtn.classList.add('vb-playing');
        if (icon) icon.textContent = '⏸';
        if (label) label.textContent = 'Pause';
        playBtn.setAttribute('aria-label', 'Pause comment');
      } else {
        playBtn.classList.remove('vb-playing');
        if (icon) icon.textContent = '▶';
        if (label) label.textContent = 'Play';
        playBtn.setAttribute('aria-label', 'Play comment');
      }
    }

    // Play / Pause toggle
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (audio.paused) {
        ensureAudioSource(true).then(() => {
          audio.play().then(() => {
            setPlayState(true);
          }).catch((err) => {
            console.warn('[VoiceBridge] Audio stream blocked:', err);
            // Stay in page, do not open separate tab
            timeCurrent.textContent = '⚠️ Error';
            setTimeout(() => { timeCurrent.textContent = '0:00'; }, 2000);
          });
        }).catch(() => {
          audio.play().catch(() => {});
        });
      } else {
        audio.pause();
        setPlayState(false);
      }
    });

    // Start Over button
    restartBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      audio.currentTime = 0;
      progressBar.style.width = '0%';
      timeCurrent.textContent = '0:00';
      ensureAudioSource(true).then(() => {
        audio.play().then(() => {
          setPlayState(true);
        }).catch((err) => {
          console.warn('[VoiceBridge] Audio restart error:', err);
        });
      }).catch(() => {});
    });

    // Time update and scrubber
    audio.addEventListener('timeupdate', () => {
      if (!audio.duration || isNaN(audio.duration)) return;
      const progress = (audio.currentTime / audio.duration) * 100;
      progressBar.style.width = `${progress}%`;
      scrubberTrack.setAttribute('aria-valuenow', Math.round(progress));

      const curMins = Math.floor(audio.currentTime / 60);
      const curSecs = Math.floor(audio.currentTime % 60).toString().padStart(2, '0');
      timeCurrent.textContent = `${curMins}:${curSecs}`;

      const durMins = Math.floor(audio.duration / 60);
      const durSecs = Math.floor(audio.duration % 60).toString().padStart(2, '0');
      timeDuration.textContent = `${durMins}:${durSecs}`;
    });

    audio.addEventListener('ended', () => {
      setPlayState(false);
      progressBar.style.width = '0%';
      timeCurrent.textContent = '0:00';
      audio.currentTime = 0;
    });

    // Scrubber click seeking
    scrubberTrack.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!audio.duration || isNaN(audio.duration)) return;
      const rect = scrubberTrack.getBoundingClientRect();
      const pos = (e.clientX - rect.left) / rect.width;
      audio.currentTime = pos * audio.duration;
    });

    // Playback speed cycle
    speedBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      currentSpeedIdx = (currentSpeedIdx + 1) % speeds.length;
      const newSpeed = speeds[currentSpeedIdx];
      audio.playbackRate = newSpeed;
      speedBtn.textContent = `${newSpeed}x`;
      speedBtn.setAttribute('aria-label', `Playback Speed ${newSpeed}x`);
    });

    return playerContainer;
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

  function scanAndRenderPlayers() {
    if (isScanning) return;
    isScanning = true;

    try {
      // 1. Scan for anchor tags containing Drive voice links
      const links = document.querySelectorAll('a[href*="drive.google.com"]:not([' + PROCESSED_ATTR + '])');
      links.forEach((link) => {
        if (isExcludedOrEditing(link)) return;

        const match = link.href.match(DRIVE_LINK_REGEX);
        if (match && match[1]) {
          const fileId = match[1];
          const rawText = link.closest('div, p, span')?.textContent || link.textContent;
          
          const isAudioLink = rawText.includes('VoiceBridge') || 
                              rawText.includes('🎙️') || 
                              rawText.includes('Voice Note') || 
                              /\.(webm|mp3|wav|ogg|m4a)/i.test(rawText) || 
                              /\.(webm|mp3|wav|ogg|m4a)/i.test(link.href) || 
                              link.href.includes('export=download');

          if (isAudioLink) {
            link.setAttribute(PROCESSED_ATTR, 'true');
            const parent = link.parentElement;
            if (parent && !parent.querySelector('.voicebridge-inline-player')) {
              const isInsideNativeGDocComment = !!link.closest?.(
                '.docos-docoview-view, .docos-docoview-comment, .docos-comment-view, ' +
                '.docos-replyview, .docos-streamdocos-view, .docos-streamdocos-thread, ' +
                '.docos-anchoredreplyview, .docos-anchored-view'
              );
              const player = createInlinePlayer(fileId, link.href, rawText, isInsideNativeGDocComment);
              // Hide raw text and insert Google Docs comment player
              hideRawCommentContent(link);
              parent.appendChild(player);
            }
          }
        }
      });

      // 2. Scan for plain text in submitted comment cards (strict leaf elements only)
      const textContainers = document.querySelectorAll('.docos-streamdocos-view, .docos-docoview-view, div[data-message-id], .vb-rendered-comment');
      textContainers.forEach((container) => {
        if (container.getAttribute(PROCESSED_ATTR) || isExcludedOrEditing(container)) return;
        if (container.querySelector('.voicebridge-inline-player, textarea, input, [contenteditable="true"]')) return;

        const text = container.textContent;
        if (text.includes('VoiceBridge') && text.includes('drive.google.com')) {
          const match = text.match(DRIVE_LINK_REGEX);
          if (match && match[1]) {
            container.setAttribute(PROCESSED_ATTR, 'true');
            const fileId = match[1];
            const isInsideNativeGDocComment = !!container.closest?.(
              '.docos-docoview-view, .docos-docoview-comment, .docos-comment-view, ' +
              '.docos-replyview, .docos-streamdocos-view, .docos-streamdocos-thread, ' +
              '.docos-anchoredreplyview, .docos-anchored-view'
            );
            const player = createInlinePlayer(fileId, match[0], text, isInsideNativeGDocComment);
            // Hide the raw text content inside the comment container
            const bodyEl = container.querySelector('.docos-docoview-body, .docos-body, .docos-comment-content, p') || container;
            if (bodyEl && bodyEl !== container) {
              bodyEl.classList.add('vb-hide-raw-text');
              bodyEl.style.display = 'none';
            }
            container.appendChild(player);
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

  // Periodic scan for dynamic Google Docs comment threads
  setInterval(() => {
    scanAndRenderPlayers();
  }, 500);

  // Run on load and observe dynamic DOM changes
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanAndRenderPlayers);
  } else {
    scanAndRenderPlayers();
  }

  window.__voicebridgeScanAndRenderPlayers = scanAndRenderPlayers;

  const observer = new MutationObserver((mutations) => {
    // Ignore mutations that originate from VoiceBridge players to prevent loops
    let shouldScan = false;
    for (const mutation of mutations) {
      if (mutation.target && (
        mutation.target.classList?.contains('voicebridge-inline-player') ||
        mutation.target.closest?.('.voicebridge-inline-player, #voicebridge-modal-overlay')
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
