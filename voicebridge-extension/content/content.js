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

  let recordingState = 'IDLE'; // 'IDLE' | 'READY' | 'STARTING' | 'RECORDING' | 'STOPPING' | 'REVIEW' | 'UPLOADING'
  let recordedAudioBase64 = null;
  let recordedDuration = 0;
  let timerInterval = null;
  let secondsElapsed = 0;
  let activeModal = null;
  let activeVoiceBubble = null;
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

  // Recording limits.
  //
  // The cap exists because the audio's base64 crosses chrome.runtime.sendMessage
  // in one piece and uploads as a single non-chunked multipart request — both give
  // out well before a student notices they left the mic running. The floor exists
  // because tapping the mic and immediately confirming used to upload a near-empty
  // file labelled 0:00, which reads as a posted voice note that says nothing.
  const MAX_RECORDING_SECONDS = 300;   // 5 minutes
  const MIN_RECORDING_SECONDS = 1;
  const COUNTDOWN_FROM_SECONDS = 30;   // when the timer starts showing time remaining

  // A chrome.runtime.sendMessage callback simply never fires if the service
  // worker is torn down mid-request. Both long requests — stop and upload — left
  // "Saving to your Google Drive…" on screen forever with no way out, so every
  // one of them now has a deadline.
  const STOP_TIMEOUT_MS = 15000;
  const UPLOAD_TIMEOUT_MS = 120000;   // a few MB on school wifi

  function sendMessageWithTimeout(message, timeoutMs, callback) {
    let settled = false;
    const finish = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(res);
    };
    const timer = setTimeout(
      () => finish({ success: false, timedOut: true, error: 'VoiceBridge stopped responding.' }),
      timeoutMs
    );

    try {
      chrome.runtime.sendMessage(message, (res) => {
        finish(chrome.runtime.lastError ? { success: false, error: chrome.runtime.lastError.message } : res);
      });
    } catch (err) {
      finish({ success: false, error: err.message });
    }
  }

  function formatClock(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    return `${m}:${(totalSeconds % 60).toString().padStart(2, '0')}`;
  }

  // Classroom is the only host where a mis-detection is published to a whole
  // class, so it gets a stricter gate than Docs and Slides (see isPublicClassStream).
  const IS_CLASSROOM = location.hostname === 'classroom.google.com';

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

  // 2. In-box recorder targets
  // One collector for every rich-text surface a student can drop a link into:
  // Google Docs/Slides comment boxes, Slides speaker notes, and Google Classroom
  // PRIVATE comments. Public Class comments and stream announcements are excluded
  // for student privacy and emotional safety.
  // Google has redesigned the Docs comment box more than once, and each redesign
  // renamed its classes. Rather than pin one class name, find anything editable
  // that sits inside a comment widget and is not the document canvas.
  // Everything a field says about itself, lower-cased, for the word tests below.
  function describedText(el) {
    return [
      el.getAttribute('aria-label'),
      el.getAttribute('placeholder'),
      el.getAttribute('data-placeholder'),
      el.getAttribute('aria-placeholder'),
      el.getAttribute('title')
    ].filter(Boolean).join(' ').toLowerCase();
  }

  // Word lists, not sentences, so they survive Google's phrasing changes within a
  // locale. These replaced bare English string matches: the guards below did
  // literally nothing outside English, and the districts this product is sold into
  // are the multilingual ones.
  //
  // A stopgap, and deliberately marked as one. The durable fix is a structural
  // discriminator (a container attribute that distinguishes private from stream),
  // which needs Classroom markup nobody has captured yet — see
  // isPrivateClassroomSurface, where it plugs in.
  const COMMENT_WORDS = [
    'comment', 'reply', 'respond', 'response', 'feedback',        // en
    'comentario', 'comentarios', 'responder', 'respuesta',         // es
    'comentário', 'comentar', 'resposta',                          // pt
    'commentaire', 'répondre', 'réponse', 'commenter',             // fr
    'kommentar', 'antworten', 'antwort', 'rückmeldung',            // de
    'commento', 'commenti', 'rispondi', 'risposta',                // it
    'reactie', 'opmerking', 'reageren', 'antwoord',                // nl
    'komentarz', 'odpowiedz', 'odpowiedź',                         // pl
    'комментарий', 'ответить', 'ответ',                            // ru
    'коментар', 'відповісти', 'відповідь',                         // uk
    'تعليق', 'رد', 'ملاحظات',                                      // ar
    'הערה', 'תגובה',                                               // he
    '评论', '回复', '意见',                                         // zh-CN
    '評論', '回覆', '留言',                                         // zh-TW
    'コメント', '返信', 'フィードバック',                            // ja
    '댓글', '답글', '의견',                                         // ko
    'टिप्पणी', 'जवाब', 'उत्तर',                                    // hi
    'nhận xét', 'bình luận', 'trả lời', 'phản hồi',                // vi
    'yorum', 'yanıt', 'cevap', 'geri bildirim',                    // tr
    'komentar', 'balas', 'tanggapan',                              // id, ms
    'ความคิดเห็น', 'ตอบกลับ',                                      // th
    'maoni', 'jibu',                                               // sw
    'puna', 'sagot', 'tugon'                                       // fil
  ];

  // How the Classroom UI says "private" — the positive signal the gate needs.
  const PRIVATE_WORDS = [
    'private', 'privé', 'privado', 'privada', 'privat', 'privato',
    // pt-BR says "Comentário particular", not "privado" — the one locale checked
    // against real Classroom strings that the "priv-" stems miss entirely. Under
    // the fail-closed rule that is not a cosmetic miss: it removes the button.
    'particular',
    'prywatn', 'приват', 'личн', 'خاص', 'פרטי',
    '私人', '私密', '不公開', '비공개', '비밀',
    '限定', '非公開', 'プライベート',
    'निजी', 'व्यक्तिगत', 'riêng tư', 'özel', 'gizli', 'pribadi',
    'ส่วนตัว', 'binafsi', 'pribado'
  ];

  // How the Classroom UI names the public stream — the exclusion signal.
  //
  // Specific phrases only. Bare words like "stream" or "announcement" would also
  // match incidental text in a Docs comment thread's container and silently kill
  // the button there; an unrecognised Classroom surface is already handled by the
  // fail-closed rule below, which is the stronger guard anyway.
  const CLASS_STREAM_WORDS = [
    'class comment', 'class comments', 'comment to class', 'share with your class',
    'comentario de la clase', 'comentarios de la clase', 'comentario para la clase',
    'comentário da turma', 'comentários da turma', 'comentar para a turma',
    'commentaire de classe', 'commentaires de classe', 'commentaire pour la classe',
    'kurskommentar', 'kurskommentare', 'kommentar für den kurs', 'kommentare für den kurs',
    'commento del corso', 'commenti del corso', 'commento della classe',
    'reactie voor de klas', 'klasreactie', 'opmerking voor de klas',
    'komentarz dla klasy', 'komentarze klasy',
    'комментарий для класса', 'комментарии класса', 'комментарий классу',
    'коментар для класу', 'коментарі класу',
    'تعليق الصف', 'تعليقات الصف', 'تعليق على الصف',
    'הערת כיתה', 'תגובת כיתה',
    '班级评论', '课堂评论', '班级留言', '課堂留言', '班級留言', '課程留言',
    'クラスのコメント', 'クラスへのコメント', 'クラスコメント',
    '수업 댓글', '클래스 댓글', '수업 코멘트',
    'कक्षा टिप्पणी', 'कक्षा की टिप्पणी',
    'nhận xét lớp học', 'bình luận lớp học', 'nhận xét cho lớp',
    'sınıf yorumu', 'sınıf yorumları',
    'komentar kelas', 'komen kelas',
    'ความคิดเห็นในชั้นเรียน', 'ความคิดเห็นของชั้นเรียน',
    'maoni ya darasa',
    'puna ng klase', 'komento sa klase'
  ];

  function matchesAny(haystack, words) {
    if (!haystack) return false;
    return words.some((word) => haystack.includes(word));
  }

  function looksLikeCommentField(el) {
    // Docs & Slides comment widgets have lived under docos-* containers across
    // every redesign so far
    if (el.closest('[class*="docos-"]')) return true;

    // Slides speaker notes
    if (el.closest('.punch-speakernotes-scrollpane, .punch-speakernotes-text, div[aria-label*="speaker notes" i]')) return true;

    // Fall back to what the field calls itself, in any of the locales above
    return matchesAny(describedText(el), COMMENT_WORDS);
  }

  // Is this Classroom surface positively, identifiably private?
  //
  // Classroom is the one host where guessing wrong publishes a student's voice to
  // their whole class, so the answer must be YES before anything is injected —
  // an unrecognised surface returns false and gets no button. Everywhere else
  // (Docs, Slides) the question does not arise and this is not consulted.
  //
  // >> This is the single place a structural discriminator belongs. When real
  // >> Classroom markup is captured, add the container attribute / jscontroller
  // >> check here as the FIRST test and leave the word match as a fallback.
  function isPrivateClassroomSurface(el) {
    // Structural, locale-independent, and therefore preferred
    if (el.closest('[data-is-private="true"]')) return true;

    // Otherwise the surface has to name itself private, in a locale we know
    let node = el;
    for (let depth = 0; node && depth < 6; depth++) {
      if (matchesAny(describedText(node), PRIVATE_WORDS)) return true;
      node = node.parentElement;
    }
    return false;
  }

  // Public Class comments and stream announcements are excluded for student
  // privacy and emotional safety. Checked on every path, so no detection change
  // can quietly let one through.
  //
  // On Classroom this is a two-sided gate: the stream is excluded AND the surface
  // must prove it is private. On Docs and Slides only the exclusion applies, so
  // comment boxes there are unaffected.
  function isPublicClassStream(el) {
    const row = el.closest('form, div[jscontroller], div[role="region"]') || el.parentElement;
    if (row) {
      const label = (row.getAttribute('aria-label') || '').toLowerCase();
      const text = (row.textContent || '').toLowerCase();
      if (matchesAny(label, CLASS_STREAM_WORDS) || matchesAny(text, CLASS_STREAM_WORDS)) return true;
    }

    // Fail closed, on Classroom only. Docs and Slides have no class stream, and
    // applying this there would hide the button on ordinary comment boxes.
    if (IS_CLASSROOM && !isPrivateClassroomSurface(el)) return true;

    return false;
  }

  function collectInboxTargets() {
    const targets = [];
    const seen = new Set();

    const add = (el) => {
      if (!el || seen.has(el) || !isSafeInputTarget(el)) return;
      if (isPublicClassStream(el)) return;
      seen.add(el);
      targets.push(el);
    };

    // Docs & Slides comment boxes, reply boxes, and speaker notes
    document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]').forEach((el) => {
      if (el.closest(CANVAS_SELECTOR)) return;                  // never the document surface itself
      if (el.closest(VOICEBRIDGE_UI_SELECTOR)) return;           // never our own UI
      if (!looksLikeCommentField(el)) return;
      add(el);
    });

    // Google Classroom private comments
    document.querySelectorAll('div[aria-label*="private" i], div[data-is-private="true"], aside div[role="textbox"]').forEach((area) => {
      add(area.querySelector?.('textarea, [contenteditable="true"], input') || area);
    });

    return targets;
  }

  // Which Google account is this page running as?
  //
  // chrome.identity.getAuthToken always returns a token for the Chrome PROFILE's
  // primary account. A Doc opened from a second signed-in account runs under
  // /u/1/, so the upload lands in the wrong Drive, sharing is applied in the wrong
  // domain, and the recorder cannot find their own file. To the user it looks
  // exactly like data loss, and teachers and students routinely have a personal
  // and a school account signed in at once.
  //
  // Best effort by design: a null email simply means "cannot compare", and the
  // upload proceeds as before. Only a positive mismatch blocks anything.
  function detectPageAccount() {
    const indexMatch = location.pathname.match(/\/u\/(\d+)\//);
    const index = indexMatch ? Number(indexMatch[1]) : null;
    const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

    // Read the address out of whatever labels the account switcher. Structural and
    // attribute-based on purpose — Google's class names here have changed before.
    const probes = [
      'a[href*="SignOutOptions"]',
      'a[aria-label*="Google Account"]',
      '[role="banner"] [aria-label*="@"]',
      'header [aria-label*="@"]',
      '[aria-label*="@"]'
    ];
    for (const selector of probes) {
      for (const el of document.querySelectorAll(selector)) {
        const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`;
        const match = label.match(EMAIL_RE);
        if (match) return { index, email: match[0] };
      }
    }
    return { index, email: null };
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
              <span class="vb-mic-name"></span>
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

      const micNameEl = body.querySelector('.vb-mic-name');
      if (micNameEl) micNameEl.textContent = userSettings.selectedAudioDeviceLabel || 'Default Microphone';

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
              <span class="vb-mic-name"></span>
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

      const micNameEl = body.querySelector('.vb-mic-name');
      if (micNameEl) micNameEl.textContent = userSettings.selectedAudioDeviceLabel || 'Default Microphone';

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
          🎙️ Mic: <strong class="vb-mic-name-label"></strong>
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

      const micLabelEl = body.querySelector('.vb-mic-name-label');
      if (micLabelEl) micLabelEl.textContent = userSettings.selectedAudioDeviceLabel || 'Default Microphone';

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
      const remaining = MAX_RECORDING_SECONDS - secondsElapsed;
      const timerEl = activeModal?.querySelector('#vb-live-timer');
      if (timerEl) {
        if (remaining <= COUNTDOWN_FROM_SECONDS) {
          timerEl.textContent = `-${formatClock(Math.max(0, remaining))}`;
          timerEl.classList.add('vb-timer-ending');
          timerEl.setAttribute('aria-label', `${Math.max(0, remaining)} seconds left`);
        } else {
          const mins = Math.floor(secondsElapsed / 60).toString().padStart(2, '0');
          const secs = (secondsElapsed % 60).toString().padStart(2, '0');
          timerEl.textContent = `${mins}:${secs}`;
        }
      }

      // Same cap as the in-box recorder — stop and keep the audio
      if (secondsElapsed >= MAX_RECORDING_SECONDS) {
        showToastNotification(
          `⏱️ Recording reached the ${Math.round(MAX_RECORDING_SECONDS / 60)}-minute limit and was saved automatically.`,
          8000
        );
        stopRecording();
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

    // Same floor as the in-box recorder: nothing was said, so there is nothing
    // worth uploading
    if (secondsElapsed < MIN_RECORDING_SECONDS) {
      showToastNotification('🎙️ That recording was too short to save. Hold on a moment and try again.', 5000);
      if (timerInterval) clearInterval(timerInterval);
      chrome.runtime.sendMessage({ action: 'CANCEL_RECORDING' });
      recordingState = 'READY';
      renderCurrentState();
      return;
    }

    recordingState = 'STOPPING';
    renderCurrentState();
    if (timerInterval) clearInterval(timerInterval);

    sendMessageWithTimeout({ action: 'STOP_RECORDING' }, STOP_TIMEOUT_MS, (res) => {
      if (res && res.timedOut) {
        showToastNotification('⚠️ ' + res.error + ' Your recording was not saved — please try again.', 8000);
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

    sendMessageWithTimeout({
      action: 'UPLOAD_TO_DRIVE',
      payload: {
        audioBase64: recordedAudioBase64,
        durationSeconds: recordedDuration,
        pageAccount: detectPageAccount()
      }
    }, UPLOAD_TIMEOUT_MS, (res) => {
      if (res && res.success) {
        const data = res.data;
        // Capture the audio before closeModal() clears the recording state
        const savedAudioBase64 = recordedAudioBase64;
        const savedDuration = recordedDuration;

        insertLinkIntoComment(data.formattedChipText || data.webViewLink).then((insertedIntoBox) => {
          // A comment box already holds the note and will persist it in the margin
          // once posted. The floating bubble is only for flows with nowhere to insert.
          if (insertedIntoBox) return;
          showVoiceCommentBubble({
            fileId: data.fileId,
            audioBase64: savedAudioBase64,
            durationText: data.duration,
            durationSeconds: data.durationSeconds || savedDuration
          });
        });
        closeModal();
      } else if (res?.data?.reason === 'account_mismatch') {
        showToastNotification(accountMismatchMessage(res.data), 12000);
        recordingState = 'REVIEW';
        renderCurrentState();
      } else {
        showToastNotification('⚠️ Could not complete upload: ' + (res?.error || 'Authentication error'));
        recordingState = 'REVIEW';
        renderCurrentState();
      }
    });
  }

  // Defined once in player.js, which loads first (see manifest content_scripts)
  const CANVAS_SELECTOR = window.VoiceBridgePlayer.CANVAS_SELECTOR;

  const VOICEBRIDGE_UI_SELECTOR =
    '#voicebridge-modal-overlay, #voicebridge-voice-bubble, .vb-inbox-recorder, .voicebridge-inline-player';

  // Writes text into a comment box. Returns true only if it actually landed.
  function writeTextIntoInput(target, textToInsert) {
    if (!target || !isSafeInputTarget(target)) return false;
    try {
      if (target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && target.type === 'text')) {
        const start = target.selectionStart ?? target.value.length;
        const end = target.selectionEnd ?? target.value.length;
        target.value = target.value.substring(0, start) + textToInsert + '\n' + target.value.substring(end);
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      if (target.isContentEditable) {
        target.focus();
        document.execCommand('insertText', false, textToInsert + '\n');
        return true;
      }
    } catch (err) {
      console.warn('[VoiceBridge] Direct comment insert bypassed for safety:', err);
    }
    return false;
  }

  function isSafeInputTarget(target) {
    if (!target || target === document.body || target === document.documentElement) return false;
    
    // Explicitly reject Google Docs (Kix) & Google Slides (Punch) graphical canvas elements that crash on programmatic DOM mutation
    if (target.closest?.(CANVAS_SELECTOR)) {
      return false;
    }
    if (target.classList?.contains('docs-texteventtarget-iframe') || target.classList?.contains('punch-texteventtarget-iframe') || target.id?.includes('docs-texteventtarget')) {
      return false;
    }

    // Google Slides Speaker Notes
    if (target.classList?.contains('punch-speakernotes-text') || target.closest?.('.punch-speakernotes-text, .punch-speakernotes-scrollpane, div[aria-label*="speaker notes" i]')) {
      return true;
    }

    // Google Docs & Slides comment widgets, whatever this month's classes are
    // (the canvas rejection above has already run)
    if (target.closest?.('[class*="docos-"]')) {
      return true;
    }

    // Comment and reply fields that identify themselves by label
    if ((target.isContentEditable || target.tagName === 'TEXTAREA') && looksLikeCommentField(target)) {
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

    // Prefer whatever the student is typing in, then the first comment box on the page
    let target = isSafeInputTarget(document.activeElement) ? document.activeElement : null;
    if (!target) {
      target = document.querySelector('div[data-is-private="true"] textarea, div[aria-label*="private" i] textarea, .docos-input-textarea, textarea');
    }

    const directlyInserted = writeTextIntoInput(target, textToInsert);

    if (typeof window.__voicebridgeScanAndRenderPlayers === 'function') {
      setTimeout(() => window.__voicebridgeScanAndRenderPlayers(), 50);
    }

    if (directlyInserted) {
      showToastNotification('✅ Voice note inserted into comment!');
    } else if (copiedToClipboard) {
      showToastNotification('🎙️ Voice note saved & copied to clipboard! Press Cmd+V (Paste) to insert.');
    } else {
      showToastNotification('🎙️ Voice note created! Link: ' + textToInsert);
    }

    return directlyInserted;
  }

  /**
   * Closes the floating voice comment bubble and releases its object URL.
   */
  function dismissVoiceCommentBubble() {
    if (!activeVoiceBubble) return;
    const bubble = activeVoiceBubble;
    activeVoiceBubble = null;

    document.removeEventListener('keydown', bubble.onKeydown, true);
    document.removeEventListener('mousedown', bubble.onOutsideClick, true);
    window.removeEventListener('resize', bubble.onReposition, true);
    window.removeEventListener('scroll', bubble.onReposition, true);

    try {
      bubble.card?.__voicebridgeControls?.destroy?.();
    } catch (e) {}
    bubble.el.remove();
    if (bubble.blobUrl) URL.revokeObjectURL(bubble.blobUrl);
  }

  /**
   * Opens a Google Docs-style comment bubble containing the voice note, anchored to
   * whatever launched the recording. Plays the locally recorded audio directly, so
   * students never wait on a Drive round-trip and never leave the page.
   */
  function showVoiceCommentBubble(opts) {
    const options = opts || {};
    if (typeof window.VoiceBridgePlayer?.createPlayerCard !== 'function') {
      showToastNotification('🎙️ Voice note saved to Google Drive and inserted!');
      return;
    }

    dismissVoiceCommentBubble();

    const blobUrl = options.audioBase64 ? base64ToBlobUrl(options.audioBase64) : null;
    // The bubble only appears for flows with no comment box, which always start
    // from the floating Record button — so that is what it points at.
    const anchorEl = options.anchorEl || document.getElementById('vb-open-modal-btn');

    const wrapper = document.createElement('div');
    wrapper.id = 'voicebridge-voice-bubble';

    const card = window.VoiceBridgePlayer.createPlayerCard({
      fileId: options.fileId,
      localSrc: blobUrl,
      durationText: options.durationText,
      durationSeconds: options.durationSeconds,
      title: 'Your Voice Note',
      subtitle: 'Added to this comment',
      bubble: true,
      onDismiss: dismissVoiceCommentBubble
    });

    wrapper.appendChild(card);
    document.body.appendChild(wrapper);
    // Same host-surface check the inline cards get (see player.js)
    window.VoiceBridgePlayer.applySurfaceTheme(card);

    function reposition() {
      const bw = wrapper.offsetWidth;
      const bh = wrapper.offsetHeight;
      const gap = 14;

      const vp = viewportSize();
      const rect = visibleRectOf(anchorEl, 1, 1);

      let left;
      let top;
      let anchorCenterX;
      let tailOnTop = false;

      if (rect) {
        anchorCenterX = rect.left + rect.width / 2;
        left = anchorCenterX - bw / 2;
        top = rect.top - bh - gap;
        if (top < 8) {
          top = rect.bottom + gap;
          tailOnTop = true;
        }
      } else {
        // No usable anchor — park it above the floating Record button
        left = vp.w - bw - 24;
        top = vp.h - bh - 96;
        anchorCenterX = vp.w - 60;
      }

      left = Math.max(8, vp.w ? Math.min(left, vp.w - bw - 8) : left);
      top = Math.max(8, vp.h ? Math.min(top, vp.h - bh - 8) : top);

      wrapper.style.left = `${Math.round(left)}px`;
      wrapper.style.top = `${Math.round(top)}px`;

      const tailX = Math.max(14, Math.min(anchorCenterX - left - 10, bw - 34));
      card.style.setProperty('--vb-tail-x', `${Math.round(tailX)}px`);
      card.classList.toggle('vb-tail-top', tailOnTop);
    }

    function onKeydown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        dismissVoiceCommentBubble();
      }
    }

    function onOutsideClick(e) {
      if (!wrapper.contains(e.target)) dismissVoiceCommentBubble();
    }

    activeVoiceBubble = {
      el: wrapper,
      card: card,
      blobUrl: blobUrl,
      onKeydown: onKeydown,
      onOutsideClick: onOutsideClick,
      onReposition: reposition
    };

    reposition();
    document.addEventListener('keydown', onKeydown, true);
    window.addEventListener('resize', reposition, true);
    window.addEventListener('scroll', reposition, true);
    // Defer the outside-click listener so the click that opened the bubble doesn't close it
    setTimeout(() => {
      if (activeVoiceBubble && activeVoiceBubble.el === wrapper) {
        document.addEventListener('mousedown', onOutsideClick, true);
      }
    }, 0);

    // Send focus to Play so keyboard and screen-reader users land on the control that matters
    card.__voicebridgeControls?.focusPlay?.();
  }

  // ---------------------------------------------------------------------------
  // In-box recorder
  // A VoiceBridge button sits inside each comment box. Recording happens in place
  // and drops the Drive link straight into the box, so the student just presses
  // Comment/Post — and the note persists as a real Google Docs comment in the
  // margin, visible to the teacher and to anyone without the extension.
  // ---------------------------------------------------------------------------

  const inboxButtons = new Map(); // input element -> its floating mic button
  let inboxRecorder = null;       // { input, overlay, seconds, timerId }

  // innerWidth/innerHeight can read 0 in embedded and offscreen contexts, so fall
  // back to the document element and treat 0 as "viewport unknown" rather than
  // culling everything as off-screen.
  function viewportSize() {
    return {
      w: window.innerWidth || document.documentElement?.clientWidth || 0,
      h: window.innerHeight || document.documentElement?.clientHeight || 0
    };
  }

  function visibleRectOf(el, minWidth = 40, minHeight = 12) {
    if (!el || !el.isConnected || typeof el.getBoundingClientRect !== 'function') return null;
    const r = el.getBoundingClientRect();
    if (r.width < minWidth || r.height < minHeight) return null;
    const vh = viewportSize().h;
    if (vh && (r.bottom < 0 || r.top > vh)) return null;
    return r;
  }

  function syncInboxButtons() {
    const live = new Set(collectInboxTargets());

    // Drop buttons whose comment box is gone
    inboxButtons.forEach((btn, input) => {
      if (!live.has(input) || !input.isConnected) {
        btn.remove();
        inboxButtons.delete(input);
      }
    });

    live.forEach((input) => {
      if (inboxButtons.has(input)) return;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vb-injected-mic-btn';
      btn.title = 'Record a voice note (VoiceBridge)';
      btn.setAttribute('aria-label', 'Record a voice note');
      btn.innerHTML = '🎙️';

      // Never take focus — Google Docs closes its comment box on blur
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        startInboxRecording(input);
      });

      document.body.appendChild(btn);
      inboxButtons.set(input, btn);
    });

    positionInboxUI();
  }

  function positionInboxUI() {
    inboxButtons.forEach((btn, input) => {
      const r = visibleRectOf(input);
      const busy = inboxRecorder && inboxRecorder.input === input;
      if (!r || busy) {
        btn.style.display = 'none';
        return;
      }
      const size = 28;
      // Tall multi-line boxes get the button in the bottom corner; single-line boxes centre it
      const top = r.height > 60 ? r.bottom - size - 8 : r.top + (r.height - size) / 2;
      btn.style.display = 'flex';
      btn.style.left = `${Math.round(r.right - size - 8)}px`;
      btn.style.top = `${Math.round(top)}px`;
    });

    if (inboxRecorder) {
      if (!inboxRecorder.input.isConnected) {
        cancelInboxRecording();
        return;
      }
      const r = visibleRectOf(inboxRecorder.input);
      const o = inboxRecorder.overlay;
      if (!r) {
        o.style.display = 'none';
        return;
      }
      o.style.display = 'flex';
      o.style.left = `${Math.round(r.left)}px`;
      o.style.top = `${Math.round(r.top)}px`;
      o.style.width = `${Math.round(r.width)}px`;
      o.style.height = `${Math.round(Math.max(r.height, 36))}px`;
    }
  }

  function setInboxStatus(html) {
    if (!inboxRecorder) return;
    inboxRecorder.overlay.innerHTML = html;
  }

  function teardownInboxRecorder() {
    if (!inboxRecorder) return;
    if (inboxRecorder.timerId) clearInterval(inboxRecorder.timerId);
    inboxRecorder.overlay.remove();
    inboxRecorder = null;
    recordingState = 'IDLE';
    positionInboxUI();
  }

  function startInboxRecording(input) {
    if (inboxRecorder || activeModal || recordingState !== 'IDLE') return;

    const overlay = document.createElement('div');
    overlay.className = 'vb-inbox-recorder';
    overlay.setAttribute('role', 'group');
    overlay.setAttribute('aria-label', 'Voice note recorder');
    overlay.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.appendChild(overlay);

    inboxRecorder = { input, overlay, seconds: 0, timerId: null };
    recordingState = 'STARTING';
    setInboxStatus('<span class="vb-inbox-status">Starting microphone…</span>');
    positionInboxUI();

    chrome.runtime.sendMessage({
      action: 'START_RECORDING',
      payload: {
        deviceId: userSettings.selectedAudioDeviceId,
        deviceLabel: userSettings.selectedAudioDeviceLabel
      }
    }, (res) => {
      if (!inboxRecorder) return;

      if (chrome.runtime.lastError || !res || !res.success) {
        const err = chrome.runtime.lastError?.message || res?.error || '';
        if (res?.permissionRequired || err.includes('NotAllowedError') || err.includes('Permission')) {
          showToastNotification('🎙️ Microphone setup opened in a new tab. Click "Allow" once to enable recording.');
        } else {
          showToastNotification('⚠️ Could not start recording: ' + (err || 'Please check mic settings.'));
        }
        teardownInboxRecorder();
        return;
      }

      recordingState = 'RECORDING';
      renderInboxRecordingControls();
    });
  }

  function renderInboxRecordingControls() {
    if (!inboxRecorder) return;

    setInboxStatus(`
      <button type="button" class="vb-inbox-btn vb-inbox-cancel" title="Cancel" aria-label="Cancel recording">✕</button>
      <span class="vb-inbox-dot" aria-hidden="true"></span>
      <span class="vb-inbox-level" aria-hidden="true">${Array.from({ length: 14 }).map(() => '<i></i>').join('')}</span>
      <span class="vb-inbox-timer">0:00</span>
      <button type="button" class="vb-inbox-btn vb-inbox-done" title="Done" aria-label="Finish recording and insert voice note">✓</button>
    `);

    const overlay = inboxRecorder.overlay;
    overlay.querySelector('.vb-inbox-cancel').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      cancelInboxRecording();
    });
    overlay.querySelector('.vb-inbox-done').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      finishInboxRecording();
    });
    overlay.querySelector('.vb-inbox-done').focus();

    inboxRecorder.timerId = setInterval(() => {
      if (!inboxRecorder) return;
      inboxRecorder.seconds++;

      const remaining = MAX_RECORDING_SECONDS - inboxRecorder.seconds;
      const el = inboxRecorder.overlay.querySelector('.vb-inbox-timer');
      if (el) {
        // Count up normally, then switch to time remaining so the cut-off is
        // never a surprise
        if (remaining <= COUNTDOWN_FROM_SECONDS) {
          el.textContent = `-${formatClock(Math.max(0, remaining))}`;
          el.classList.add('vb-inbox-timer-ending');
          el.setAttribute('aria-label', `${Math.max(0, remaining)} seconds left`);
        } else {
          el.textContent = formatClock(inboxRecorder.seconds);
        }
      }

      // Auto-stop at the cap, keeping what was said rather than discarding it
      if (inboxRecorder.seconds >= MAX_RECORDING_SECONDS) {
        showToastNotification(
          `⏱️ Recording reached the ${Math.round(MAX_RECORDING_SECONDS / 60)}-minute limit and was saved automatically.`,
          8000
        );
        finishInboxRecording();
      }
    }, 1000);
  }

  function cancelInboxRecording() {
    if (!inboxRecorder) return;
    if (recordingState === 'RECORDING' || recordingState === 'STARTING') {
      chrome.runtime.sendMessage({ action: 'CANCEL_RECORDING' });
    }
    teardownInboxRecorder();
  }

  function finishInboxRecording() {
    if (!inboxRecorder || recordingState !== 'RECORDING') return;

    // Mic then immediately ✓ used to upload a near-empty file labelled 0:00 —
    // a posted voice note that plays silence. Discard it and say why.
    if (inboxRecorder.seconds < MIN_RECORDING_SECONDS) {
      showToastNotification('🎙️ That recording was too short to save. Hold on a moment and try again.', 5000);
      cancelInboxRecording();
      return;
    }

    const input = inboxRecorder.input;
    recordingState = 'STOPPING';
    if (inboxRecorder.timerId) clearInterval(inboxRecorder.timerId);
    inboxRecorder.timerId = null;
    setInboxStatus('<span class="vb-inbox-status">Finishing recording…</span>');

    sendMessageWithTimeout({ action: 'STOP_RECORDING' }, STOP_TIMEOUT_MS, (res) => {
      if (!inboxRecorder) return;

      if (!res || !res.success) {
        showToastNotification('⚠️ Recording failed: ' + (res?.error || 'Unknown error'));
        teardownInboxRecorder();
        return;
      }

      recordingState = 'UPLOADING';
      setInboxStatus('<span class="vb-inbox-status">☁️ Saving to your Google Drive…</span>');

      sendMessageWithTimeout({
        action: 'UPLOAD_TO_DRIVE',
        payload: {
          audioBase64: res.audioBase64,
          durationSeconds: res.durationSeconds || 0,
          pageAccount: detectPageAccount()
        }
      }, UPLOAD_TIMEOUT_MS, (up) => {
        if (up && up.success) {
          const text = up.data.formattedChipText || up.data.webViewLink;
          teardownInboxRecorder();
          if (writeTextIntoInput(input, text)) {
            showToastNotification('✅ Voice note added — press Comment to post it.');
          } else {
            // The box rejected the write; fall back to the clipboard so nothing is lost
            navigator.clipboard.writeText(text).then(
              () => showToastNotification('🎙️ Voice note saved & copied. Press Cmd+V to paste it in.'),
              () => showToastNotification('🎙️ Voice note saved! Link: ' + text)
            );
          }
          if (typeof window.__voicebridgeScanAndRenderPlayers === 'function') {
            setTimeout(() => window.__voicebridgeScanAndRenderPlayers(), 50);
          }
        } else if (up?.data?.reason === 'account_mismatch') {
          showToastNotification(accountMismatchMessage(up.data), 12000);
          teardownInboxRecorder();
        } else {
          showToastNotification('⚠️ Could not complete upload: ' + (up?.error || 'Authentication error'));
          teardownInboxRecorder();
        }
      });
    });
  }

  // Names both accounts. "Upload failed" would send the user hunting through Drive
  // for a file that was never going to be there.
  function accountMismatchMessage(data) {
    return `⚠️ Wrong Google account. This page is open as ${data.pageEmail}, but VoiceBridge saves to ${data.tokenEmail}. ` +
      `Nothing was uploaded. Open the document as ${data.tokenEmail}, or make ${data.pageEmail} the account Chrome is signed in with, then record again.`;
  }

  function showToastNotification(message, durationMs) {
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
      max-width: 380px;
      line-height: 1.5;
      font-family: var(--vb-font-family);
      font-size: 14px;
      font-weight: 500;
      animation: vbFadeIn 0.2s ease-out;
    `;
    toast.textContent = message;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), durationMs || 4000);
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
      const level = msg.level || 0;

      const bars = activeModal?.querySelectorAll('.vb-wave-bar');
      if (bars) {
        bars.forEach((bar, idx) => {
          const height = Math.max(6, Math.min(65, level * 70 + Math.sin(idx + Date.now() / 100) * 15));
          bar.style.height = `${height}px`;
        });
      }

      const inboxBars = inboxRecorder?.overlay.querySelectorAll('.vb-inbox-level i');
      if (inboxBars?.length) {
        inboxBars.forEach((bar, idx) => {
          const height = Math.max(3, Math.min(16, level * 20 + Math.sin(idx + Date.now() / 120) * 4));
          bar.style.height = `${height}px`;
        });
      }
    }

      if (msg.action === 'SILENCE_WARNING_TRIGGERED' && recordingState === 'RECORDING' && userSettings.silenceWarning) {
        if (inboxRecorder) {
          inboxRecorder.overlay.classList.add('vb-inbox-silent');
          inboxRecorder.overlay.title = "We didn't hear any sound — is your microphone muted?";
        }
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

    // Esc closes the voice comment bubble
    if (e.key === 'Escape' && activeVoiceBubble) {
      dismissVoiceCommentBubble();
      return;
    }

    // Esc cancels an in-box recording
    if (e.key === 'Escape' && inboxRecorder) {
      cancelInboxRecording();
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
  syncInboxButtons();

  let injectDebounceTimer = null;
  const domObserver = new MutationObserver((mutations) => {
    // Ignore churn caused by VoiceBridge's own in-box UI
    for (const m of mutations) {
      if (m.target?.closest?.('.vb-injected-mic-btn, .vb-inbox-recorder, #voicebridge-modal-overlay, #voicebridge-voice-bubble')) continue;
      if (injectDebounceTimer) clearTimeout(injectDebounceTimer);
      injectDebounceTimer = setTimeout(syncInboxButtons, 200);
      return;
    }
  });
  domObserver.observe(document.body, { childList: true, subtree: true });

  // Comment boxes move as the page scrolls and as Docs reflows its sidebar
  window.addEventListener('scroll', positionInboxUI, true);
  window.addEventListener('resize', positionInboxUI, true);
  // Re-scan as well as reposition — Docs can open a comment box without a
  // mutation we recognise
  // Skipped while the tab is hidden — see the same reasoning in player.js. A
  // hidden tab has no comment box to decorate, and the mic buttons are
  // repositioned on the way back in.
  setInterval(() => {
    if (document.hidden) return;
    syncInboxButtons();
  }, 400);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncInboxButtons();
  });
})();
