/**
 * VoiceBridge — Offscreen Audio Capture & DSP Engine
 * Captures microphone stream, processes via real-time Web Audio DSP (high-pass rumble filter,
 * speech clarity peaking EQ, studio dynamics compressor), and compresses via Opus @ 128kbps.
 */

let mediaStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let audioContext = null;
let sourceNode = null;
let highPassFilter = null;
let presenceFilter = null;
let compressorNode = null;
let analyserNode = null;
let destinationNode = null;
let animFrameId = null;
let recordingStartTime = 0;
let consecutiveSilenceFrames = 0;
let consecutiveClippingFrames = 0;
let silenceWarningEmitted = false;
let clippingWarningEmitted = false;
let isStarting = false;
let isStopping = false;
let isAborted = false;
let lastLevelEmitTime = 0;
let lastEmittedLevel = -1;
let maxDurationTimeoutId = null;
let hitMaxDuration = false;

// Hard ceiling on a single recording. Unbounded audio is base64-encoded whole,
// pushed through chrome.runtime.sendMessage in one message, and uploaded as a
// single non-chunked multipart request — the chain gives out long before a
// student notices the mic is still running.
//
// The recording UI enforces the same limit and stops with a warning; this is the
// backstop for when it cannot, e.g. the tab was torn down mid-recording. The
// grace period lets the visible timer win under normal conditions, so the user
// sees the countdown rather than an unexplained cut.
const MAX_RECORDING_SECONDS = 300;
const MAX_RECORDING_GRACE_SECONDS = 5;

async function startRecording(requestedDeviceId, requestedDeviceLabel) {
  if (isStarting) {
    return { success: false, error: 'Recording is already starting' };
  }
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    return { success: true, message: 'Already recording' };
  }

  isStarting = true;
  isStopping = false;
  isAborted = false;

  try {
    recordedChunks = [];
    hitMaxDuration = false;
    silenceWarningEmitted = false;
    clippingWarningEmitted = false;
    consecutiveSilenceFrames = 0;
    consecutiveClippingFrames = 0;
    lastLevelEmitTime = 0;
    lastEmittedLevel = -1;

    let deviceId = requestedDeviceId;
    let deviceLabel = requestedDeviceLabel;

    if (!deviceId && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        const stored = await chrome.storage.local.get(['selectedAudioDeviceId', 'selectedAudioDeviceLabel']);
        deviceId = stored.selectedAudioDeviceId;
        deviceLabel = stored.selectedAudioDeviceLabel;
      } catch (e) {}
    }

    // Try resolving deviceId by label if deviceId is missing or changed
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(d => d.kind === 'audioinput');

        let match = audioInputs.find(d => d.deviceId === deviceId && deviceId !== 'default');
        if (!match && deviceLabel && deviceLabel !== 'Default Microphone') {
          match = audioInputs.find(d => d.label === deviceLabel);
          if (match) {
            deviceId = match.deviceId;
          }
        }
      } catch (e) {}
    }

    const audioConstraints = {
      channelCount: 1, // Mono channel dedicates 100% of Opus bitrate to voice
      sampleRate: 48000, // 48kHz fullband broadcast rate
      sampleSize: 16,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      googEchoCancellation: true,
      googNoiseSuppression: true,
      googHighpassFilter: true
    };

    // 1. Voice-Optimized MediaStream Capture (Mono, 48kHz Fullband)
    if (deviceId && deviceId !== 'default') {
      try {
        // Attempt 1: Exact hardware deviceId constraint (Forces Chrome to switch to chosen mic)
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            ...audioConstraints,
            deviceId: { exact: deviceId }
          },
          video: false
        });
      } catch (exactErr) {
        console.warn('[VoiceBridge Offscreen] Exact deviceId match failed, trying simple deviceId:', exactErr);
        try {
          // Attempt 2: Simple deviceId constraint
          mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              ...audioConstraints,
              deviceId: deviceId
            },
            video: false
          });
        } catch (simpleErr) {
          console.warn('[VoiceBridge Offscreen] Selected microphone unavailable, falling back to default mic:', simpleErr);
          // Attempt 3: Graceful fallback to default microphone
          mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints,
            video: false
          });
        }
      }
    } else {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false
      });
    }

    const activeTrack = mediaStream.getAudioTracks()[0];
    console.log('[VoiceBridge Offscreen] Audio capture started on:', activeTrack?.label || 'Microphone', 'deviceId:', activeTrack?.getSettings?.()?.deviceId);

    // Abort check if cancelled while acquiring mic
    if (isAborted) {
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
        mediaStream = null;
      }
      isStarting = false;
      return { success: false, error: 'Recording was cancelled during startup' };
    }

    // 2. Real-Time Web Audio DSP Signal Processing Chain
    audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 48000,
      latencyHint: 'interactive'
    });
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    sourceNode = audioContext.createMediaStreamSource(mediaStream);

    // High-Pass Filter (85 Hz, Q=0.707): Cuts HVAC rumble, desk vibrations, and plosive "p/b" pops
    highPassFilter = audioContext.createBiquadFilter();
    highPassFilter.type = 'highpass';
    highPassFilter.frequency.setValueAtTime(85, audioContext.currentTime);
    highPassFilter.Q.setValueAtTime(0.707, audioContext.currentTime);

    // Speech Clarity Peaking Filter (3.2 kHz, +2.5dB, Q=1.0): Enhances vocal articulation & presence
    presenceFilter = audioContext.createBiquadFilter();
    presenceFilter.type = 'peaking';
    presenceFilter.frequency.setValueAtTime(3200, audioContext.currentTime);
    presenceFilter.gain.setValueAtTime(2.5, audioContext.currentTime);
    presenceFilter.Q.setValueAtTime(1.0, audioContext.currentTime);

    // Studio Dynamics Compressor: Smooths distance variations, prevents shouting distortion & digital clipping
    compressorNode = audioContext.createDynamicsCompressor();
    compressorNode.threshold.setValueAtTime(-24, audioContext.currentTime); // dB
    compressorNode.knee.setValueAtTime(30, audioContext.currentTime);        // Smooth knee
    compressorNode.ratio.setValueAtTime(4, audioContext.currentTime);        // 4:1 compression ratio
    compressorNode.attack.setValueAtTime(0.003, audioContext.currentTime);   // 3ms attack
    compressorNode.release.setValueAtTime(0.25, audioContext.currentTime);   // 250ms release

    // Analyser Node: Real-time amplitude and silence/clipping monitoring
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 64;
    analyserNode.smoothingTimeConstant = 0.8;

    // Destination Node: Feeds the DSP-enhanced audio stream directly into MediaRecorder
    destinationNode = audioContext.createMediaStreamDestination();

    // Connect DSP Signal Chain:
    // Mic -> HighPass -> PresenceEQ -> Compressor -> [Analyser, DestinationStream]
    sourceNode.connect(highPassFilter);
    highPassFilter.connect(presenceFilter);
    presenceFilter.connect(compressorNode);
    compressorNode.connect(analyserNode);
    compressorNode.connect(destinationNode);

    // 3. MediaRecorder Pipeline (Studio Fullband Opus @ 128kbps)
    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
    }

    const options = {
      audioBitsPerSecond: 128000 // Studio-Quality 128kbps Speech Compression
    };
    if (mimeType) {
      options.mimeType = mimeType;
    }

    // Record the DSP-enhanced destination stream
    mediaRecorder = new MediaRecorder(destinationNode.stream, options);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    // Start with 250ms time slices to ensure reliable continuous buffer accumulation
    mediaRecorder.start(250);
    recordingStartTime = Date.now();

    // Pause rather than stop: a paused recorder still answers requestData() and
    // stop(), so whatever was said up to the limit is still recoverable. Stopping
    // here would leave the later STOP_RECORDING with an inactive recorder and
    // throw the recording away.
    if (maxDurationTimeoutId) clearTimeout(maxDurationTimeoutId);
    maxDurationTimeoutId = setTimeout(() => {
      maxDurationTimeoutId = null;
      if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
      try {
        mediaRecorder.requestData();
        mediaRecorder.pause();
        hitMaxDuration = true;
        console.warn('[VoiceBridge Offscreen] Recording capped at', MAX_RECORDING_SECONDS, 'seconds');
      } catch (e) {}
    }, (MAX_RECORDING_SECONDS + MAX_RECORDING_GRACE_SECONDS) * 1000);

    // 4. Start Level Monitoring, Silence Detection & Clipping Guard
    startAudioAnalysisLoop();

    isStarting = false;
    return { success: true };
  } catch (err) {
    isStarting = false;
    cleanUpStreams();
    const errName = err.name || 'Error';
    const errMsg = err.message || String(err);
    console.warn('[VoiceBridge Offscreen] Start recording failed:', errName, errMsg);
    return { success: false, error: `${errName}: ${errMsg}`, name: errName };
  }
}

function startAudioAnalysisLoop() {
  const dataArray = new Uint8Array(analyserNode.frequencyBinCount);

  function analyze() {
    if (!analyserNode || !mediaRecorder || mediaRecorder.state !== 'recording') return;

    analyserNode.getByteFrequencyData(dataArray);

    // Compute average amplitude (0.0 to 1.0)
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    const average = sum / dataArray.length;
    const normalizedLevel = Math.min(1.0, average / 128.0);

    // Send level to content scripts / UI throttled to 10-12Hz (every ~90ms or when significant level delta)
    const now = Date.now();
    const delta = Math.abs(normalizedLevel - lastEmittedLevel);
    if (now - lastLevelEmitTime >= 90 || (delta > 0.04 && now - lastLevelEmitTime >= 50)) {
      lastLevelEmitTime = now;
      lastEmittedLevel = normalizedLevel;
      chrome.runtime.sendMessage({
        action: 'AUDIO_LEVEL_UPDATE',
        level: normalizedLevel
      }).catch(() => {});
    }

    // Silence detection: if level is < 0.02 for ~3 seconds (180 frames at 60fps)
    if (normalizedLevel < 0.02) {
      consecutiveSilenceFrames++;
      if (consecutiveSilenceFrames > 180 && !silenceWarningEmitted) {
        silenceWarningEmitted = true;
        chrome.runtime.sendMessage({
          action: 'SILENCE_WARNING_TRIGGERED'
        }).catch(() => {});
      }
    } else {
      consecutiveSilenceFrames = 0;
    }

    // Peak clipping detection: if level approaches digital ceiling (> 0.98)
    if (normalizedLevel > 0.98) {
      consecutiveClippingFrames++;
      if (consecutiveClippingFrames > 10 && !clippingWarningEmitted) {
        clippingWarningEmitted = true;
        chrome.runtime.sendMessage({
          action: 'PEAK_CLIPPING_WARNING'
        }).catch(() => {});
      }
    } else {
      consecutiveClippingFrames = 0;
      clippingWarningEmitted = false;
    }

    animFrameId = requestAnimationFrame(analyze);
  }

  animFrameId = requestAnimationFrame(analyze);
}

function stopRecording() {
  return new Promise((resolve) => {
    if (isStopping) {
      return resolve({ success: false, error: 'Already stopping' });
    }
    isStopping = true;

    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }

    const checkReadyAndStop = () => {
      if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        isStopping = false;
        cleanUpStreams();
        return resolve({ success: false, error: 'Not recording' });
      }

      // Wall-clock time is wrong once the cap has paused capture — the audio
      // stops at the limit however long the recorder sits there afterwards.
      const durationSeconds = hitMaxDuration
        ? MAX_RECORDING_SECONDS
        : Math.max(0.5, (Date.now() - recordingStartTime) / 1000.0);
      let resolved = false;

      // Fallback timeout to prevent hanging forever if onstop fails to fire
      const fallbackTimeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.warn('[VoiceBridge Offscreen] stopRecording fallback timeout reached');
          cleanUpStreams();
          isStopping = false;
          resolve({ success: false, error: 'Recording stop timed out' });
        }
      }, 3500);

      mediaRecorder.onstop = async () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(fallbackTimeout);

        try {
          const audioBlob = new Blob(recordedChunks, { type: 'audio/webm;codecs=opus' });
          
          // Convert Blob to Base64 Data URL for transport
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64Data = reader.result;
            cleanUpStreams();
            isStopping = false;
            resolve({
              success: true,
              audioBase64: base64Data,
              durationSeconds: durationSeconds,
              maxDurationReached: hitMaxDuration
            });
          };
          reader.onerror = () => {
            cleanUpStreams();
            isStopping = false;
            resolve({ success: false, error: 'FileReader failed to encode audio' });
          };
          reader.readAsDataURL(audioBlob);
        } catch (err) {
          cleanUpStreams();
          isStopping = false;
          resolve({ success: false, error: err.message || 'Error processing audio blob' });
        }
      };

      try {
        if (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused') {
          mediaRecorder.requestData();
        }
      } catch (e) {}

      try {
        mediaRecorder.stop();
      } catch (stopErr) {
        if (!resolved) {
          resolved = true;
          clearTimeout(fallbackTimeout);
          cleanUpStreams();
          isStopping = false;
          resolve({ success: false, error: stopErr.message || 'Failed to stop media recorder' });
        }
      }
    };

    if (isStarting) {
      let pollCount = 0;
      const startupInterval = setInterval(() => {
        pollCount++;
        if (!isStarting || pollCount > 15) {
          clearInterval(startupInterval);
          checkReadyAndStop();
        }
      }, 100);
    } else {
      checkReadyAndStop();
    }
  });
}

function cancelRecording() {
  isAborted = true;
  isStarting = false;
  isStopping = false;
  if (maxDurationTimeoutId) {
    clearTimeout(maxDurationTimeoutId);
    maxDurationTimeoutId = null;
  }
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try {
      mediaRecorder.stop();
    } catch (e) {}
  }
  cleanUpStreams();
}

function cleanUpStreams() {
  isStarting = false;
  isStopping = false;
  if (maxDurationTimeoutId) {
    clearTimeout(maxDurationTimeoutId);
    maxDurationTimeoutId = null;
  }
  if (destinationNode && destinationNode.stream) {
    destinationNode.stream.getTracks().forEach((track) => track.stop());
    destinationNode = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  if (sourceNode) {
    try { sourceNode.disconnect(); } catch (e) {}
    sourceNode = null;
  }
  if (highPassFilter) {
    try { highPassFilter.disconnect(); } catch (e) {}
    highPassFilter = null;
  }
  if (presenceFilter) {
    try { presenceFilter.disconnect(); } catch (e) {}
    presenceFilter = null;
  }
  if (compressorNode) {
    try { compressorNode.disconnect(); } catch (e) {}
    compressorNode = null;
  }
  if (analyserNode) {
    try { analyserNode.disconnect(); } catch (e) {}
    analyserNode = null;
  }
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
  recordedChunks = [];
}

// Listen for commands from service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'OFFSCREEN_START_RECORDING') {
    const deviceId = message.deviceId || message.payload?.deviceId;
    const deviceLabel = message.deviceLabel || message.payload?.deviceLabel;
    startRecording(deviceId, deviceLabel)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err.name ? `${err.name}: ${err.message}` : String(err) }));
    return true;
  }

  if (message.action === 'OFFSCREEN_STOP_RECORDING') {
    stopRecording()
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err.name ? `${err.name}: ${err.message}` : String(err) }));
    return true;
  }

  if (message.action === 'OFFSCREEN_CANCEL_RECORDING') {
    cancelRecording();
    sendResponse({ success: true });
    return false;
  }

  return false;
});

