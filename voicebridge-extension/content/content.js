/**
 * VoiceBridge — Main Content Script
 * Provides UDL-accessible floating recording widget, smart Google Classroom Private Comments injection,
 * and seamless audio insertion into student assignments.
 */

(function () {
  if (window.__voicebridgeContentInjected) {
    if (typeof window.__voicebridgeOpenModal === 'function') {
      window.__voicebridgeOpenModal();
    }
    return;
  }
  window.__voicebridgeContentInjected = true;

  let currentActiveTargetInput = null;
  let recordingState = 'IDLE'; // 'IDLE' | 'READY' | 'STARTING' | 'RECORDING' | 'STOPPING' | 'REVIEW' | 'UPLOADING'
  let recordedAudioBase64 = null;
  let recordedDuration = 0;
  let timerInterval = null;
  let secondsElapsed = 0;
  let activeModal = null;
  let userSettings = {
    fontFamily: 'lexend',
    theme: 'default',
    singleKeyShortcuts: true,
    silenceWarning: true,
    autoStartRecording: false,
    selectedAudioDeviceId: 'default',
    selectedAudioDeviceLabel: 'Default Microphone'
  };

  // Load user accessibility settings
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ action: 'GET_USER_SETTINGS' }, (settings) => {
      if (settings) {
        userSettings = Object.assign(userSettings, settings);
        applyThemeStyles();
      }
    });
  }

  // Listen for real-time setting updates from popup
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        if (changes.fontFamily) userSettings.fontFamily = changes.fontFamily.newValue;
        if (changes.theme) userSettings.theme = changes.theme.newValue;
        if (changes.singleKeyShortcuts !== undefined) userSettings.singleKeyShortcuts = changes.singleKeyShortcuts.newValue;
        if (changes.silenceWarning !== undefined) userSettings.silenceWarning = changes.silenceWarning.newValue;
        if (changes.autoStartRecording !== undefined) userSettings.autoStartRecording = changes.autoStartRecording.newValue;
        if (changes.selectedAudioDeviceId) userSettings.selectedAudioDeviceId = changes.selectedAudioDeviceId.newValue;
        if (changes.selectedAudioDeviceLabel) userSettings.selectedAudioDeviceLabel = changes.selectedAudioDeviceLabel.newValue;
        applyThemeStyles();
      }
    });
  }

  function applyThemeStyles() {
    document.body.classList.remove('vb-font-dyslexic', 'vb-theme-high-contrast', 'vb-theme-pastel');
    if (userSettings.fontFamily === 'opendyslexic') {
      document.body.classList.add('vb-font-dyslexic');
    }
    if (userSettings.theme === 'high-contrast') {
      document.body.classList.add('vb-theme-high-contrast');
    } else if (userSettings.theme === 'pastel') {
      document.body.classList.add('vb-theme-pastel');
    }
  }

  // 1. Inject Persistent Floating Trigger
  function injectFloatingTrigger() {
    if (document.getElementById('voicebridge-floating-trigger')) return;

    const container = document.createElement('div');
    container.id = 'voicebridge-floating-trigger';
    container.innerHTML = `
      <button class="vb-floating-btn" id="vb-open-modal-btn" aria-label="Open VoiceBridge recording tool" title="Record Voice Response">
        <span class="vb-floating-icon">🎙️</span>
        <span class="vb-btn-label">Record Voice</span>
      </button>
    `;

    document.body.appendChild(container);

    const btn = container.querySelector('#vb-open-modal-btn');
    btn.addEventListener('click', () => {
      openVoiceBridgeModal();
    });
  }

  // 2. Smart Google Classroom Private Comments Injection
  // Explicitly excludes Public Class Comments and Stream Announcements for student privacy & emotional safety
  function injectClassroomPrivateCommentButtons() {
    const isClassroom = window.location.hostname.includes('classroom.google.com') ||
                        window.location.pathname.includes('classroom-simulation') ||
                        !!document.querySelector('.test-container, [data-is-private="true"]');
    if (!isClassroom) return;

    // Look for text inputs inside Private Comments sections
    const privateCommentAreas = document.querySelectorAll('div[aria-label*="private" i], div[data-is-private="true"], aside div[role="textbox"]');
    
    privateCommentAreas.forEach((area) => {
      if (area.getAttribute('data-vb-injected')) return;

      // Find the parent container or actions row
      const parentRow = area.closest('form, div[jscontroller], div[role="region"]') || area.parentElement;
      if (!parentRow) return;

      // Ensure this is NOT a public stream comment
      const isPublicStream = parentRow.textContent.includes('Class comments') || parentRow.getAttribute('aria-label')?.includes('class comment');
      if (isPublicStream) return;

      const micBtn = document.createElement('button');
      micBtn.type = 'button';
      micBtn.className = 'vb-injected-mic-btn';
      micBtn.title = 'Record Private Voice Response (VoiceBridge)';
      micBtn.setAttribute('aria-label', 'Record Voice Response');
      micBtn.innerHTML = '🎙️';

      micBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        currentActiveTargetInput = area.querySelector?.('textarea, [contenteditable="true"], input') || area;
        openVoiceBridgeModal();
      });

      area.setAttribute('data-vb-injected', 'true');
      parentRow.appendChild(micBtn);
    });
  }

  // 3. Google Slides Speaker Notes Quick-Record Injection
  function injectSlidesSpeakerNotesButton() {
    const isSlides = window.location.hostname.includes('slides.google.com') || window.location.pathname.includes('/presentation');
    if (!isSlides) return;

    const speakerNotesAreas = document.querySelectorAll('.punch-speakernotes-scrollpane, div[aria-label*="speaker notes" i], .punch-speakernotes-text');
    speakerNotesAreas.forEach((area) => {
      if (area.getAttribute('data-vb-injected')) return;
      
      const parentContainer = area.closest('.punch-speakernotes-scrollpane, .punch-filmstrip-and-stage') || area.parentElement;
      if (!parentContainer) return;
      if (parentContainer.querySelector('.vb-slides-mic-btn')) return;

      const micBtn = document.createElement('button');
      micBtn.type = 'button';
      micBtn.className = 'vb-injected-mic-btn vb-slides-mic-btn';
      micBtn.title = 'Record Speaker Notes Voice Narration (VoiceBridge)';
      micBtn.setAttribute('aria-label', 'Record Speaker Notes Voice Narration');
      micBtn.innerHTML = '🎙️';

      micBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        currentActiveTargetInput = area.querySelector?.('.punch-speakernotes-text, [contenteditable="true"]') || area;
        openVoiceBridgeModal();
      });

      area.setAttribute('data-vb-injected', 'true');
      parentContainer.appendChild(micBtn);
    });
  }

  // 3. Render VoiceBridge Accessible Modal
  function openVoiceBridgeModal() {
    if (activeModal) return;

    recordingState = userSettings.autoStartRecording ? 'STARTING' : 'READY';
    secondsElapsed = 0;
    recordedAudioBase64 = null;
    recordedDuration = 0;

    const overlay = document.createElement('div');
    overlay.id = 'voicebridge-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'vb-modal-title');

    overlay.innerHTML = `
      <div class="vb-card" id="vb-card-root">
        <div class="vb-card-header">
          <div class="vb-brand">
            <span>🎙️</span>
            <span id="vb-modal-title">VoiceBridge</span>
          </div>
          <button class="vb-close-btn" id="vb-modal-close" aria-label="Close modal">✕</button>
        </div>

        <div id="vb-modal-body">
          <!-- Dynamic State View Container -->
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    activeModal = overlay;

    overlay.querySelector('#vb-modal-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    renderCurrentState();

    if (userSettings.autoStartRecording) {
      startRecording();
    }
  }

  let currentPreviewBlobUrl = null;

  function base64ToBlobUrl(base64Data) {
    try {
      const parts = base64Data.split(',');
      const byteCharacters = atob(parts[1] || parts[0]);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'audio/webm;codecs=opus' });
      return URL.createObjectURL(blob);
    } catch (e) {
      console.warn('[VoiceBridge] Base64 to Blob conversion error:', e);
      return base64Data;
    }
  }

  function closeModal() {
    if (recordingState === 'RECORDING' || recordingState === 'STARTING' || recordingState === 'STOPPING') {
      chrome.runtime.sendMessage({ action: 'CANCEL_RECORDING' });
    }
    if (timerInterval) clearInterval(timerInterval);
    if (currentPreviewBlobUrl) {
      URL.revokeObjectURL(currentPreviewBlobUrl);
      currentPreviewBlobUrl = null;
    }
    if (activeModal) {
      activeModal.remove();
      activeModal = null;
    }
    recordingState = 'IDLE';
  }

  // Render UI according to state machine (IDLE | READY | STARTING | RECORDING | STOPPING | REVIEW | UPLOADING)
  function renderCurrentState() {
    if (!activeModal) return;
    const body = activeModal.querySelector('#vb-modal-body');

    if (recordingState === 'READY') {
      body.innerHTML = `
        <div class="vb-ready-view">
          <div class="vb-status-bar" style="background: rgba(37, 99, 235, 0.05);">
            <div class="vb-indicator">
              <span class="vb-ready-dot"></span>
              <span>Ready to Record</span>
            </div>
            <div class="vb-timer" style="color: #64748b; font-size: 16px; font-weight: 500;">00:00</div>
          </div>

          <div class="vb-mic-preview-card">
            <div class="vb-mic-icon-large">🎙️</div>
            <div class="vb-mic-info">
              <span class="vb-mic-title">Active Microphone</span>
              <span class="vb-mic-name">${userSettings.selectedAudioDeviceLabel || 'Default Microphone'}</span>
            </div>
          </div>

          <div class="vb-shortcut-hint">
            <span>💡 Tip: Click below or press <kbd>Space</kbd> when you're ready to speak.</span>
          </div>

          <div class="vb-actions-row">
            <button class="vb-btn vb-btn-secondary" id="vb-ready-cancel-btn">Cancel</button>
            <button class="vb-btn vb-btn-primary vb-btn-start" id="vb-start-record-btn">
              <span>🎙️</span>
              <span>Start Recording</span>
            </button>
          </div>
        </div>
      `;

      body.querySelector('#vb-ready-cancel-btn').addEventListener('click', closeModal);
      body.querySelector('#vb-start-record-btn').addEventListener('click', () => {
        startRecording();
      });
    } else if (recordingState === 'STARTING') {
      body.innerHTML = `
        <div class="vb-ready-view">
          <div class="vb-status-bar" style="background: rgba(37, 99, 235, 0.08);">
            <div class="vb-indicator">
              <span class="vb-pulse-dot"></span>
              <span>Connecting Microphone...</span>
            </div>
            <div class="vb-timer" style="color: #64748b; font-size: 16px; font-weight: 500;">...</div>
          </div>

          <div class="vb-mic-preview-card">
            <div class="vb-mic-icon-large">🎙️</div>
            <div class="vb-mic-info">
              <span class="vb-mic-title">Starting Audio Engine</span>
              <span class="vb-mic-name">${userSettings.selectedAudioDeviceLabel || 'Default Microphone'}</span>
            </div>
          </div>

          <div class="vb-actions-row">
            <button class="vb-btn vb-btn-secondary" id="vb-starting-cancel-btn">Cancel</button>
            <button class="vb-btn vb-btn-primary vb-btn-loading" disabled>
              <span class="vb-btn-spinner">⏳</span>
              <span>Starting...</span>
            </button>
          </div>
        </div>
      `;

      body.querySelector('#vb-starting-cancel-btn').addEventListener('click', closeModal);
    } else if (recordingState === 'RECORDING') {
      body.innerHTML = `
        <div class="vb-status-bar">
          <div class="vb-indicator">
            <span class="vb-pulse-dot"></span>
            <span>Recording Voice...</span>
          </div>
          <div class="vb-timer" id="vb-live-timer">00:00</div>
        </div>

        <div class="vb-waveform-container" id="vb-waveform">
          ${Array.from({ length: 24 }).map(() => '<div class="vb-wave-bar"></div>').join('')}
        </div>

        <div style="font-size: 11px; color: #64748b; text-align: center; margin: -4px 0 8px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          🎙️ Mic: <strong>${userSettings.selectedAudioDeviceLabel || 'Default Microphone'}</strong>
        </div>

        <div id="vb-silence-warning-slot"></div>

        <div class="vb-actions-row">
          <button class="vb-btn vb-btn-secondary" id="vb-cancel-btn">Cancel</button>
          <button class="vb-btn vb-btn-primary" id="vb-stop-btn">
            <span>⏹️</span>
            <span>Stop & Review</span>
          </button>
        </div>
      `;

      body.querySelector('#vb-cancel-btn').addEventListener('click', closeModal);
      body.querySelector('#vb-stop-btn').addEventListener('click', stopRecording);
      startTimer();
    } else if (recordingState === 'STOPPING') {
      const mins = Math.floor(secondsElapsed / 60).toString().padStart(2, '0');
      const secs = (secondsElapsed % 60).toString().padStart(2, '0');
      body.innerHTML = `
        <div class="vb-status-bar">
          <div class="vb-indicator">
            <span class="vb-pulse-dot" style="background-color: var(--vb-warning);"></span>
            <span>Finishing Recording...</span>
          </div>
          <div class="vb-timer">${mins}:${secs}</div>
        </div>

        <div class="vb-waveform-container" style="opacity: 0.5;">
          ${Array.from({ length: 24 }).map(() => '<div class="vb-wave-bar"></div>').join('')}
        </div>

        <div class="vb-actions-row">
          <button class="vb-btn vb-btn-secondary" disabled style="opacity: 0.5; cursor: not-allowed;">Cancel</button>
          <button class="vb-btn vb-btn-primary vb-btn-loading" disabled>
            <span class="vb-btn-spinner">⏳</span>
            <span>Processing Audio...</span>
          </button>
        </div>
      `;
    } else if (recordingState === 'REVIEW') {
      if (timerInterval) clearInterval(timerInterval);
      const mins = Math.floor(recordedDuration / 60);
      const secs = Math.floor(recordedDuration % 60).toString().padStart(2, '0');

      if (currentPreviewBlobUrl) {
        URL.revokeObjectURL(currentPreviewBlobUrl);
      }
      currentPreviewBlobUrl = base64ToBlobUrl(recordedAudioBase64);

      body.innerHTML = `
        <div class="vb-status-bar">
          <div class="vb-indicator">
            <span>✅</span>
            <span>Recording Ready</span>
          </div>
          <div class="vb-timer">${mins}:${secs}</div>
        </div>

        <div style="margin: 16px 0;">
          <audio id="vb-preview-audio" src="${currentPreviewBlobUrl}" controls autoplay style="width: 100%; border-radius: 8px;"></audio>
        </div>

        <div class="vb-actions-row">
          <button class="vb-btn vb-btn-warning" id="vb-redo-btn">
            <span>🔄</span>
            <span>Redo</span>
          </button>
          <button class="vb-btn vb-btn-success" id="vb-submit-btn">
            <span>✅</span>
            <span>Insert Voice Note</span>
          </button>
        </div>
      `;

      body.querySelector('#vb-redo-btn').addEventListener('click', () => {
        recordingState = 'READY';
        renderCurrentState();
      });

      body.querySelector('#vb-submit-btn').addEventListener('click', () => {
        uploadAndInsert();
      });
    } else if (recordingState === 'UPLOADING') {
      body.innerHTML = `
        <div style="text-align: center; padding: 24px 0;">
          <div style="font-size: 36px; margin-bottom: 12px;">☁️</div>
          <h3 style="font-size: 18px; font-weight: 700; margin: 0 0 6px 0;">Saving to Your Google Drive...</h3>
          <p style="color: var(--vb-text-muted); font-size: 14px; margin: 0;">Attaching private voice note to your assignment.</p>
        </div>
      `;
    }
  }

  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    secondsElapsed = 0;
    timerInterval = setInterval(() => {
      secondsElapsed++;
      const timerEl = activeModal?.querySelector('#vb-live-timer');
      if (timerEl) {
        const mins = Math.floor(secondsElapsed / 60).toString().padStart(2, '0');
        const secs = (secondsElapsed % 60).toString().padStart(2, '0');
        timerEl.textContent = `${mins}:${secs}`;
      }
    }, 1000);
  }

  function startRecording() {
    if (recordingState === 'RECORDING' || recordingState === 'STARTING') return;

    recordingState = 'STARTING';
    renderCurrentState();

    chrome.runtime.sendMessage({
      action: 'START_RECORDING',
      payload: {
        deviceId: userSettings.selectedAudioDeviceId,
        deviceLabel: userSettings.selectedAudioDeviceLabel
      }
    }, (res) => {
      if (chrome.runtime.lastError) {
        showToastNotification('⚠️ Could not start recording: ' + chrome.runtime.lastError.message);
        recordingState = 'READY';
        renderCurrentState();
        return;
      }

      if (res && res.success) {
        recordingState = 'RECORDING';
        renderCurrentState();
      } else {
        if (res?.permissionRequired || res?.error?.includes('NotAllowedError') || res?.error?.includes('Permission')) {
          showToastNotification('🎙️ Microphone setup opened in a new tab. Click "Allow" once to enable recording.');
        } else {
          showToastNotification('⚠️ Could not start recording: ' + (res?.error || 'Please check mic settings.'));
        }
        recordingState = 'READY';
        renderCurrentState();
      }
    });
  }

  function stopRecording() {
    if (recordingState !== 'RECORDING') return;

    recordingState = 'STOPPING';
    renderCurrentState();
    if (timerInterval) clearInterval(timerInterval);

    chrome.runtime.sendMessage({ action: 'STOP_RECORDING' }, (res) => {
      if (chrome.runtime.lastError) {
        showToastNotification('⚠️ Recording error: ' + chrome.runtime.lastError.message);
        closeModal();
        return;
      }

      if (res && res.success) {
        recordedAudioBase64 = res.audioBase64;
        recordedDuration = res.durationSeconds || secondsElapsed;
        recordingState = 'REVIEW';
        renderCurrentState();
      } else {
        showToastNotification('⚠️ Recording failed: ' + (res?.error || 'Unknown error'));
        closeModal();
      }
    });
  }

  async function uploadAndInsert() {
    recordingState = 'UPLOADING';
    renderCurrentState();

    chrome.runtime.sendMessage({
      action: 'UPLOAD_TO_DRIVE',
      payload: {
        audioBase64: recordedAudioBase64,
        durationSeconds: recordedDuration
      }
    }, (res) => {
      if (res && res.success) {
        const data = res.data;
        insertLinkIntoComment(data.formattedChipText || data.webViewLink);
        if (data.isDemoMode) {
          showToastNotification('🎙️ Voice note created! Link inserted into comment.');
        } else {
          showToastNotification('🎙️ Voice note saved to Google Drive and inserted!');
        }
        closeModal();
      } else {
        showToastNotification('⚠️ Could not complete upload: ' + (res?.error || 'Authentication error'));
        recordingState = 'REVIEW';
        renderCurrentState();
      }
    });
  }

  function isSafeInputTarget(target) {
    if (!target || target === document.body || target === document.documentElement) return false;
    
    // Explicitly reject Google Docs (Kix) & Google Slides (Punch) graphical canvas elements that crash on programmatic DOM mutation
    if (target.closest?.(
      '.kix-appview, .docs-texteventtarget-iframe, #docs-editor, .kix-page, .kix-canvas-tile-content, .docs-ui-unprintable, ' +
      '.punch-stage, .punch-canvas, .punch-viewer-page, .punch-texteventtarget-iframe, .punch-full-window-overlay'
    )) {
      return false;
    }
    if (target.classList?.contains('docs-texteventtarget-iframe') || target.classList?.contains('punch-texteventtarget-iframe') || target.id?.includes('docs-texteventtarget')) {
      return false;
    }

    // Google Slides Speaker Notes
    if (target.classList?.contains('punch-speakernotes-text') || target.closest?.('.punch-speakernotes-text, .punch-speakernotes-scrollpane, div[aria-label*="speaker notes" i]')) {
      return true;
    }

    // Google Docs & Slides comment boxes & Google Classroom comment fields
    if (target.classList?.contains('docos-input-textarea') || target.closest?.('.docos-input-textarea, .docos-streamdocos-input')) {
      return true;
    }

    if (target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && target.type === 'text')) {
      return true;
    }

    if (target.isContentEditable && (target.getAttribute('role') === 'textbox' || target.closest?.('form, aside, div[role="region"]'))) {
      return true;
    }

    return false;
  }

  async function insertLinkIntoComment(textToInsert) {
    let copiedToClipboard = false;
    try {
      await navigator.clipboard.writeText(textToInsert);
      copiedToClipboard = true;
    } catch (e) {}

    let target = currentActiveTargetInput;
    if (target && !isSafeInputTarget(target)) {
      target = target.querySelector?.('textarea, [contenteditable="true"], input') || target;
    }
    if (!isSafeInputTarget(target)) {
      target = isSafeInputTarget(document.activeElement) ? document.activeElement : null;
    }
    if (!target) {
      target = document.querySelector('div[data-is-private="true"] textarea, div[aria-label*="private" i] textarea, .docos-input-textarea, textarea');
    }

    let directlyInserted = false;

    if (target && isSafeInputTarget(target)) {
      try {
        if (target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && target.type === 'text')) {
          const start = target.selectionStart ?? target.value.length;
          const end = target.selectionEnd ?? target.value.length;
          target.value = target.value.substring(0, start) + textToInsert + '\n' + target.value.substring(end);
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
          directlyInserted = true;
        } else if (target.isContentEditable) {
          target.focus();
          document.execCommand('insertText', false, textToInsert + '\n');
          directlyInserted = true;
        }
      } catch (err) {
        console.warn('[VoiceBridge] Direct comment insert bypassed for safety:', err);
      }
    }

    if (directlyInserted) {
      showToastNotification('✅ Voice note inserted into comment!');
    } else if (copiedToClipboard) {
      showToastNotification('🎙️ Voice note saved & copied to clipboard! Press Cmd+V (Paste) to insert.');
    } else {
      showToastNotification('🎙️ Voice note created! Link: ' + textToInsert);
    }
  }

  function showToastNotification(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      bottom: 80px;
      right: 24px;
      background: #1e293b;
      color: #ffffff;
      padding: 12px 20px;
      border-radius: 12px;
      box-shadow: 0 10px 20px rgba(0,0,0,0.2);
      z-index: 10000001;
      font-family: var(--vb-font-family);
      font-size: 14px;
      font-weight: 500;
      animation: vbFadeIn 0.2s ease-out;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  window.__voicebridgeOpenModal = openVoiceBridgeModal;
  window.__voicebridgeCloseModal = closeModal;
  window.__voicebridgeSetUserSettings = (newSettings) => {
    userSettings = Object.assign(userSettings, newSettings);
    applyThemeStyles();
  };

  // Listen for audio level updates, silence warnings, and popup triggers
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.action === 'TRIGGER_RECORDING') {
        openVoiceBridgeModal();
        if (sendResponse) sendResponse({ success: true });
        return true;
      }

    if (msg.action === 'AUDIO_LEVEL_UPDATE' && recordingState === 'RECORDING') {
      const bars = activeModal?.querySelectorAll('.vb-wave-bar');
      if (bars) {
        const level = msg.level || 0;
        bars.forEach((bar, idx) => {
          const height = Math.max(6, Math.min(65, level * 70 + Math.sin(idx + Date.now() / 100) * 15));
          bar.style.height = `${height}px`;
        });
      }
    }

      if (msg.action === 'SILENCE_WARNING_TRIGGERED' && recordingState === 'RECORDING' && userSettings.silenceWarning) {
        const slot = activeModal?.querySelector('#vb-silence-warning-slot');
        if (slot && !slot.hasChildNodes()) {
          const alertBox = document.createElement('div');
          alertBox.className = 'vb-silence-alert';
          alertBox.innerHTML = '<span>⚠️</span><span>We didn\'t hear any sound. Please make sure your microphone is not muted!</span>';
          slot.appendChild(alertBox);
        }
      }
    });
  }

  // Single-key keyboard navigation (UDL)
  document.addEventListener('keydown', (e) => {
    if (!userSettings.singleKeyShortcuts) return;

    // Esc closes modal
    if (e.key === 'Escape' && activeModal) {
      closeModal();
      return;
    }

    // Space toggles record / stop if modal is active and not focused in an input
    if (e.key === ' ' && activeModal && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      if (recordingState === 'READY') {
        startRecording();
      } else if (recordingState === 'RECORDING') {
        stopRecording();
      }
    }
  });

  // Initialize
  injectFloatingTrigger();
  injectClassroomPrivateCommentButtons();
  injectSlidesSpeakerNotesButton();

  let injectDebounceTimer = null;
  const domObserver = new MutationObserver(() => {
    if (injectDebounceTimer) clearTimeout(injectDebounceTimer);
    injectDebounceTimer = setTimeout(() => {
      injectClassroomPrivateCommentButtons();
      injectSlidesSpeakerNotesButton();
    }, 200);
  });
  domObserver.observe(document.body, { childList: true, subtree: true });
})();
