/**
 * VoiceBridge — Special Education In-Product Onboarding Controller
 * 
 * Provides an accessible, scaffolded step-by-step onboarding walkthrough
 * tailored for students in special education during their first 3 uses.
 * Adheres to UDL principles: low cognitive load, Web Speech API read-aloud,
 * WCAG AAA theme/font compatibility, and teacher replay capabilities.
 */

(function () {
  'use strict';

  if (window.VoiceBridgeOnboarding) return;

  const STORAGE_KEY_COUNT = 'vb_onboarding_completed_count';
  const STORAGE_KEY_COMMENT_COUNT = 'vb_comment_onboarding_count';
  const MAX_ONBOARDING_SESSIONS = 3;

  // Onboarding Steps
  const STEPS = {
    FLOATING_TRIGGER: 'FLOATING_TRIGGER',
    MODAL_START: 'MODAL_START',
    MODAL_SPEAK: 'MODAL_SPEAK',
    MODAL_REVIEW: 'MODAL_REVIEW',
    PASTE_INSTRUCTION: 'PASTE_INSTRUCTION',
    INTRODUCE_INBOX: 'INTRODUCE_INBOX',
    // In-Comment Steps
    PROMPT_OPEN_COMMENT: 'PROMPT_OPEN_COMMENT',
    COMMENT_MIC: 'COMMENT_MIC',
    COMMENT_RECORDING: 'COMMENT_RECORDING',
    COMMENT_SUBMIT: 'COMMENT_SUBMIT'
  };

  let completedCount = 0;
  let commentCompletedCount = 0;
  let isSessionDismissed = false;
  let currentStep = null;
  let currentTargetSelector = null;
  let activeOverlay = null;
  let activeSpotlight = null;
  let activeCard = null;
  let activeFadedTip = null;
  let activePromptBanner = null;
  let activeCommentInput = null;
  let isSpeaking = false;
  let pollInterval = null;

  // Read-Aloud TTS Engine (Zero-cost native browser speech synthesis)
  function speakText(text, onEnd) {
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      if (isSpeaking) {
        isSpeaking = false;
        updateTtsButtonState(false);
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.9; // Accessible speech rate
      utterance.lang = 'en-US';

      utterance.onstart = () => {
        isSpeaking = true;
        updateTtsButtonState(true);
      };

      utterance.onend = () => {
        isSpeaking = false;
        updateTtsButtonState(false);
        if (typeof onEnd === 'function') onEnd();
      };

      utterance.onerror = () => {
        isSpeaking = false;
        updateTtsButtonState(false);
      };

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('[VoiceBridge Onboarding] TTS error:', e);
      isSpeaking = false;
      updateTtsButtonState(false);
    }
  }

  function stopSpeech() {
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
    }
    isSpeaking = false;
    updateTtsButtonState(false);
  }

  function updateTtsButtonState(speaking) {
    const ttsBtn = document.querySelector('.vb-onboard-tts-btn');
    if (ttsBtn) {
      if (speaking) {
        ttsBtn.classList.add('vb-speaking');
        ttsBtn.setAttribute('aria-label', 'Stop speaking instructions');
        ttsBtn.title = 'Stop speech';
      } else {
        ttsBtn.classList.remove('vb-speaking');
        ttsBtn.setAttribute('aria-label', 'Listen to instructions read aloud');
        ttsBtn.title = 'Read aloud';
      }
    }
  }

  // Storage Helpers
  function getStorageArea() {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      return chrome.storage.sync || chrome.storage.local;
    }
    return null;
  }

  function loadCompletedCounts(callback) {
    const storage = getStorageArea();
    if (!storage) {
      if (typeof callback === 'function') callback(0, 0);
      return;
    }
    try {
      storage.get([STORAGE_KEY_COUNT, STORAGE_KEY_COMMENT_COUNT], (res) => {
        completedCount = res && typeof res[STORAGE_KEY_COUNT] === 'number' ? res[STORAGE_KEY_COUNT] : 0;
        commentCompletedCount = res && typeof res[STORAGE_KEY_COMMENT_COUNT] === 'number' ? res[STORAGE_KEY_COMMENT_COUNT] : 0;
        if (typeof callback === 'function') callback(completedCount, commentCompletedCount);
      });
    } catch (e) {
      if (typeof callback === 'function') callback(0, 0);
    }
  }

  function incrementCompletedCount() {
    completedCount = Math.min(completedCount + 1, MAX_ONBOARDING_SESSIONS);
    const storage = getStorageArea();
    if (storage) {
      try {
        const data = {};
        data[STORAGE_KEY_COUNT] = completedCount;
        storage.set(data);
      } catch (_) {}
    }
  }

  function incrementCommentCompletedCount() {
    commentCompletedCount = Math.min(commentCompletedCount + 1, MAX_ONBOARDING_SESSIONS);
    const storage = getStorageArea();
    if (storage) {
      try {
        const data = {};
        data[STORAGE_KEY_COMMENT_COUNT] = commentCompletedCount;
        storage.set(data);
      } catch (_) {}
    }
  }

  function resetCompletedCount() {
    completedCount = 0;
    commentCompletedCount = 0;
    isSessionDismissed = false;
    const storage = getStorageArea();
    if (storage) {
      try {
        const data = {};
        data[STORAGE_KEY_COUNT] = 0;
        data[STORAGE_KEY_COMMENT_COUNT] = 0;
        storage.set(data);
      } catch (_) {}
    }
    startOnboarding();
  }

  // Element Positioning & Viewport Clamping
  function getElementRect(el) {
    if (!el || !el.isConnected) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return r;
  }

  function findActiveCommentBox() {
    // 1. Check focused element first
    const active = document.activeElement;
    if (active && (active.tagName === 'TEXTAREA' || active.isContentEditable || active.getAttribute?.('role') === 'textbox')) {
      const card = active.closest?.('.docos-input-textarea-wrapper, [class*="docos-docoview"], [class*="docos-replyview"], [class*="docos-anchoredreplyview"], [role="region"], div[aria-label*="private" i], aside, form');
      return card || active;
    }

    // 2. Check around the injected mic button
    const inboxBtn = document.querySelector('.vb-injected-mic-btn');
    const candidates = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], div[role="textbox"]'));
    if (inboxBtn) {
      const btnRect = inboxBtn.getBoundingClientRect();
      let bestEl = null;
      let minDistance = 99999;
      for (const el of candidates) {
        if (el.closest?.('#voicebridge-modal-overlay, #voicebridge-floating-trigger, .vb-onboarding-overlay, .vb-onboard-card, .vb-onboard-faded-tip, .vb-onboard-prompt-banner')) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 40 && r.height > 15) {
          const dist = Math.hypot(r.right - (btnRect.right + 8), r.bottom - (btnRect.bottom + 8));
          if (dist < minDistance) {
            minDistance = dist;
            bestEl = el;
          }
        }
      }
      if (bestEl) {
        const card = bestEl.closest?.('.docos-input-textarea-wrapper, [class*="docos-docoview"], [class*="docos-replyview"], [class*="docos-anchoredreplyview"], [role="region"], div[aria-label*="private" i], aside, form');
        return card || bestEl;
      }
    }

    // 3. Fallback: visible comment container in viewport
    const visibleCard = document.querySelector('.docos-input-textarea-wrapper, [class*="docos-docoview"], [class*="docos-replyview"], [class*="docos-anchoredreplyview"], div[aria-label*="private" i]');
    if (visibleCard) {
      const r = visibleCard.getBoundingClientRect();
      if (r.width > 50 && r.height > 20) return visibleCard;
    }

    return null;
  }

  function clampCardPosition(targetRect, cardWidth = 380, cardHeight = 220, targetEl = null) {
    const margin = 16;
    const vw = window.innerWidth || 1024;
    const vh = window.innerHeight || 768;

    // Check if target is inside the VoiceBridge modal dialog
    const modalCard = document.getElementById('vb-card-root');
    const isInModal = targetEl && targetEl.closest('#voicebridge-modal-overlay');

    if (isInModal && modalCard) {
      const modalRect = modalCard.getBoundingClientRect();
      const modalCenterTop = Math.round(modalRect.top + (modalRect.height - cardHeight) / 2);
      const clampedTop = Math.max(margin, Math.min(modalCenterTop, vh - cardHeight - margin));

      // 1. Try placing to the right of the modal card
      if (vw - modalRect.right >= cardWidth + margin * 2) {
        return {
          left: Math.round(modalRect.right + margin),
          top: clampedTop
        };
      }

      // 2. Try placing to the left of the modal card
      if (modalRect.left >= cardWidth + margin * 2) {
        return {
          left: Math.round(modalRect.left - cardWidth - margin),
          top: clampedTop
        };
      }

      // 3. Try placing above the modal card
      const modalCenterLeft = Math.round(Math.max(margin, Math.min(modalRect.left + (modalRect.width - cardWidth) / 2, vw - cardWidth - margin)));
      if (modalRect.top >= cardHeight + margin) {
        return {
          left: modalCenterLeft,
          top: Math.round(modalRect.top - cardHeight - 12)
        };
      }

      // 4. Try placing below the modal card
      if (vh - modalRect.bottom >= cardHeight + margin) {
        return {
          left: modalCenterLeft,
          top: Math.round(modalRect.bottom + 12)
        };
      }

      // Fallback for smaller screens: pin near top of screen
      return {
        left: Math.round(Math.max(margin, (vw - cardWidth) / 2)),
        top: Math.round(margin)
      };
    }

    // Check if target is inside or near a comment box (Google Docs / Classroom)
    const isCommentTarget = targetEl && (
      targetEl.classList?.contains('vb-injected-mic-btn') ||
      targetEl.closest?.('.vb-inbox-recorder, .docos-input-textarea-wrapper, [class*="docos-"], [role="region"], div[aria-label*="private" i]')
    );

    if (isCommentTarget) {
      const commentBox = findActiveCommentBox();
      const boxRect = commentBox ? commentBox.getBoundingClientRect() : targetRect;
      if (boxRect) {
        // Place ABOVE the comment box so students can clearly see and click inside the comment box
        let top = boxRect.top - cardHeight - margin;
        if (top < margin) {
          top = Math.min(vh - cardHeight - margin, boxRect.bottom + margin);
        }
        let left = Math.max(margin, Math.min(boxRect.right - cardWidth, vw - cardWidth - margin));
        return { left: Math.round(left), top: Math.round(top) };
      }
    }

    let left = targetRect ? targetRect.left : (vw - cardWidth) / 2;
    let top = targetRect ? targetRect.bottom + margin : (vh - cardHeight) / 2;

    // If card overflows bottom, flip to above target
    if (targetRect && top + cardHeight > vh - margin) {
      top = Math.max(margin, targetRect.top - cardHeight - margin);
    }

    // Horizontal clamping
    left = Math.max(margin, Math.min(left, vw - cardWidth - margin));
    top = Math.max(margin, Math.min(top, vh - cardHeight - margin));

    return { left: Math.round(left), top: Math.round(top) };
  }

  function positionSpotlight(targetEl) {
    if (!activeSpotlight) return;
    const r = getElementRect(targetEl);
    if (!r) {
      activeSpotlight.style.display = 'none';
      return;
    }
    const pad = 4;
    activeSpotlight.style.display = 'block';
    activeSpotlight.style.left = `${Math.round(r.left - pad)}px`;
    activeSpotlight.style.top = `${Math.round(r.top - pad)}px`;
    activeSpotlight.style.width = `${Math.round(r.width + pad * 2)}px`;
    activeSpotlight.style.height = `${Math.round(r.height + pad * 2)}px`;
  }

  function positionCard(targetEl) {
    if (!activeCard) return;
    const r = getElementRect(targetEl);
    const cardRect = activeCard.getBoundingClientRect();
    const pos = clampCardPosition(r, cardRect.width || 380, cardRect.height || 220, targetEl);
    activeCard.style.left = `${pos.left}px`;
    activeCard.style.top = `${pos.top}px`;
  }

  function updatePositions(targetEl) {
    if (activeOverlay) {
      if (targetEl && targetEl.closest('#voicebridge-modal-overlay')) {
        activeOverlay.classList.add('vb-in-modal');
      } else {
        activeOverlay.classList.remove('vb-in-modal');
      }
    }
    positionSpotlight(targetEl);
    positionCard(targetEl);
  }

  let trackingAnimationId = null;
  let activeResizeObserver = null;
  let commentTourTimer = null;
  let commentScaffoldingTimer = null;

  function clearCommentTimers() {
    if (commentTourTimer) {
      clearTimeout(commentTourTimer);
      commentTourTimer = null;
    }
    if (commentScaffoldingTimer) {
      clearTimeout(commentScaffoldingTimer);
      commentScaffoldingTimer = null;
    }
  }

  function stopTracking() {
    if (trackingAnimationId) {
      cancelAnimationFrame(trackingAnimationId);
      trackingAnimationId = null;
    }
    if (activeResizeObserver) {
      activeResizeObserver.disconnect();
      activeResizeObserver = null;
    }
  }

  function startTrackingTarget(targetEl) {
    stopTracking();
    if (!targetEl) return;

    // Track for 400ms using rAF to ensure smooth alignment during any initial layout reflows or modal opening
    const startTime = performance.now();
    function rafTrack(now) {
      if (!activeOverlay || !targetEl || !targetEl.isConnected) return;
      updatePositions(targetEl);
      if (now - startTime < 400) {
        trackingAnimationId = requestAnimationFrame(rafTrack);
      } else {
        trackingAnimationId = null;
      }
    }
    trackingAnimationId = requestAnimationFrame(rafTrack);

    // Also observe targetEl and modalCard with ResizeObserver if available
    if (typeof ResizeObserver !== 'undefined') {
      try {
        activeResizeObserver = new ResizeObserver(() => {
          if (targetEl && targetEl.isConnected) {
            updatePositions(targetEl);
          }
        });
        activeResizeObserver.observe(targetEl);
        const modalCard = document.getElementById('vb-card-root');
        if (modalCard) {
          activeResizeObserver.observe(modalCard);
        }
      } catch (_) {}
    }
  }

  // Teardown
  function teardownOnboarding() {
    stopSpeech();
    stopTracking();
    clearCommentTimers();
    hideOpenCommentPrompt();
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    if (activeOverlay) {
      activeOverlay.remove();
      activeOverlay = null;
      activeSpotlight = null;
      activeCard = null;
    }
    if (activeFadedTip) {
      activeFadedTip.remove();
      activeFadedTip = null;
    }
    const floatingBtn = document.getElementById('voicebridge-floating-trigger');
    if (floatingBtn) {
      floatingBtn.classList.remove('vb-trigger-pulse-badge');
    }
    const inboxBtn = document.querySelector('.vb-injected-mic-btn');
    if (inboxBtn) {
      inboxBtn.classList.remove('vb-comment-mic-pulse');
    }
    currentStep = null;
  }

  // Dismiss by Student
  function dismiss() {
    isSessionDismissed = true;
    hideOpenCommentPrompt();
    teardownOnboarding();
  }

  // Render Step (Use 1: Full Interactive Spotlight Tour)
  function renderStep(stepKey, targetSelector, stepData) {
    currentStep = stepKey;
    currentTargetSelector = targetSelector;
    stopSpeech();
    hideOpenCommentPrompt();
    if (activeFadedTip) {
      activeFadedTip.remove();
      activeFadedTip = null;
    }

    if (!activeOverlay) {
      activeOverlay = document.createElement('div');
      activeOverlay.className = 'vb-onboarding-overlay';
      activeOverlay.setAttribute('role', 'region');
      activeOverlay.setAttribute('aria-label', 'VoiceBridge Onboarding Guide');

      activeSpotlight = document.createElement('div');
      activeSpotlight.className = 'vb-onboard-spotlight';
      activeOverlay.appendChild(activeSpotlight);

      activeCard = document.createElement('div');
      activeCard.className = 'vb-onboard-card';
      activeCard.setAttribute('role', 'dialog');
      activeCard.setAttribute('aria-modal', 'false');
      activeCard.setAttribute('aria-live', 'polite');
      activeOverlay.appendChild(activeCard);

      document.body.appendChild(activeOverlay);

      // Reposition on window resize and scroll
      window.addEventListener('resize', () => {
        if (currentTargetSelector) {
          const el = document.querySelector(currentTargetSelector);
          if (el) updatePositions(el);
        }
      });
      window.addEventListener('scroll', () => {
        if (currentTargetSelector) {
          const el = document.querySelector(currentTargetSelector);
          if (el) updatePositions(el);
        }
      }, true);

      // Keyboard Esc to dismiss
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && activeOverlay) {
          dismiss();
        }
      });
    }

    // Always ensure activeOverlay is appended at the very end of document.body so it stays on top
    if (activeOverlay && activeOverlay.parentElement === document.body) {
      document.body.appendChild(activeOverlay);
    }

    const isMac = navigator.platform && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const pasteShortcut = isMac ? 'Cmd + V' : 'Ctrl + V';
    const pasteKeyHtml = `<kbd>${pasteShortcut}</kbd>`;

    const descHtml = stepData.desc.replace(/\{PASTE_KEY\}/g, pasteKeyHtml);
    const speechText = stepData.speechText.replace(/\{PASTE_KEY\}/g, isMac ? 'Command plus V' : 'Control plus V');

    activeCard.innerHTML = `
      <div class="vb-onboard-header">
        <span class="vb-onboard-step-badge">${stepData.badge}</span>
        <div class="vb-onboard-header-actions">
          <button type="button" class="vb-onboard-tts-btn" title="Read aloud" aria-label="Listen to instructions read aloud">🔊</button>
          <button type="button" class="vb-onboard-skip-btn" title="Dismiss guide (Esc)" aria-label="Skip onboarding guide">✕</button>
        </div>
      </div>
      <div class="vb-onboard-body">
        <div class="vb-onboard-icon">${stepData.icon}</div>
        <div class="vb-onboard-content">
          <h3 class="vb-onboard-title">${stepData.title}</h3>
          <p class="vb-onboard-desc">${descHtml}</p>
        </div>
      </div>
      <div class="vb-onboard-actions">
        ${stepData.buttonHtml || `<span class="vb-onboard-hint-row">${stepData.hint || 'Click the highlighted button to proceed'}</span>`}
      </div>
    `;

    // Prevent mousedown on card from blurring Docs comments
    activeCard.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });

    // TTS Button Listener
    const ttsBtn = activeCard.querySelector('.vb-onboard-tts-btn');
    if (ttsBtn) {
      ttsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        speakText(speechText);
      });
    }

    // Skip Button Listener
    const skipBtn = activeCard.querySelector('.vb-onboard-skip-btn');
    if (skipBtn) {
      skipBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dismiss();
      });
    }

    // Bind custom action button if present
    if (stepData.onButtonClick) {
      const actionBtn = activeCard.querySelector('.vb-onboard-btn-primary');
      if (actionBtn) {
        actionBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          stepData.onButtonClick();
        });
      }
    }

    // Locate target element and update positions
    let target = document.querySelector(targetSelector);
    if (target) {
      updatePositions(target);
      startTrackingTarget(target);
    } else {
      // Poll briefly if target element is rendering
      if (pollInterval) clearInterval(pollInterval);
      let attempts = 0;
      pollInterval = setInterval(() => {
        attempts++;
        target = document.querySelector(targetSelector);
        if (target) {
          clearInterval(pollInterval);
          pollInterval = null;
          updatePositions(target);
          startTrackingTarget(target);
        } else if (attempts > 30) {
          clearInterval(pollInterval);
          pollInterval = null;
          stopTracking();
          // Target unavailable: center the card defensively
          activeSpotlight.style.display = 'none';
          activeCard.style.left = `${Math.max(16, (window.innerWidth - 380) / 2)}px`;
          activeCard.style.top = `${Math.max(16, (window.innerHeight - 220) / 2)}px`;
        }
      }, 100);
    }
  }

  // Fading Scaffolding for Uses 2 & 3: Gentle Badge & Quick Tip
  function renderFadedScaffolding() {
    if (activeFadedTip || isSessionDismissed || activeOverlay || activePromptBanner) return;

    const floatingBtn = document.getElementById('voicebridge-floating-trigger');
    if (floatingBtn) {
      floatingBtn.classList.add('vb-trigger-pulse-badge');
    }

    const practiceNum = completedCount + 1;
    const isMac = navigator.platform && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const pasteShortcut = isMac ? 'Cmd + V' : 'Ctrl + V';
    const speechTip = `VoiceBridge practice session ${practiceNum} of 3. Click the microphone button to record, then paste with ${isMac ? 'Command plus V' : 'Control plus V'}.`;

    const tip = document.createElement('div');
    tip.className = 'vb-onboard-faded-tip';
    tip.setAttribute('role', 'status');
    tip.setAttribute('aria-live', 'polite');
    tip.innerHTML = `
      <div class="vb-onboard-icon" style="font-size: 24px;">🎙️</div>
      <div class="vb-onboard-faded-text">
        <strong>Practice ${practiceNum} of ${MAX_ONBOARDING_SESSIONS}:</strong>
        Click to record your voice, then paste with <kbd>${pasteShortcut}</kbd>!
      </div>
      <button type="button" class="vb-onboard-tts-btn" style="min-width: 40px; min-height: 40px; font-size: 16px;" title="Read aloud" aria-label="Listen to practice tip">🔊</button>
      <button type="button" class="vb-onboard-skip-btn" style="min-width: 40px; min-height: 40px; font-size: 16px;" title="Dismiss" aria-label="Dismiss practice tip">✕</button>
    `;

    tip.addEventListener('mousedown', (e) => e.preventDefault());

    tip.querySelector('.vb-onboard-tts-btn').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      speakText(speechTip);
    });

    tip.querySelector('.vb-onboard-skip-btn').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dismiss();
    });

    document.body.appendChild(tip);
    activeFadedTip = tip;

    function positionFadedTip() {
      if (!activeFadedTip) return;
      const btn = document.getElementById('voicebridge-floating-trigger');
      const r = getElementRect(btn);
      if (r) {
        const vw = window.innerWidth || 1024;
        const vh = window.innerHeight || 768;
        let left = r.left;
        let top = r.bottom + 12;
        if (top + 80 > vh) top = Math.max(12, r.top - 80);
        left = Math.max(12, Math.min(left, vw - 430));
        activeFadedTip.style.left = `${Math.round(left)}px`;
        activeFadedTip.style.top = `${Math.round(top)}px`;
      } else {
        activeFadedTip.style.right = '20px';
        activeFadedTip.style.bottom = '20px';
      }
    }

    positionFadedTip();
    window.addEventListener('resize', positionFadedTip);
  }

  // ==========================================================================
  // Onboarding Step Flow Implementations
  // ==========================================================================

  function step1FloatingTrigger() {
    renderStep(
      STEPS.FLOATING_TRIGGER,
      '#voicebridge-floating-trigger',
      {
        badge: 'Step 1 of 4 • Welcome!',
        icon: '🎙️',
        title: 'Click to Record Voice',
        desc: 'Click the <strong>Record Voice</strong> button to open your voice tool.',
        speechText: 'Step one: Click the Record Voice button to open your voice tool.',
        hint: 'Click 🎙️ Record Voice to open the recorder'
      }
    );
  }

  function step2ModalStart() {
    renderStep(
      STEPS.MODAL_START,
      '#vb-start-record-btn, .vb-btn-start',
      {
        badge: 'Step 2 of 4 • Ready to Speak',
        icon: '🎙️',
        title: 'Start Recording',
        desc: 'Click <strong>Start Recording</strong> or press <kbd>Space</kbd> when you are ready to answer.',
        speechText: 'Step two: Click Start Recording, or press Space, when you are ready to answer.',
        hint: 'Click Start Recording or press Space'
      }
    );
  }

  function step3ModalSpeak() {
    renderStep(
      STEPS.MODAL_SPEAK,
      '#vb-stop-btn, #vb-stop-record-btn, .vb-btn-stop',
      {
        badge: 'Step 3 of 4 • Speaking',
        icon: '🗣️',
        title: 'Speak Your Thoughts',
        desc: 'Speak clearly into your microphone. When you are finished, click <strong>Stop & Review</strong>.',
        speechText: 'Step three: Speak clearly into your microphone. When you are finished, click Stop and Review.',
        hint: 'Click ⏹️ Stop & Review when finished'
      }
    );
  }

  function step4ModalReview() {
    renderStep(
      STEPS.MODAL_REVIEW,
      '#vb-submit-btn, #vb-review-confirm-btn, .vb-btn-confirm',
      {
        badge: 'Step 4 of 4 • Review & Save',
        icon: '🎧',
        title: 'Listen & Save ✓',
        desc: 'Click ▶️ to listen and check your voice note. Click <strong>Insert Voice Note</strong> to save.',
        speechText: 'Step four: Click play to listen and check your voice note. Click Insert Voice Note to save.',
        hint: 'Click ✅ Insert Voice Note to upload'
      }
    );
  }

  function step5PasteInstruction() {
    renderStep(
      STEPS.PASTE_INSTRUCTION,
      '#voicebridge-floating-trigger',
      {
        badge: '🎉 Voice Note Ready!',
        icon: '📋',
        title: 'Paste Your Answer',
        desc: 'Great job! Your voice note is saved. Press {PASTE_KEY} to paste it wherever you type your answers.',
        speechText: 'Great job! Your voice note is saved. Press {PASTE_KEY} to paste it wherever you type your answers.',
        buttonHtml: `<button type="button" class="vb-onboard-btn-primary">Next Tip ➔</button>`,
        onButtonClick: () => {
          step6IntroduceInbox();
        }
      }
    );
  }

  function step6IntroduceInbox() {
    const inboxBtn = document.querySelector('.vb-injected-mic-btn');
    const targetSelector = inboxBtn ? '.vb-injected-mic-btn' : '#voicebridge-floating-trigger';

    renderStep(
      STEPS.INTRODUCE_INBOX,
      targetSelector,
      {
        badge: '⭐ Pro Tip • In-Box Mic',
        icon: '💬',
        title: '1-Click Comment Mic',
        desc: 'Next time, look inside any Google Docs or Classroom comment box for the 🎙️ <strong>mic button</strong> to record in 1 click!',
        speechText: 'Tip: Next time, look inside any Google Docs or Classroom comment box for the microphone button to record in one click.',
        buttonHtml: `<button type="button" class="vb-onboard-btn-primary">Got It! Finish Guide ✓</button>`,
        onButtonClick: () => {
          teardownOnboarding();
        }
      }
    );
  }

  // ==========================================================================
  // In-Comment Onboarding Steps (Google Docs & Google Classroom)
  // ==========================================================================

  function isDocsOrClassroom() {
    const host = window.location.hostname || '';
    return host.includes('docs.google.com') || host.includes('classroom.google.com') || host.includes('slides.google.com');
  }

  function isClassroom() {
    return (window.location.hostname || '').includes('classroom.google.com');
  }

  function showOpenCommentPrompt() {
    if (isSessionDismissed || activePromptBanner || activeOverlay || commentCompletedCount >= MAX_ONBOARDING_SESSIONS) return;
    if (!isDocsOrClassroom()) return;
    if (document.querySelector('.vb-injected-mic-btn')) {
      stepCommentMic();
      return;
    }

    // Ensure any faded tip and trigger pulse are removed so nothing overlaps
    if (activeFadedTip) {
      activeFadedTip.remove();
      activeFadedTip = null;
    }
    const floatingBtn = document.getElementById('voicebridge-floating-trigger');
    if (floatingBtn) {
      floatingBtn.classList.remove('vb-trigger-pulse-badge');
    }

    const classroom = isClassroom();
    const title = classroom ? 'Try a Classroom Voice Comment! 💬' : 'Try a Google Docs Voice Comment! 💬';
    const desc = classroom
      ? 'Click <strong>"Add private comment"</strong> under your assignment to talk with your teacher.'
      : 'Highlight any text and press the 💬 <strong>Comment</strong> button (or <kbd>Ctrl+Alt+M</kbd>) to open a comment.';
    const speech = classroom
      ? 'Hint two: Try a Classroom voice comment. Click Add private comment under your assignment to talk with your teacher.'
      : 'Hint two: Try a Google Docs voice comment. Highlight any text and press the Comment button to open a comment.';

    activePromptBanner = document.createElement('div');
    activePromptBanner.className = 'vb-onboard-prompt-banner';
    activePromptBanner.setAttribute('role', 'region');
    activePromptBanner.setAttribute('aria-label', title);
    activePromptBanner.addEventListener('mousedown', (e) => e.preventDefault());

    activePromptBanner.innerHTML = `
      <div class="vb-onboard-prompt-banner-header">
        <span class="vb-onboard-step-badge">Hint 2 • Voice Comment</span>
        <div class="vb-onboard-header-actions">
          <button type="button" class="vb-onboard-tts-btn" title="Read aloud" aria-label="Listen to instructions read aloud">🔊</button>
          <button type="button" class="vb-onboard-skip-btn" title="Dismiss banner" aria-label="Dismiss">✕</button>
        </div>
      </div>
      <h3 class="vb-onboard-prompt-banner-title">${title}</h3>
      <p class="vb-onboard-prompt-banner-desc">${desc}</p>
      <div class="vb-onboard-prompt-banner-actions">
        <button type="button" class="vb-onboard-btn-primary vb-prompt-got-it">Got it! ✓</button>
      </div>
    `;

    const ttsBtn = activePromptBanner.querySelector('.vb-onboard-tts-btn');
    if (ttsBtn) {
      ttsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        speakText(speech);
      });
    }

    const skipBtn = activePromptBanner.querySelector('.vb-onboard-skip-btn');
    if (skipBtn) {
      skipBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        hideOpenCommentPrompt();
      });
    }

    const gotItBtn = activePromptBanner.querySelector('.vb-prompt-got-it');
    if (gotItBtn) {
      gotItBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        hideOpenCommentPrompt();
      });
    }

    document.body.appendChild(activePromptBanner);
  }

  function hideOpenCommentPrompt() {
    stopSpeech();
    if (activePromptBanner) {
      activePromptBanner.remove();
      activePromptBanner = null;
    }
  }

  function stepCommentMic() {
    hideOpenCommentPrompt();
    if (activeFadedTip) {
      activeFadedTip.remove();
      activeFadedTip = null;
    }
    const floatingBtn = document.getElementById('voicebridge-floating-trigger');
    if (floatingBtn) {
      floatingBtn.classList.remove('vb-trigger-pulse-badge');
    }
    if (isSessionDismissed) return;
    renderStep(
      STEPS.COMMENT_MIC,
      '.vb-injected-mic-btn',
      {
        badge: 'Hint 2 • Comment Voice Note',
        icon: '🎙️',
        title: 'Click the 🎙️ Mic Button',
        desc: 'Click the VoiceBridge 🎙️ mic inside the comment box to record your voice in 1 click!',
        speechText: 'Hint two: Click the VoiceBridge microphone button inside the comment box to record your voice in one click.',
        hint: 'Click 🎙️ inside the comment box'
      }
    );
  }

  function stepCommentRecording() {
    hideOpenCommentPrompt();
    if (isSessionDismissed) return;
    renderStep(
      STEPS.COMMENT_RECORDING,
      '.vb-inbox-recorder .vb-inbox-done, .vb-inbox-recorder',
      {
        badge: 'Step 2 of 3 • Speak Your Answer',
        icon: '🗣️',
        title: 'Speak Your Comment',
        desc: 'Speak clearly into your microphone. When you are finished, click the ✓ <strong>checkmark button</strong>!',
        speechText: 'Step two: Speak clearly into your microphone. When you are finished, click the checkmark button.',
        hint: 'Click ✓ when finished speaking'
      }
    );
  }

  function findNativeCommentButton(input) {
    if (input) {
      const container = input.closest('.docos-input-textarea-wrapper, [role="region"], div[aria-label*="private" i], aside, form') || input.parentElement?.parentElement;
      if (container) {
        const btn = container.querySelector('button[aria-label*="comment" i], button[aria-label*="post" i], .docos-input-textarea ~ button, button[aria-label*="submit" i]') ||
          Array.from(container.querySelectorAll('button')).find(b => /comment|post/i.test(b.textContent || ''));
        if (btn) return btn;
      }
    }
    return document.querySelector('button[aria-label*="comment" i], button[aria-label*="post" i], .docos-input-textarea ~ button') ||
      Array.from(document.querySelectorAll('button')).find(b => /^(comment|post)$/i.test((b.textContent || '').trim()));
  }

  function stepCommentSubmit(input) {
    hideOpenCommentPrompt();
    if (isSessionDismissed) return;
    activeCommentInput = input;
    const submitBtn = findNativeCommentButton(input);

    renderStep(
      STEPS.COMMENT_SUBMIT,
      '.docos-input-textarea ~ button, button[aria-label*="comment" i], button[aria-label*="post" i], .vb-injected-mic-btn',
      {
        badge: 'Step 3 of 3 • Post Comment',
        icon: '🎉',
        title: 'Click Comment ✓',
        desc: 'Your voice note is ready in the comment box! Click <strong>Comment</strong> (or Post) to share it with your teacher.',
        speechText: 'Step three: Your voice note is ready in the comment box. Click Comment to share it with your teacher.',
        buttonHtml: `<button type="button" class="vb-onboard-btn-primary">Finish Guide ✓</button>`,
        onButtonClick: () => {
          incrementCommentCompletedCount();
          teardownOnboarding();
        }
      }
    );

    if (submitBtn) {
      updatePositions(submitBtn);
      startTrackingTarget(submitBtn);
      submitBtn.addEventListener('click', () => {
        incrementCommentCompletedCount();
        teardownOnboarding();
      }, { once: true });
    }
  }

  function renderCommentFadedScaffolding() {
    if (isSessionDismissed || commentCompletedCount === 0 || commentCompletedCount >= MAX_ONBOARDING_SESSIONS || activeOverlay || activePromptBanner) return;
    const inboxBtn = document.querySelector('.vb-injected-mic-btn');
    if (!inboxBtn) return;

    inboxBtn.classList.add('vb-comment-mic-pulse');

    if (activeFadedTip) activeFadedTip.remove();
    activeFadedTip = document.createElement('div');
    activeFadedTip.className = 'vb-onboard-faded-tip';
    activeFadedTip.addEventListener('mousedown', (e) => e.preventDefault());
    activeFadedTip.innerHTML = `
      <div class="vb-onboard-faded-text">
        <strong>Practice ${commentCompletedCount + 1} of 3:</strong> Click 🎙️ inside the comment box to record your voice note!
      </div>
      <button type="button" class="vb-onboard-skip-btn" title="Dismiss tip" aria-label="Dismiss">✕</button>
    `;

    const skipBtn = activeFadedTip.querySelector('.vb-onboard-skip-btn');
    if (skipBtn) {
      skipBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (activeFadedTip) {
          activeFadedTip.remove();
          activeFadedTip = null;
        }
      });
    }

    document.body.appendChild(activeFadedTip);

    function positionCommentFadedTip() {
      if (!activeFadedTip) return;
      const btn = document.querySelector('.vb-injected-mic-btn');
      if (!btn) return;

      const commentBox = findActiveCommentBox();
      const targetRect = commentBox ? commentBox.getBoundingClientRect() : btn.getBoundingClientRect();
      const tipRect = activeFadedTip.getBoundingClientRect();
      const tipHeight = tipRect.height || 52;
      const tipWidth = tipRect.width || 380;
      const margin = 12;
      const vw = window.innerWidth || 1024;
      const vh = window.innerHeight || 768;

      // Prefer placing ABOVE the comment box so it doesn't block clicking or typing
      let top = targetRect.top - tipHeight - margin;
      if (top < margin) {
        top = Math.min(vh - tipHeight - margin, targetRect.bottom + margin);
      }

      let left = targetRect.right - tipWidth;
      left = Math.max(margin, Math.min(left, vw - tipWidth - margin));

      activeFadedTip.style.left = `${Math.round(left)}px`;
      activeFadedTip.style.top = `${Math.round(top)}px`;
    }

    positionCommentFadedTip();
    window.addEventListener('resize', positionCommentFadedTip);
    window.addEventListener('scroll', positionCommentFadedTip, true);

    setTimeout(() => {
      if (activeFadedTip) {
        activeFadedTip.remove();
        activeFadedTip = null;
      }
    }, 9000);
  }

  // ==========================================================================
  // Public Controller & State Notification Hooks
  // ==========================================================================

  function startOnboarding() {
    if (isSessionDismissed) return;

    loadCompletedCounts((modalCount, commentCount) => {
      if (isDocsOrClassroom()) {
        // Sequenced Onboarding on Docs & Classroom:
        // Hint 1: Large Button Tour (modalCount === 0)
        // Hint 2: Suggest Voice Comment in the app, WITHOUT showing the large button (modalCount >= 1 && commentCount === 0)
        // Hint 3 / Practice: Both have been shown (modalCount >= 1 && commentCount >= 1), strictly one element at a time

        if (modalCount === 0) {
          // Hint 1: Teach student how to use the large button
          setTimeout(() => {
            if (!isSessionDismissed && !currentStep && !document.querySelector('.vb-injected-mic-btn')) {
              step1FloatingTrigger();
            }
          }, 600);
          return;
        }

        if (commentCount === 0) {
          // Hint 2: Suggest student leave a voice comment in the app, WITHOUT showing the use of the large button!
          setTimeout(() => {
            if (isSessionDismissed || currentStep || activePromptBanner || activeOverlay) return;
            const inboxBtn = document.querySelector('.vb-injected-mic-btn');
            if (inboxBtn) {
              stepCommentMic();
            } else {
              showOpenCommentPrompt();
            }
          }, 800);
          return;
        }

        // Hint 3 / Subsequent: Both flows have been shown!
        // Show fading scaffolding strictly one at a time (never overlapping)
        setTimeout(() => {
          if (isSessionDismissed || currentStep || activePromptBanner || activeOverlay || activeFadedTip) return;
          const inboxBtn = document.querySelector('.vb-injected-mic-btn');
          if (inboxBtn && commentCount < MAX_ONBOARDING_SESSIONS) {
            renderCommentFadedScaffolding();
          } else if (modalCount < MAX_ONBOARDING_SESSIONS) {
            renderFadedScaffolding();
          }
        }, 800);
        return;
      }

      // Non-Docs/Classroom pages (generic pages with no comment box):
      if (modalCount < MAX_ONBOARDING_SESSIONS) {
        if (modalCount === 0) {
          setTimeout(() => {
            if (!isSessionDismissed && !currentStep) {
              step1FloatingTrigger();
            }
          }, 600);
        } else {
          setTimeout(() => {
            if (!isSessionDismissed && !currentStep && !activeFadedTip) {
              renderFadedScaffolding();
            }
          }, 800);
        }
      }
    });
  }

  // Lifecycle Notification API called from content.js
  const VoiceBridgeOnboarding = {
    init: function () {
      startOnboarding();
    },

    notifyModalOpened: function () {
      if (isSessionDismissed) return;
      hideOpenCommentPrompt();
      if (activeFadedTip) {
        activeFadedTip.remove();
        activeFadedTip = null;
      }
      if (completedCount === 0) {
        step2ModalStart();
      }
    },

    notifyModalClosed: function () {
      if (isSessionDismissed) return;
      if (completedCount === 0 && currentStep !== STEPS.PASTE_INSTRUCTION && currentStep !== STEPS.INTRODUCE_INBOX) {
        step1FloatingTrigger();
      }
    },

    notifyRecordingStarted: function () {
      if (isSessionDismissed) return;
      if (completedCount === 0) {
        step3ModalSpeak();
      }
    },

    notifyRecordingStopped: function () {
      if (isSessionDismissed) return;
      if (completedCount === 0) {
        step4ModalReview();
      }
    },

    notifyRecordingFinished: function () {
      incrementCompletedCount();
      if (isSessionDismissed) return;

      if (completedCount === 1) {
        step5PasteInstruction();
      } else {
        teardownOnboarding();
      }
    },

    notifyInboxButtonsUpdated: function () {
      if (isSessionDismissed) return;
      const inboxBtn = document.querySelector('.vb-injected-mic-btn');

      if (currentStep === STEPS.INTRODUCE_INBOX && activeSpotlight && inboxBtn) {
        updatePositions(inboxBtn);
        return;
      }

      if (inboxBtn) {
        hideOpenCommentPrompt();
        if (commentCompletedCount === 0 && !currentStep) {
          if (!commentTourTimer) {
            commentTourTimer = setTimeout(() => {
              commentTourTimer = null;
              if (isSessionDismissed || currentStep) return;
              const liveBtn = document.querySelector('.vb-injected-mic-btn');
              if (liveBtn && liveBtn.isConnected) {
                stepCommentMic();
              }
            }, 1000);
          }
        } else if (currentStep === STEPS.COMMENT_MIC) {
          updatePositions(inboxBtn);
        } else if (commentCompletedCount > 0 && commentCompletedCount < MAX_ONBOARDING_SESSIONS && !activeFadedTip && !activeOverlay) {
          if (!commentScaffoldingTimer) {
            commentScaffoldingTimer = setTimeout(() => {
              commentScaffoldingTimer = null;
              if (isSessionDismissed || activeFadedTip || activeOverlay || activePromptBanner) return;
              const liveBtn = document.querySelector('.vb-injected-mic-btn');
              if (liveBtn && liveBtn.isConnected) {
                renderCommentFadedScaffolding();
              }
            }, 1500);
          }
        }
      } else {
        clearCommentTimers();
        if (currentStep === STEPS.COMMENT_MIC) {
          teardownOnboarding();
        }
      }
    },

    notifyInboxRecordingStarted: function () {
      if (isSessionDismissed) return;
      clearCommentTimers();
      if (activeFadedTip) {
        activeFadedTip.remove();
        activeFadedTip = null;
      }
      if (commentCompletedCount === 0) {
        stepCommentRecording();
      }
    },

    notifyInboxRecordingCancelled: function () {
      if (isSessionDismissed) return;
      if (currentStep === STEPS.COMMENT_RECORDING) {
        const inboxBtn = document.querySelector('.vb-injected-mic-btn');
        if (inboxBtn) {
          stepCommentMic();
        } else {
          teardownOnboarding();
        }
      }
    },

    notifyInboxRecordingFinished: function (input) {
      if (isSessionDismissed) return;
      if (commentCompletedCount === 0) {
        stepCommentSubmit(input);
      } else {
        incrementCommentCompletedCount();
        teardownOnboarding();
      }
    },

    resetAndRestart: function () {
      resetCompletedCount();
    },

    dismiss: function () {
      dismiss();
    },

    getCompletedCount: function () {
      return completedCount;
    },

    getCommentCompletedCount: function () {
      return commentCompletedCount;
    },

    getCurrentStep: function () {
      return currentStep;
    }
  };

  // Listen for reset message from popup or background
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request && request.action === 'RESTART_ONBOARDING') {
        VoiceBridgeOnboarding.resetAndRestart();
        sendResponse({ success: true });
      }
    });
  }

  // Export to window
  window.VoiceBridgeOnboarding = VoiceBridgeOnboarding;

  // Auto-init when script loads
  VoiceBridgeOnboarding.init();
})();
