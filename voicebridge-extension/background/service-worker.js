/**
 * VoiceBridge — Background Service Worker (Manifest V3)
 * Handles offscreen audio capture orchestration, Google Drive API direct uploads ($0 developer cost),
 * least-privilege OAuth2 token management, and message routing.
 */

const OFFSCREEN_DOCUMENT_PATH = 'offscreen/offscreen.html';
const FOLDER_NAME = 'VoiceBridge Recordings';

// Ensure offscreen document exists for Web Audio / MediaRecorder
async function ensureOffscreenDocument() {
  if (chrome.offscreen && chrome.offscreen.hasDocument) {
    const hasDoc = await chrome.offscreen.hasDocument();
    if (hasDoc) return;
  }

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ['USER_MEDIA'],
      justification: 'Record accessible voice responses for Google Classroom and Docs assignments'
    });
  } catch (err) {
    if (!err.message.includes('Only a single offscreen document may be created')) {
      console.error('[VoiceBridge] Error creating offscreen document:', err);
      throw err;
    }
  }
}

// Close offscreen document when not in use to save system memory
async function closeOffscreenDocument() {
  if (chrome.offscreen && chrome.offscreen.hasDocument) {
    const hasDoc = await chrome.offscreen.hasDocument();
    if (hasDoc) {
      try {
        await chrome.offscreen.closeDocument();
      } catch (err) {
        console.warn('[VoiceBridge] Offscreen document already closed:', err);
      }
    }
  }
}

// Get or create "VoiceBridge Recordings" folder in student's Google Drive
async function getOrCreateDriveFolder(token) {
  const query = `name = '${FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`;

  const response = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to search Drive: ${response.status} ${errText}`);
  }

  const data = await response.json();
  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }

  // Create folder if it doesn't exist
  const createUrl = 'https://www.googleapis.com/drive/v3/files';
  const folderMetadata = {
    name: FOLDER_NAME,
    mimeType: 'application/vnd.google-apps.folder'
  };

  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(folderMetadata)
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Failed to create Drive folder: ${createRes.status} ${errText}`);
  }

  const folderData = await createRes.json();
  return folderData.id;
}

// Set shareable link permission on the recording file
// Defaults to domain sharing for FERPA compliance, falling back to anyone or restricted
async function setDriveFilePermission(fileId, token) {
  const permUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`;
  
  // Default to domain-level sharing (safe for strict school district Google Workspace policies & FERPA compliant)
  try {
    const domainRes = await fetch(permUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        role: 'reader',
        type: 'domain'
      })
    });

    if (domainRes.ok) return { type: 'domain' };
  } catch (err) {
    console.warn('[VoiceBridge] Domain sharing unavailable, falling back to link sharing:', err);
  }

  // Fallback to "anyone with link" if domain sharing is unavailable (e.g. consumer accounts)
  try {
    const res = await fetch(permUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        role: 'reader',
        type: 'anyone',
        allowFileDiscovery: false
      })
    });

    if (res.ok) return { type: 'anyone' };
  } catch (err) {
    console.warn('[VoiceBridge] Public sharing restricted by district policy:', err);
  }

  return { type: 'restricted' };
}

// Direct multipart upload to Student's Google Drive ($0 developer cost)
// Supports automatic local Demo Mode fallback when testing unpacked before Google Cloud OAuth is linked
async function uploadAudioToGoogleDrive(audioBase64, durationSeconds, studentNote) {
  const mins = Math.floor(durationSeconds / 60);
  const secs = Math.floor(durationSeconds % 60).toString().padStart(2, '0');
  const formattedTime = `${mins}:${secs}`;
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);

  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: true }, async (token) => {
      // If OAuth token request fails, return clear error instead of silently faking success with unshareable local link
      if (chrome.runtime.lastError || !token) {
        const errorMsg = chrome.runtime.lastError?.message || 'Authentication token unavailable';
        console.error('[VoiceBridge] Google Drive OAuth error:', errorMsg);

        // Preserve recorded audio in local storage so user does not lose their recording
        try {
          await chrome.storage.local.set({
            latest_audio: {
              audioBase64: audioBase64,
              durationSeconds: durationSeconds,
              timestamp: timestamp
            }
          });
        } catch (e) {}

        return resolve({
          success: false,
          isDemoMode: false,
          error: `Google Drive sign-in failed: ${errorMsg}. Please check Google account authorization.`,
          duration: formattedTime,
          durationSeconds: durationSeconds
        });
      }

      try {
        const folderId = await getOrCreateDriveFolder(token);

        // Convert base64 data to binary Blob
        const byteCharacters = atob(audioBase64.split(',')[1] || audioBase64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);

        const fileName = `VoiceBridge_Note_${timestamp}.webm`;

        const metadata = {
          name: fileName,
          parents: [folderId],
          mimeType: 'audio/webm',
          description: `VoiceBridge audio response (${Math.round(durationSeconds)}s) - ${studentNote || 'Student Submission'}`
        };

        const boundary = '-------314159265358979323846';
        const delimiter = `\r\n--${boundary}\r\n`;
        const closeDelimiter = `\r\n--${boundary}--`;

        const metadataPart = `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}`;
        const mediaPartHeader = `${delimiter}Content-Type: audio/webm\r\n\r\n`;

        const encoder = new TextEncoder();
        const part1 = encoder.encode(metadataPart);
        const part2 = encoder.encode(mediaPartHeader);
        const part3 = byteArray;
        const part4 = encoder.encode(closeDelimiter);

        const totalLength = part1.length + part2.length + part3.length + part4.length;
        const combinedBody = new Uint8Array(totalLength);
        let offset = 0;
        combinedBody.set(part1, offset); offset += part1.length;
        combinedBody.set(part2, offset); offset += part2.length;
        combinedBody.set(part3, offset); offset += part3.length;
        combinedBody.set(part4, offset);

        const uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink,size';

        let uploadRes = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/related; boundary=${boundary}`
          },
          body: combinedBody
        });

        // If 401 Unauthorized, token may be expired; remove cached token and retry once (M-4)
        if (uploadRes.status === 401 && token) {
          console.warn('[VoiceBridge] OAuth token expired (401), invalidating cache and retrying...');
          await new Promise((res) => chrome.identity.removeCachedAuthToken({ token }, res));
          const refreshedToken = await new Promise((res) => {
            chrome.identity.getAuthToken({ interactive: false }, (t) => res(t || null));
          });
          if (refreshedToken) {
            token = refreshedToken;
            uploadRes = await fetch(uploadUrl, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': `multipart/related; boundary=${boundary}`
              },
              body: combinedBody
            });
          }
        }

        if (!uploadRes.ok) {
          const errText = await uploadRes.text();
          throw new Error(`Google Drive upload failed: ${uploadRes.status} ${errText}`);
        }

        const fileData = await uploadRes.json();
        const fileId = fileData.id;

        // Set permission so teacher can view/stream (domain first for FERPA compliance)
        const permResult = await setDriveFilePermission(fileId, token);

        const directStreamUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
        const viewLink = fileData.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;

        // Cache audio locally for instant in-page playback without network round-trips
        try {
          await chrome.storage.local.set({
            [`audio_${fileId}`]: {
              audioBase64: audioBase64,
              durationSeconds: durationSeconds,
              timestamp: Date.now()
            },
            latest_audio: {
              audioBase64: audioBase64,
              durationSeconds: durationSeconds,
              timestamp: timestamp
            }
          });
        } catch (e) {}

        resolve({
          success: true,
          isDemoMode: false,
          fileId: fileId,
          fileName: fileName,
          webViewLink: viewLink,
          directStreamUrl: directStreamUrl,
          duration: formattedTime,
          durationSeconds: durationSeconds,
          sharing: permResult.type,
          formattedChipText: `🎙️ VoiceBridge Note (${formattedTime}) • Listen: ${viewLink}`
        });

      } catch (err) {
        console.error('[VoiceBridge] Drive upload error:', err);
        // Do NOT return success: true with a fake Google Drive link (M-1)
        // Return clear failure with local player link so user knows upload failed and audio is preserved
        const demoFileId = `vb_fallback_${Date.now()}`;
        const localListenUrl = chrome.runtime.getURL(`player/listen.html?id=${demoFileId}`);

        // Save demo recording in local storage for offline recovery
        try {
          await chrome.storage.local.set({
            [`audio_${demoFileId}`]: {
              audioBase64: audioBase64,
              durationSeconds: durationSeconds,
              timestamp: timestamp
            },
            latest_audio: {
              audioBase64: audioBase64,
              durationSeconds: durationSeconds,
              timestamp: timestamp
            }
          });
        } catch (e) {}

        resolve({
          success: false,
          isDemoMode: true,
          error: `Upload to Google Drive failed: ${err.message || 'Network error'}. Audio saved locally.`,
          fileId: demoFileId,
          fileName: `VoiceBridge_Note_${timestamp}.webm`,
          webViewLink: localListenUrl,
          directStreamUrl: localListenUrl,
          duration: formattedTime,
          durationSeconds: durationSeconds,
          sharing: 'offline_fallback',
          formattedChipText: `🎙️ VoiceBridge Note (${formattedTime}) [Local Backup] • Listen: ${localListenUrl}`
        });
      }
    });
  });
}

// State tracking to prevent unauthorized/arbitrary uploads (M-2, M-3)
let activeRecordingSession = false;

// Periodic cleanup of expired demo recordings older than 24h (M-5)
async function cleanupExpiredRecordings() {
  try {
    const all = await chrome.storage.local.get(null);
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const expiredKeys = [];
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith('audio_vb_')) {
        const ts = typeof v?.timestamp === 'number' ? v.timestamp : (v?.timestamp ? new Date(v.timestamp).getTime() : 0);
        if (ts && (now - ts > ONE_DAY_MS)) {
          expiredKeys.push(k);
        }
      }
    }
    if (expiredKeys.length > 0) {
      await chrome.storage.local.remove(expiredKeys);
      console.log(`[VoiceBridge] Cleaned up ${expiredKeys.length} expired demo audio recordings`);
    }
  } catch (e) {}
}

cleanupExpiredRecordings();

// Runtime message dispatcher
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Validate sender: ensure message originated from this extension (M-2)
  if (sender && sender.id !== chrome.runtime.id) {
    console.warn('[VoiceBridge] Blocked message from unauthorized sender:', sender?.id);
    sendResponse({ success: false, error: 'Unauthorized sender' });
    return false;
  }

  const { action, payload } = message;

  if (action === 'OPEN_PERMISSION_PAGE') {
    chrome.tabs.create({ url: chrome.runtime.getURL('permissions/permission.html') });
    sendResponse({ success: true });
    return false;
  }

  if (action === 'START_RECORDING') {
    activeRecordingSession = true;
    (async () => {
      try {
        await ensureOffscreenDocument();
        const settings = await chrome.storage.local.get(['selectedAudioDeviceId', 'selectedAudioDeviceLabel']);
        const deviceId = payload?.deviceId || settings.selectedAudioDeviceId;
        const deviceLabel = payload?.deviceLabel || settings.selectedAudioDeviceLabel;
        chrome.runtime.sendMessage({ action: 'OFFSCREEN_START_RECORDING', deviceId, deviceLabel }, (res) => {
          if (chrome.runtime.lastError) {
            console.warn('[VoiceBridge] Offscreen comms error:', chrome.runtime.lastError.message);
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          if (res && !res.success && (res.error?.includes('NotAllowedError') || res.error?.includes('Permission'))) {
            // Open user-facing permission setup tab
            chrome.tabs.create({ url: chrome.runtime.getURL('permissions/permission.html') });
            sendResponse({
              success: false,
              permissionRequired: true,
              error: 'Microphone permission required. Opening one-time setup page...'
            });
            return;
          }
          sendResponse(res || { success: true });
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (action === 'STOP_RECORDING') {
    (async () => {
      try {
        chrome.runtime.sendMessage({ action: 'OFFSCREEN_STOP_RECORDING' }, (res) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse(res || { success: false, error: 'Empty response from recorder' });
          }
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (action === 'CANCEL_RECORDING') {
    activeRecordingSession = false;
    (async () => {
      try {
        chrome.runtime.sendMessage({ action: 'OFFSCREEN_CANCEL_RECORDING' }, () => {
          if (chrome.runtime.lastError) {
            // Ignore if already closed
          }
          closeOffscreenDocument();
          sendResponse({ success: true });
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (action === 'UPLOAD_TO_DRIVE') {
    // Only accept upload if a recording session was active (or sent from extension popup without tab) (M-3)
    if (sender.tab && !activeRecordingSession) {
      console.warn('[VoiceBridge] Blocked unauthorized UPLOAD_TO_DRIVE without preceding recording session');
      sendResponse({ success: false, error: 'No active recording session' });
      return false;
    }

    (async () => {
      try {
        const result = await uploadAudioToGoogleDrive(
          payload.audioBase64,
          payload.durationSeconds || 0,
          payload.note || ''
        );
        await closeOffscreenDocument();
        if (result.success) {
          activeRecordingSession = false;
        }
        sendResponse({ success: result.success, data: result, error: result.error });
      } catch (err) {
        console.error('[VoiceBridge] Upload failed:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (action === 'FETCH_DRIVE_AUDIO') {
    (async () => {
      try {
        const fileId = payload?.fileId;
        if (!fileId || typeof fileId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
          sendResponse({ success: false, error: 'Invalid file ID' });
          return;
        }
        // Check local storage cache first for instant, zero-latency playback
        try {
          const cached = await chrome.storage.local.get([`audio_${fileId}`, 'latest_audio']);
          if (cached && cached[`audio_${fileId}`]?.audioBase64) {
            sendResponse({ success: true, base64Audio: cached[`audio_${fileId}`].audioBase64 });
            return;
          }
          if (fileId.startsWith('vb_fallback_') || fileId.includes('Simulated')) {
            if (cached?.latest_audio?.audioBase64) {
              sendResponse({ success: true, base64Audio: cached.latest_audio.audioBase64 });
              return;
            }
          }
        } catch (storageErr) {
          console.warn('[VoiceBridge] Local audio cache lookup error:', storageErr);
        }

        chrome.identity.getAuthToken({ interactive: !!payload?.interactive }, async (token) => {
          if (chrome.runtime.lastError || !token) {
            sendResponse({ success: false, error: 'Not authenticated' });
            return;
          }
          try {
            const streamRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (!streamRes.ok) {
              sendResponse({ success: false, error: `Drive fetch failed: ${streamRes.status}` });
              return;
            }
            const arrayBuf = await streamRes.arrayBuffer();
            const bytes = new Uint8Array(arrayBuf);
            let binary = '';
            const chunkSize = 8192;
            for (let i = 0; i < bytes.length; i += chunkSize) {
              binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
            }
            const base64 = btoa(binary);
            const audioDataUri = `data:audio/webm;base64,${base64}`;
            // Cache fetched audio for subsequent plays
            try {
              await chrome.storage.local.set({
                [`audio_${fileId}`]: {
                  audioBase64: audioDataUri,
                  timestamp: Date.now()
                }
              });
            } catch (e) {}
            sendResponse({ success: true, base64Audio: audioDataUri });
          } catch (e) {
            sendResponse({ success: false, error: e.message });
          }
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (action === 'GET_USER_SETTINGS') {
    (async () => {
      const settings = await chrome.storage.local.get([
        'fontFamily',
        'theme',
        'singleKeyShortcuts',
        'silenceWarning',
        'autoStartRecording',
        'micSensitivity',
        'selectedAudioDeviceId',
        'selectedAudioDeviceLabel'
      ]);
      sendResponse({
        fontFamily: settings.fontFamily || 'lexend',
        theme: settings.theme || 'default',
        singleKeyShortcuts: settings.singleKeyShortcuts ?? true,
        silenceWarning: settings.silenceWarning ?? true,
        autoStartRecording: settings.autoStartRecording ?? false,
        micSensitivity: settings.micSensitivity || 1.0,
        selectedAudioDeviceId: settings.selectedAudioDeviceId || 'default',
        selectedAudioDeviceLabel: settings.selectedAudioDeviceLabel || 'Default Microphone'
      });
    })();
    return true;
  }

  return false;
});
