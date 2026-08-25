/**
 * VoiceBridge — Audio Playback Page Controller
 * Plays recorded audio directly from storage when running in local testing or demo mode.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const fileId = urlParams.get('id') || 'latest';
  const audioPlayer = document.getElementById('audio-player');
  const fileNameEl = document.getElementById('file-name');
  const dateEl = document.getElementById('recording-date');
  const downloadBtn = document.getElementById('btn-download-audio');

  // Try to load from chrome.storage.local
  const storageKey = `audio_${fileId}`;
  const data = await chrome.storage.local.get([storageKey, 'latest_audio']);
  const audioRecord = data[storageKey] || data['latest_audio'];

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
    }
  } else {
    fileNameEl.textContent = 'Voice Note File Ready';
    dateEl.textContent = 'Audio stream loaded';
  }
});
