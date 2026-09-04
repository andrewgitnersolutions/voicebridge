/**
 * VoiceBridge — Popup Controller
 * Manages UDL accessibility preferences, live mic level testing, and settings persistence.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const fontSelect = document.getElementById('select-font');
  const themeSelect = document.getElementById('select-theme');
  const shortcutsToggle = document.getElementById('toggle-shortcuts');
  const silenceToggle = document.getElementById('toggle-silence');
  const autostartToggle = document.getElementById('toggle-autostart');
  const micSelect = document.getElementById('select-mic');
  const btnQuickRecord = document.getElementById('btn-quick-record');
  const quickRecordHint = document.getElementById('quick-record-hint');
  const btnTestMic = document.getElementById('btn-test-mic');
  const micMeterFill = document.getElementById('mic-meter-fill');
  const micStatus = document.getElementById('mic-test-status');

  // Load existing settings
  const settings = await chrome.storage.local.get([
    'fontFamily',
    'theme',
    'singleKeyShortcuts',
    'silenceWarning',
    'autoStartRecording',
    'selectedAudioDeviceId',
    'selectedAudioDeviceLabel'
  ]);

  if (settings.fontFamily) fontSelect.value = settings.fontFamily;
  if (settings.theme) themeSelect.value = settings.theme;
  shortcutsToggle.checked = settings.singleKeyShortcuts ?? true;
  silenceToggle.checked = settings.silenceWarning ?? true;
  if (autostartToggle) autostartToggle.checked = settings.autoStartRecording ?? false;

  // Proactively check if hardware labels are visible, prompting getUserMedia if needed
  async function ensureMicrophoneAccess() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput');
      const hasLabels = audioInputs.some(d => d.label && d.label.trim() !== '');

      if (!hasLabels && navigator.mediaDevices.getUserMedia) {
        try {
          const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          tempStream.getTracks().forEach(t => t.stop());
        } catch (e) {
          console.warn('[VoiceBridge] Device label permission prompt note:', e);
        }
      }
    } catch (e) {
      console.warn('[VoiceBridge] Device access check error:', e);
    }
  }

  // Enumerate and populate available microphone input devices
  async function populateMicrophones() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return;
    }

    try {
      await ensureMicrophoneAccess();
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput');

      const stored = await chrome.storage.local.get(['selectedAudioDeviceId', 'selectedAudioDeviceLabel']);
      const currentSavedId = stored.selectedAudioDeviceId || 'default';
      const currentSavedLabel = stored.selectedAudioDeviceLabel || 'Default Microphone';

      micSelect.innerHTML = '';

      // Always include Default Microphone option
      const defaultOption = document.createElement('option');
      defaultOption.value = 'default';
      defaultOption.textContent = 'Default Microphone';
      micSelect.appendChild(defaultOption);

      let matchedIndex = -1;
      const seenIds = new Set(['default']);
      let genericIndex = 1;

      audioInputs.forEach((device) => {
        if (!device.deviceId || seenIds.has(device.deviceId)) return;
        seenIds.add(device.deviceId);

        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Microphone ${genericIndex++}`;

        // Match by exact deviceId first, or by label if deviceId changed across browser restarts
        if (device.deviceId === currentSavedId || (currentSavedLabel !== 'Default Microphone' && device.label && device.label === currentSavedLabel)) {
          option.selected = true;
          matchedIndex = micSelect.options.length - 1;
        }

        micSelect.appendChild(option);
      });

      if (matchedIndex !== -1) {
        micSelect.selectedIndex = matchedIndex;
        const currentOption = micSelect.options[matchedIndex];
        if (currentOption.value !== currentSavedId || currentOption.textContent !== currentSavedLabel) {
          await chrome.storage.local.set({
            selectedAudioDeviceId: currentOption.value,
            selectedAudioDeviceLabel: currentOption.textContent
          });
        }
      } else if (currentSavedId !== 'default') {
        // Previously selected microphone is currently disconnected; safely fall back to default
        micSelect.value = 'default';
        await chrome.storage.local.set({
          selectedAudioDeviceId: 'default',
          selectedAudioDeviceLabel: 'Default Microphone'
        });
      } else {
        micSelect.value = 'default';
      }
    } catch (err) {
      console.warn('[VoiceBridge] Failed to enumerate audio devices:', err);
    }
  }

  await populateMicrophones();

  // Listen for hardware connection/disconnection changes (e.g. plugging in USB mic or AirPods)
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', populateMicrophones);
  }

  // Save selected microphone on change
  micSelect.addEventListener('change', async () => {
    const selectedOption = micSelect.options[micSelect.selectedIndex];
    const chosenMicId = selectedOption ? selectedOption.value : 'default';
    const chosenLabel = selectedOption ? selectedOption.textContent : 'Default Microphone';

    await chrome.storage.local.set({
      selectedAudioDeviceId: chosenMicId,
      selectedAudioDeviceLabel: chosenLabel
    });

    console.log('[VoiceBridge] User switched microphone to:', chosenLabel, 'ID:', chosenMicId);

    if (isTestingMic) {
      // Reconnect test stream with newly selected microphone
      stopMicTest();
      startMicTest();
    }
  });

  // Save on change
  fontSelect.addEventListener('change', async () => {
    await chrome.storage.local.set({ fontFamily: fontSelect.value });
  });

  themeSelect.addEventListener('change', async () => {
    await chrome.storage.local.set({ theme: themeSelect.value });
  });

  shortcutsToggle.addEventListener('change', async () => {
    await chrome.storage.local.set({ singleKeyShortcuts: shortcutsToggle.checked });
  });

  silenceToggle.addEventListener('change', async () => {
    await chrome.storage.local.set({ silenceWarning: silenceToggle.checked });
  });

  if (autostartToggle) {
    autostartToggle.addEventListener('change', async () => {
      await chrome.storage.local.set({ autoStartRecording: autostartToggle.checked });
    });
  }

  // Where VoiceBridge can actually record. Named once so the message below and
  // the manifest's content_scripts cannot drift apart in wording.
  const SUPPORTED_SURFACES = 'a Google Doc, Google Slides, or Google Classroom page';

  // Quick Record used to open test-classroom-simulation.html whenever it could not
  // reach the page — a developer test fixture that is not in the shipped package,
  // so in a real install every one of those paths opened a blank 404 tab. Tell the
  // user where recording works instead, and leave the popup open so they can read it.
  function showQuickRecordHint(text) {
    if (!quickRecordHint) return;
    quickRecordHint.textContent = text;
    quickRecordHint.hidden = false;
    btnQuickRecord.disabled = false;
  }

  // Quick Record Button: Trigger on active tab, or explain why it cannot
  btnQuickRecord.addEventListener('click', async () => {
    btnQuickRecord.disabled = true;
    if (quickRecordHint) quickRecordHint.hidden = true;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      const isUnscriptableUrl = !tab || !tab.url || 
        tab.url.startsWith('chrome://') || 
        tab.url.startsWith('chrome-extension://') || 
        tab.url.startsWith('edge://') || 
        tab.url.startsWith('about:') || 
        tab.url.startsWith('view-source:');

      if (isUnscriptableUrl) {
        // Browser-internal pages (chrome://extensions, view-source:, PDFs) cannot
        // take a content script at all — no amount of retrying changes that.
        showQuickRecordHint(`VoiceBridge can't record on this page. Open ${SUPPORTED_SURFACES}, then try again.`);
        return;
      }

      // Try sending message to existing content script first
      chrome.tabs.sendMessage(tab.id, { action: 'TRIGGER_RECORDING' }, async (res) => {
        if (chrome.runtime.lastError || !res || !res.success) {
          // Content script not present yet: dynamically inject via scripting API
          try {
            if (chrome.scripting) {
              await chrome.scripting.insertCSS({
                target: { tabId: tab.id },
                files: ['content/content.css']
              }).catch(() => {});

              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content/player.js', 'content/content.js']
              });

              // Trigger recording in freshly injected content script
              setTimeout(() => {
                chrome.tabs.sendMessage(tab.id, { action: 'TRIGGER_RECORDING' }).catch(() => {});
                window.close();
              }, 120);
            } else {
              showQuickRecordHint(`VoiceBridge can't record on this page. Open ${SUPPORTED_SURFACES}, then try again.`);
            }
          } catch (injectErr) {
            console.warn('[VoiceBridge] Script injection failed:', injectErr);
            showQuickRecordHint(`VoiceBridge can't record on this page. Open ${SUPPORTED_SURFACES}, then try again.`);
          }
        } else {
          window.close();
        }
      });
    } catch (err) {
      console.warn('[VoiceBridge] Trigger recording error:', err);
      showQuickRecordHint(`VoiceBridge couldn't start recording here. Open ${SUPPORTED_SURFACES}, then try again.`);
    }
  });

  // Live Mic Testing
  let testStream = null;
  let testAudioContext = null;
  let isTestingMic = false;
  let micAnimFrame = null;

  async function startMicTest() {
    try {
      micStatus.textContent = 'Listening... Speak into your microphone.';
      btnTestMic.textContent = 'Stop Test';
      isTestingMic = true;

      const chosenMicId = micSelect.value || 'default';
      const audioConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      };

      if (chosenMicId && chosenMicId !== 'default') {
        audioConstraints.deviceId = { exact: chosenMicId };
      }

      try {
        testStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
      } catch (deviceErr) {
        console.warn('[VoiceBridge] Selected mic unavailable, falling back to default:', deviceErr);
        testStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      }

      // After microphone access is granted, refresh device labels in case they were previously hidden
      await populateMicrophones();

      testAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      const src = testAudioContext.createMediaStreamSource(testStream);
      const analyser = testAudioContext.createAnalyser();
      analyser.fftSize = 64;
      src.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);

      function updateMeter() {
        if (!isTestingMic) return;
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        const pct = Math.min(100, Math.round((avg / 128) * 100));
        micMeterFill.style.width = `${pct}%`;

        // Color coding
        if (pct > 80) micMeterFill.style.background = '#ef4444'; // Red peak
        else if (pct > 20) micMeterFill.style.background = '#22c55e'; // Green good
        else micMeterFill.style.background = '#eab308'; // Low yellow

        micAnimFrame = requestAnimationFrame(updateMeter);
      }

      updateMeter();
    } catch (err) {
      micStatus.textContent = 'Mic access blocked: ' + err.message;
      stopMicTest();
    }
  }

  function stopMicTest() {
    isTestingMic = false;
    btnTestMic.textContent = 'Test Mic';
    micMeterFill.style.width = '0%';
    micStatus.textContent = 'Mic test stopped.';
    if (micAnimFrame) cancelAnimationFrame(micAnimFrame);
    if (testStream) {
      testStream.getTracks().forEach(t => t.stop());
      testStream = null;
    }
    if (testAudioContext && testAudioContext.state !== 'closed') {
      testAudioContext.close();
      testAudioContext = null;
    }
  }

  btnTestMic.addEventListener('click', () => {
    if (isTestingMic) {
      stopMicTest();
    } else {
      startMicTest();
    }
  });

  window.addEventListener('unload', () => {
    if (navigator.mediaDevices && navigator.mediaDevices.removeEventListener) {
      navigator.mediaDevices.removeEventListener('devicechange', populateMicrophones);
    }
    stopMicTest();
  });
});
