/**
 * VoiceBridge — One-Time Microphone Permission Setup Controller
 * Requests mic permission in a visible extension tab so the extension origin is authorized for offscreen recording.
 */

document.addEventListener('DOMContentLoaded', () => {
  const grantBtn = document.getElementById('btn-grant-permission');
  const statusMsg = document.getElementById('status-msg');
  const iconDisplay = document.getElementById('icon-display');
  const title = document.getElementById('setup-title');
  const desc = document.getElementById('setup-desc');

  // Automatically request on page load if user opened this setup tab
  requestMicAccess();

  grantBtn.addEventListener('click', () => {
    requestMicAccess();
  });

  async function requestMicAccess() {
    try {
      grantBtn.disabled = true;
      grantBtn.textContent = 'Requesting access...';

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });

      // Stop tracks immediately after permission is granted
      stream.getTracks().forEach((track) => track.stop());

      // Success UI state
      iconDisplay.textContent = '✅';
      iconDisplay.style.background = '#dcfce7';
      iconDisplay.style.borderColor = '#86efac';
      title.textContent = 'Microphone Enabled!';
      desc.textContent = 'You are now ready to record voice notes in Google Classroom and Google Docs.';
      
      statusMsg.className = 'status-box status-success';
      statusMsg.textContent = 'Microphone permission saved! Closing window in 2 seconds...';
      grantBtn.style.display = 'none';

      setTimeout(() => {
        window.close();
      }, 2200);

    } catch (err) {
      console.warn('[VoiceBridge] Permission request outcome:', err);
      grantBtn.disabled = false;
      grantBtn.innerHTML = '<span>🎙️</span><span>Allow Microphone Access</span>';
      
      statusMsg.className = 'status-box status-error';
      if (err.name === 'NotAllowedError') {
        statusMsg.innerHTML = 'Permission was dismissed or blocked. Please click the <strong>lock icon (🔒)</strong> or <strong>tune icon</strong> in your browser address bar above and set Microphone to <strong>Allow</strong>.';
      } else {
        statusMsg.textContent = 'Microphone error: ' + err.message;
      }
    }
  }
});
