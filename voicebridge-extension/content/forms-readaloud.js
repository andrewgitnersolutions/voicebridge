/**
 * VoiceBridge — Google Forms Read-Aloud Content Script
 * 
 * Injects a VoiceBridge icon button beside each question in a Google Form.
 * When clicked, the browser's speechSynthesis API reads the entire question block
 * (title + description + answer options) aloud with karaoke-style word highlighting.
 * 
 * Design Principles:
 *   - Zero server cost: uses browser-native TTS (no cloud API)
 *   - Student-controlled: works on any form without teacher setup
 *   - ARIA-based DOM targeting: resilient to Google's obfuscated class names
 *   - Graceful degradation: if onboundary doesn't fire, audio still plays
 *   - Isolated: runs only on Google Forms, doesn't touch Classroom/Docs/Slides code
 */

(function () {
  'use strict';

  // Guard against double-injection
  if (window.__vbFormsReadAloudInjected) return;
  window.__vbFormsReadAloudInjected = true;

  // ================================================================
  // CONSTANTS
  // ================================================================

  const INJECTED_ATTR = 'data-vb-readaloud';
  const ICON_PATH = 'icons/icon-48.png';
  const SCAN_DEBOUNCE_MS = 300;
  const BOUNDARY_TIMEOUT_MS = 800; // Fallback if onboundary never fires
  const TTS_RATE = 0.9; // Slightly slower for accessibility
  const TTS_LANG = 'en-US';

  // ================================================================
  // STATE
  // ================================================================

  let selectedVoice = null;
  let voicesLoaded = false;
  let currentUtterance = null;
  let currentPlayingBtn = null;
  let currentWordSpans = []; // Array of { element, originalParent, originalNodes }
  let boundaryReceived = false;
  let iconUrl = '';

  // ================================================================
  // INITIALIZATION
  // ================================================================

  /**
   * Resolve the extension icon URL. Must use chrome.runtime.getURL()
   * because content scripts can't reference extension resources directly.
   */
  function resolveIconUrl() {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      iconUrl = chrome.runtime.getURL(ICON_PATH);
    }
  }

  /**
   * Load available TTS voices, preferring local English voices for
   * reliable onboundary event support.
   */
  function loadVoices() {
    const voices = speechSynthesis.getVoices();
    if (voices.length === 0) return;

    voicesLoaded = true;

    // Priority 1: local English voice
    const localEnglish = voices.filter(
      (v) => v.localService && v.lang.startsWith('en')
    );
    if (localEnglish.length > 0) {
      // Prefer "Google US English" or "Microsoft" voices if available
      selectedVoice =
        localEnglish.find((v) => v.name.includes('Google US English')) ||
        localEnglish.find((v) => v.name.includes('Google')) ||
        localEnglish.find((v) => v.name.includes('English')) ||
        localEnglish[0];
      return;
    }

    // Priority 2: any English voice (even cloud-based)
    const anyEnglish = voices.filter((v) => v.lang.startsWith('en'));
    if (anyEnglish.length > 0) {
      selectedVoice = anyEnglish[0];
      return;
    }

    // Priority 3: default voice
    selectedVoice = voices[0] || null;
  }

  // ================================================================
  // GOOGLE FORMS DOM SCANNER
  // ================================================================

  /**
   * Detect if we're on a Google Forms response page (student-facing).
   * The editor URL contains /edit, while student forms use /viewform or
   * are accessed directly by form ID.
   */
  function isFormsResponsePage() {
    const path = window.location.pathname;
    return (
      path.includes('/forms/') &&
      !path.includes('/edit') &&
      !path.includes('/admin')
    );
  }

  /**
   * Find all question containers on the page.
   * Google Forms uses div[role="listitem"] for each question block.
   * Falls back to structural heuristics if ARIA roles are missing.
   */
  function findQuestionContainers() {
    // Primary: ARIA role-based (most reliable)
    let containers = Array.from(
      document.querySelectorAll('div[role="listitem"]')
    );

    // Filter to only containers that look like actual questions
    // (have a heading and/or form inputs, not empty dividers)
    containers = containers.filter((el) => {
      const hasHeading = el.querySelector('div[role="heading"], [data-params]');
      const hasInput = el.querySelector(
        'input, textarea, [role="radio"], [role="checkbox"], [role="listbox"], [role="radiogroup"], [role="group"]'
      );
      const hasText = el.textContent.trim().length > 5;
      return (hasHeading || hasInput) && hasText;
    });

    return containers;
  }

  /**
   * Extract all readable text from a question container, in reading order.
   * Returns an array of { text, element } objects for each distinct text block.
   */
  function extractQuestionText(container) {
    const parts = [];

    // 1. Question title (heading)
    const headings = container.querySelectorAll('div[role="heading"]');
    headings.forEach((h) => {
      const text = h.textContent.trim();
      if (text) parts.push({ text, element: h });
    });

    // 2. Description text (non-heading, non-interactive text blocks)
    // Look for description spans — typically the element right after the heading
    // that contains supplementary text but is not a form control
    const allTextNodes = [];
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;

          // Skip if inside a heading (already captured above)
          if (parent.closest('div[role="heading"]')) return NodeFilter.FILTER_REJECT;

          // Skip if inside an input/interactive element
          if (
            parent.closest(
              'input, textarea, select, [role="radio"], [role="checkbox"], [role="listbox"], [role="option"], label'
            )
          )
            return NodeFilter.FILTER_REJECT;

          // Skip if inside our own injected UI
          if (parent.closest('.vb-ra-btn, .vb-ra-tooltip'))
            return NodeFilter.FILTER_REJECT;

          // Skip trivially short text (single chars, asterisks, etc.)
          const text = node.textContent.trim();
          if (text.length < 3) return NodeFilter.FILTER_REJECT;

          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    let tNode;
    while ((tNode = walker.nextNode())) {
      const text = tNode.textContent.trim();
      // Deduplicate against headings
      const isDupe = parts.some((p) => p.text === text);
      if (!isDupe) {
        allTextNodes.push({ text, element: tNode.parentElement });
      }
    }
    parts.push(...allTextNodes);

    // 3. Answer options (radio buttons, checkboxes, dropdown items)
    const options = container.querySelectorAll(
      '[role="radio"], [role="checkbox"], [role="option"]'
    );
    options.forEach((opt) => {
      // Extract the label text (not the input value)
      const label =
        opt.getAttribute('aria-label') ||
        opt.querySelector('span')?.textContent?.trim() ||
        opt.textContent.trim();
      if (label && label.length > 0) {
        const isDupe = parts.some((p) => p.text === label);
        if (!isDupe) {
          parts.push({ text: label, element: opt });
        }
      }
    });

    // Also check for labels wrapping radio/checkbox inputs
    const labels = container.querySelectorAll('label');
    labels.forEach((lbl) => {
      const text = lbl.textContent.trim();
      if (text && text.length > 0) {
        const isDupe = parts.some((p) => p.text === text);
        if (!isDupe) {
          parts.push({ text, element: lbl });
        }
      }
    });

    return parts;
  }

  const MAX_TTS_LENGTH = 5000;

  /**
   * Build a single string from all question parts, with natural pauses.
   * Caps maximum character length to prevent browser TTS freeze/DoS (M-6).
   */
  function buildFullText(parts) {
    let full = parts.map((p) => sanitizeForSpeech(p.text)).join('. ');
    if (full.length > MAX_TTS_LENGTH) {
      const truncated = full.substring(0, MAX_TTS_LENGTH);
      const lastPeriod = truncated.lastIndexOf('.');
      const lastSpace = truncated.lastIndexOf(' ');
      const cutoff = lastPeriod > MAX_TTS_LENGTH * 0.8 ? lastPeriod + 1 : (lastSpace > 0 ? lastSpace : MAX_TTS_LENGTH);
      full = full.substring(0, cutoff) + '... (Question text truncated for length)';
    }
    return full;
  }

  /**
   * Sanitize text for natural TTS in a quiz/test context.
   * Converts common fill-in-the-blank patterns to the spoken word "blank"
   * and cleans up characters that TTS would read literally.
   */
  function sanitizeForSpeech(text) {
    let result = text;

    // __ (2+ underscores, with or without spaces) → "blank"
    result = result.replace(/_{2,}/g, ' blank ');

    // -- (2+ hyphens/dashes used as blanks) → "blank"
    result = result.replace(/-{3,}/g, ' blank ');

    // .. (3+ dots used as blanks, not ellipsis at end of sentence) → "blank"
    result = result.replace(/\.{3,}(?=\s|\w)/g, ' blank ');

    // Trailing ellipsis (…) or (...) → natural pause (just remove it, TTS handles periods)
    result = result.replace(/…/g, '.');
    result = result.replace(/\.{3,}$/g, '.');

    // Asterisks used for emphasis (*word* or **word**) → just the word
    result = result.replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1');

    // Repeated special chars that TTS reads individually (e.g., ===, ~~~, ***)
    result = result.replace(/([=~*#|])\1{2,}/g, '');

    // Clean up multiple spaces created by replacements
    result = result.replace(/\s{2,}/g, ' ').trim();

    return result;
  }

  // ================================================================
  // SPEAKER BUTTON INJECTION
  // ================================================================

  /**
   * Inject a VoiceBridge read-aloud button into a question container.
   */
  function injectReadAloudButton(container) {
    if (container.getAttribute(INJECTED_ATTR) === 'true') return;
    container.setAttribute(INJECTED_ATTR, 'true');

    const parts = extractQuestionText(container);
    if (parts.length === 0) return;

    const fullText = buildFullText(parts);
    if (fullText.trim().length === 0) return;

    // Create the button
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vb-ra-btn';
    btn.title = 'Click to hear this question read aloud (VoiceBridge)';
    btn.setAttribute(
      'aria-label',
      'Read aloud: ' + fullText.substring(0, 80) + (fullText.length > 80 ? '…' : '')
    );

    // Use the VoiceBridge extension icon
    if (iconUrl) {
      const img = document.createElement('img');
      img.src = iconUrl;
      img.alt = '';
      img.className = 'vb-ra-btn-icon';
      img.setAttribute('aria-hidden', 'true');
      btn.appendChild(img);
    } else {
      // Fallback if icon URL couldn't be resolved
      btn.textContent = '🔊';
    }

    // Tooltip
    const tooltip = document.createElement('span');
    tooltip.className = 'vb-ra-tooltip';
    tooltip.textContent = 'Read aloud';
    tooltip.setAttribute('aria-hidden', 'true');
    btn.appendChild(tooltip);

    // Click handler
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleReadAloudClick(btn, container, parts, fullText);
    });

    // Insert the button — find the first heading in the container
    // and place the button just before it, or at the top of the container
    const heading = container.querySelector('div[role="heading"]');
    if (heading) {
      // Position relative to the heading's parent so it sits beside the question
      const headingParent = heading.parentElement;
      if (headingParent && headingParent !== container) {
        headingParent.style.display = 'flex';
        headingParent.style.alignItems = 'flex-start';
        headingParent.insertBefore(btn, heading);
      } else {
        container.style.position = 'relative';
        heading.style.display = 'flex';
        heading.style.alignItems = 'center';
        heading.insertBefore(btn, heading.firstChild);
      }
    } else {
      // No heading found — prepend to container
      container.style.position = 'relative';
      container.insertBefore(btn, container.firstChild);
    }
  }

  // ================================================================
  // READ-ALOUD HANDLER
  // ================================================================

  /**
   * Handle a click on a read-aloud button.
   * If currently playing the same question: stop.
   * If playing a different question: stop the old one, start this one.
   * If not playing: start.
   */
  function handleReadAloudClick(btn, container, parts, fullText) {
    // Toggle off if same button is clicked while playing
    if (currentPlayingBtn === btn) {
      stopSpeaking();
      return;
    }

    // Stop any current speech first
    if (currentPlayingBtn) {
      stopSpeaking();
    }

    // Start speaking
    startSpeaking(btn, container, parts, fullText);
  }

  // ================================================================
  // TTS ENGINE
  // ================================================================

  /**
   * Begin TTS playback for a question block.
   */
  function startSpeaking(btn, container, parts, fullText) {
    if (!fullText || fullText.trim().length === 0) return;

    // Ensure voices are loaded
    if (!voicesLoaded) {
      loadVoices();
    }

    // Cancel any leftover speech
    speechSynthesis.cancel();

    // Set up the karaoke word wrapping
    const wordData = wrapWordsForHighlighting(container, parts);
    currentWordSpans = wordData;
    boundaryReceived = false;

    // Create utterance
    const utterance = new SpeechSynthesisUtterance(fullText);
    utterance.rate = TTS_RATE;
    utterance.lang = TTS_LANG;
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }

    currentUtterance = utterance;
    currentPlayingBtn = btn;
    btn.classList.add('vb-ra-playing');

    // --- Event Handlers ---

    // onboundary: karaoke word highlighting
    utterance.onboundary = (event) => {
      if (event.name === 'word') {
        boundaryReceived = true;
        highlightWordAtCharIndex(event.charIndex, fullText);
      }
    };

    // onend: cleanup
    utterance.onend = () => {
      cleanupAfterSpeech(btn);
    };

    // onerror: cleanup on error too
    utterance.onerror = (event) => {
      // 'canceled' is expected when user stops manually
      if (event.error !== 'canceled') {
        console.warn('[VoiceBridge Read-Aloud] TTS error:', event.error);
      }
      cleanupAfterSpeech(btn);
    };

    // Speak!
    speechSynthesis.speak(utterance);

    // Fallback: if no boundary events fire within timeout,
    // disable highlighting but let audio continue
    setTimeout(() => {
      if (!boundaryReceived && currentPlayingBtn === btn) {
        // Remove all word spans — highlighting won't work, but audio plays fine
        unwrapAllWords();
      }
    }, BOUNDARY_TIMEOUT_MS);

    // Chrome has a bug where speechSynthesis pauses after ~15 seconds.
    // Workaround: periodically call resume() while speaking.
    startChromeResumeBugWorkaround();
  }

  /**
   * Stop current speech and clean up.
   */
  function stopSpeaking() {
    speechSynthesis.cancel();
    stopChromeResumeBugWorkaround();
    if (currentPlayingBtn) {
      cleanupAfterSpeech(currentPlayingBtn);
    }
  }

  /**
   * Post-speech cleanup: remove highlights, restore DOM, reset state.
   */
  function cleanupAfterSpeech(btn) {
    stopChromeResumeBugWorkaround();
    btn.classList.remove('vb-ra-playing');
    unwrapAllWords();
    currentUtterance = null;
    currentPlayingBtn = null;
    currentWordSpans = [];
    boundaryReceived = false;
  }

  // Chrome 15-second pause bug workaround
  let chromeResumeInterval = null;

  function startChromeResumeBugWorkaround() {
    stopChromeResumeBugWorkaround();
    chromeResumeInterval = setInterval(() => {
      if (speechSynthesis.speaking && !speechSynthesis.paused) {
        speechSynthesis.pause();
        speechSynthesis.resume();
      }
    }, 10000); // Every 10 seconds
  }

  function stopChromeResumeBugWorkaround() {
    if (chromeResumeInterval) {
      clearInterval(chromeResumeInterval);
      chromeResumeInterval = null;
    }
  }

  // ================================================================
  // KARAOKE WORD HIGHLIGHTING
  // ================================================================

  /**
   * Wrap each word in the visible text elements with <span> elements
   * so we can highlight them individually during speech.
   * 
   * Returns an array of restoration data to unwrap later.
   */
  function wrapWordsForHighlighting(container, parts) {
    const allSpans = [];
    let globalCharOffset = 0;

    parts.forEach((part, partIndex) => {
      const el = part.element;
      if (!el || !el.parentNode) {
        // Advance the char offset by this part's text + the '. ' separator
        globalCharOffset += part.text.length + (partIndex < parts.length - 1 ? 2 : 0);
        return;
      }

      // Save original content for restoration
      const originalHTML = el.innerHTML;
      const words = part.text.split(/(\s+)/); // Keep whitespace tokens

      let charIndex = globalCharOffset;
      const spans = [];
      const fragment = document.createDocumentFragment();

      words.forEach((word) => {
        if (/^\s+$/.test(word)) {
          // Whitespace — keep as text node
          fragment.appendChild(document.createTextNode(word));
          charIndex += word.length;
        } else if (word.length > 0) {
          const span = document.createElement('span');
          span.className = 'vb-ra-word';
          span.textContent = word;
          span.setAttribute('data-vb-char-start', charIndex);
          span.setAttribute('data-vb-char-end', charIndex + word.length);
          fragment.appendChild(span);
          spans.push(span);
          charIndex += word.length;
        }
      });

      // Only wrap if we found the text in the element and it's a simple text node
      // (not a complex nested structure that would break if we replace innerHTML)
      if (spans.length > 0 && isSimpleTextElement(el, part.text)) {
        allSpans.push({
          element: el,
          originalHTML: originalHTML,
          spans: spans,
        });

        // Clear and replace with wrapped spans
        el.textContent = '';
        el.appendChild(fragment);
      }

      // Advance global offset: text length + '. ' separator between parts
      globalCharOffset +=
        part.text.length + (partIndex < parts.length - 1 ? 2 : 0);
    });

    return allSpans;
  }

  /**
   * Check if an element is a simple text container that's safe to wrap.
   * We don't want to destroy complex nested HTML (images, links, etc.)
   */
  function isSimpleTextElement(el, expectedText) {
    // If the element has child elements (not just text nodes), skip wrapping
    // to avoid breaking the DOM structure
    if (el.children.length > 0) {
      // Exception: if all children are simple spans, it's probably already
      // a styled text container and safe to wrap
      const allSpans = Array.from(el.children).every(
        (c) => c.tagName === 'SPAN' && c.children.length === 0
      );
      if (!allSpans) return false;
    }

    // Verify text content roughly matches what we expect
    const actualText = el.textContent.trim();
    return actualText.includes(expectedText.substring(0, 20));
  }

  /**
   * Highlight the word at the given character index in the full text.
   */
  function highlightWordAtCharIndex(charIndex) {
    // Remove previous highlight
    const prev = document.querySelector('.vb-ra-word-active');
    if (prev) prev.classList.remove('vb-ra-word-active');

    // Find the matching span across all wrapped elements
    for (const data of currentWordSpans) {
      for (const span of data.spans) {
        const start = parseInt(span.getAttribute('data-vb-char-start'), 10);
        const end = parseInt(span.getAttribute('data-vb-char-end'), 10);
        if (charIndex >= start && charIndex < end) {
          span.classList.add('vb-ra-word-active');

          // Scroll the highlighted word into view if needed
          span.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          return;
        }
      }
    }
  }

  /**
   * Unwrap all word spans, restoring original element content.
   * Verifies element integrity to prevent restoring stale HTML if host mutated externally (M-9).
   */
  function unwrapAllWords() {
    // Remove any lingering active class
    document.querySelectorAll('.vb-ra-word-active').forEach((el) => {
      el.classList.remove('vb-ra-word-active');
    });

    // Restore original HTML safely
    for (const data of currentWordSpans) {
      if (data.element && data.element.parentNode && data.originalHTML !== undefined) {
        // Integrity check: verify our word spans are still present (element wasn't mutated externally)
        const wrappedSpans = data.element.querySelectorAll('.vb-ra-word');
        if (wrappedSpans.length > 0) {
          data.element.innerHTML = data.originalHTML;
        } else {
          console.warn('[VoiceBridge Read-Aloud] Element modified externally during speech, skipping stale innerHTML restore');
        }
      }
    }
    currentWordSpans = [];
  }

  // ================================================================
  // DOM SCANNING & MUTATION OBSERVER
  // ================================================================

  /**
   * Scan the page for question containers and inject buttons.
   */
  function scanAndInject() {
    if (!isFormsResponsePage()) return;

    const containers = findQuestionContainers();
    containers.forEach((container) => {
      injectReadAloudButton(container);
    });
  }

  /**
   * Debounced scanner — called on DOM mutations.
   */
  let scanTimer = null;
  function debouncedScan() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scanAndInject();
    }, SCAN_DEBOUNCE_MS);
  }

  // ================================================================
  // PAGE NAVIGATION HANDLER
  // ================================================================

  /**
   * Stop speech when navigating between form sections.
   * Google Forms uses History API for multi-page forms.
   */
  function setupNavigationListener() {
    // Listen for hash changes (form section navigation)
    window.addEventListener('hashchange', () => {
      stopSpeaking();
      // Re-scan after a brief delay for new content to load
      setTimeout(scanAndInject, 500);
    });

    // Listen for popstate (back/forward navigation)
    window.addEventListener('popstate', () => {
      stopSpeaking();
      setTimeout(scanAndInject, 500);
    });

    // Stop speech if the page is being unloaded
    window.addEventListener('beforeunload', () => {
      speechSynthesis.cancel();
    });
  }

  // ================================================================
  // THEME INTEGRATION
  // ================================================================

  /**
   * Apply VoiceBridge theme classes from user settings.
   * Mirrors the logic in content.js but scoped to our needs.
   */
  function loadThemeSettings() {
    if (
      typeof chrome !== 'undefined' &&
      chrome.runtime &&
      chrome.runtime.sendMessage
    ) {
      chrome.runtime.sendMessage({ action: 'GET_USER_SETTINGS' }, (settings) => {
        if (settings) {
          applyTheme(settings);
        }
      });
    }

    // Listen for real-time theme changes
    if (
      typeof chrome !== 'undefined' &&
      chrome.storage &&
      chrome.storage.onChanged
    ) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
          const updates = {};
          if (changes.theme) updates.theme = changes.theme.newValue;
          if (changes.fontFamily) updates.fontFamily = changes.fontFamily.newValue;
          if (Object.keys(updates).length > 0) {
            applyTheme(updates);
          }
        }
      });
    }
  }

  function applyTheme(settings) {
    document.body.classList.remove(
      'vb-font-dyslexic',
      'vb-theme-high-contrast',
      'vb-theme-pastel'
    );
    if (settings.fontFamily === 'opendyslexic') {
      document.body.classList.add('vb-font-dyslexic');
    }
    if (settings.theme === 'high-contrast') {
      document.body.classList.add('vb-theme-high-contrast');
    } else if (settings.theme === 'pastel') {
      document.body.classList.add('vb-theme-pastel');
    }
  }

  // ================================================================
  // BOOTSTRAP
  // ================================================================

  function init() {
    // Only run on Google Forms response pages
    if (!isFormsResponsePage()) return;

    resolveIconUrl();
    loadThemeSettings();

    // Load TTS voices (may fire asynchronously)
    loadVoices();
    if (!voicesLoaded) {
      speechSynthesis.addEventListener('voiceschanged', () => {
        loadVoices();
      });
    }

    // Initial scan
    scanAndInject();

    // Watch for DOM changes (dynamic form content, lazy loading, section navigation)
    const observer = new MutationObserver(() => {
      debouncedScan();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Set up navigation listeners
    setupNavigationListener();

    console.log('[VoiceBridge] Forms Read-Aloud initialized');
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
