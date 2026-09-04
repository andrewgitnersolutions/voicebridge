/**
 * VoiceBridge — Audio Playback Page Controller
 * Plays recorded audio directly from storage when running in local testing or demo mode.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  // No default id. This page only ever plays the recording named in the URL —
  // falling back to "whatever was recorded last" leaked one user's voice note to
  // another on a shared profile (see the same rule in service-worker.js).
  const fileId = urlParams.get('id') || '';
  const audioPlayer = document.getElementById('audio-player');
  const fileNameEl = document.getElementById('file-name');
  const dateEl = document.getElementById('recording-date');
  const downloadBtn = document.getElementById('btn-download-audio');

  // Try to load from chrome.storage.local — the exact key only, never a fallback
  const storageKey = `audio_${fileId}`;
  const data = fileId ? await chrome.storage.local.get([storageKey]) : {};
  const audioRecord = data[storageKey];

  if (audioRecord && audioRecord.audioBase64) {
    try {
      const parts = audioRecord.audioBase64.split(',');
      const byteCharacters = atob(parts[1] || parts[0]);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'audio/webm;codecs=opus' });
      const blobUrl = URL.createObjectURL(blob);

      audioPlayer.src = blobUrl;
      downloadBtn.href = blobUrl;
      const downloadName = `VoiceBridge_Note_${audioRecord.timestamp || Date.now()}.webm`;
      downloadBtn.download = downloadName;
      fileNameEl.textContent = downloadName;
      dateEl.textContent = `Duration: ${Math.round(audioRecord.durationSeconds || 0)}s`;

    } catch (err) {
      console.error('[VoiceBridge] Playback error:', err);
      fileNameEl.textContent = 'Could not decode audio file';
      dateEl.textContent = 'The saved recording could not be read.';
    }
  } else {
    fileNameEl.textContent = 'Could not decode audio file';
    dateEl.textContent = fileId
      ? 'This recording is not saved on this device. Local backups only play back in the browser profile that made them.'
      : 'No recording was specified. Open this page from the link in your voice note.';
    audioPlayer.removeAttribute('autoplay');
    downloadBtn.style.display = 'none';
  }
});
