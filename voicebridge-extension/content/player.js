/**
 * VoiceBridge — Inline Audio Player Renderer
 * Scans Google Classroom & Google Docs DOM for VoiceBridge voice links and embeds
 * 1-click accessible mini-players directly into comment cards and discussion threads.
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
    // Never touch inputs, textareas, active forms, or Google Docs / Slides canvas
    return !!el.closest?.(
      'textarea, input, [contenteditable="true"], [role="textbox"], form, ' +
      '.docos-input-textarea, .docos-streamdocos-input, ' +
      '.kix-appview, .docs-texteventtarget-iframe, #docs-editor, .kix-page, .kix-canvas-tile-content, ' +
      '.punch-stage, .punch-canvas, .punch-viewer-page, .punch-texteventtarget-iframe, .punch-full-window-overlay, ' +
      '.voicebridge-inline-player, #voicebridge-modal-overlay, #voicebridge-floating-trigger'
    );
  }

  function createInlinePlayer(fileId, originalLink, rawText) {
    const streamUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

    const playerContainer = document.createElement('div');
    playerContainer.className = 'voicebridge-inline-player';
    playerContainer.setAttribute('role', 'region');
    playerContainer.setAttribute('aria-label', 'VoiceBridge Audio Player');

    // Extract title/duration if present
    let title = '🎙️ VoiceBridge Note';
    if (rawText && rawText.includes('VoiceBridge Note')) {
      const match = rawText.match(/VoiceBridge Note\s*\(([^)]+)\)/);
      if (match) {
        title = `🎙️ Voice Note (${match[1]})`;
      }
    }

    playerContainer.innerHTML = `
      <div class="vb-player-header">
        <span>${title}</span>
        <a href="${originalLink}" target="_blank" rel="noopener noreferrer" style="color: #64748b; text-decoration: none; font-size: 11px;">Open in Drive ↗</a>
      </div>
      <div class="vb-player-controls">
        <button class="vb-play-btn" aria-label="Play audio">▶</button>
        <div class="vb-scrubber-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="vb-scrubber-progress"></div>
        </div>
        <span class="vb-time-display" style="font-size: 12px; font-weight: 600; color: #475569; min-width: 40px;">0:00</span>
        <button class="vb-speed-btn" title="Playback Speed">1.0x</button>
      </div>
      <audio preload="none" src="${streamUrl}" style="display: none;"></audio>
    `;

    const audio = playerContainer.querySelector('audio');
    const playBtn = playerContainer.querySelector('.vb-play-btn');
    const scrubberTrack = playerContainer.querySelector('.vb-scrubber-track');
    const progressBar = playerContainer.querySelector('.vb-scrubber-progress');
    const timeDisplay = playerContainer.querySelector('.vb-time-display');
    const speedBtn = playerContainer.querySelector('.vb-speed-btn');

    let speeds = [1.0, 1.25, 1.5, 2.0, 0.75];
    let currentSpeedIdx = 0;

    // Play / Pause toggle
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (audio.paused) {
        audio.play().then(() => {
          playBtn.innerHTML = '⏸';
          playBtn.setAttribute('aria-label', 'Pause audio');
        }).catch((err) => {
          console.warn('[VoiceBridge] Direct audio stream blocked, opening Drive viewer:', err);
          window.open(originalLink, '_blank');
        });
      } else {
        audio.pause();
        playBtn.innerHTML = '▶';
        playBtn.setAttribute('aria-label', 'Play audio');
      }
    });

    // Time update and scrubber
    audio.addEventListener('timeupdate', () => {
      if (!audio.duration || isNaN(audio.duration)) return;
      const progress = (audio.currentTime / audio.duration) * 100;
      progressBar.style.width = `${progress}%`;
      scrubberTrack.setAttribute('aria-valuenow', Math.round(progress));

      const curMins = Math.floor(audio.currentTime / 60);
      const curSecs = Math.floor(audio.currentTime % 60).toString().padStart(2, '0');
      timeDisplay.textContent = `${curMins}:${curSecs}`;
    });

    audio.addEventListener('ended', () => {
      playBtn.innerHTML = '▶';
      progressBar.style.width = '0%';
      timeDisplay.textContent = '0:00';
    });

    // Scrubber click
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
    });

    return playerContainer;
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
            if (!link.parentElement?.querySelector('.voicebridge-inline-player')) {
              const player = createInlinePlayer(fileId, link.href, rawText);
              link.parentElement?.insertBefore(player, link.nextSibling);
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
            const player = createInlinePlayer(fileId, match[0], text);
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
    }, 150);
  }

  // Run on load and observe dynamic DOM changes
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanAndRenderPlayers);
  } else {
    scanAndRenderPlayers();
  }

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
