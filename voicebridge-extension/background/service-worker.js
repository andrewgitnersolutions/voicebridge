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

// --- Local audio cache -------------------------------------------------------
//
// chrome.storage.local holds 10 MB without the unlimitedStorage permission, and
// base64 inflates audio by about a third. Nothing ever evicted `audio_<id>`
// entries, and every failed write sat inside an empty catch — so once the quota
// filled, caching stopped working with no signal at all. It presented as
// "playback got slow", because every play silently fell back to the network.
//
// Bounded rather than unlimited on purpose: unlimitedStorage would let student
// voice accumulate indefinitely on a shared classroom Chromebook, which is the
// wrong default for a product sold on FERPA safety.
const AUDIO_CACHE_BUDGET_BYTES = 6 * 1024 * 1024;
// A single long recording must not evict everything else for a convenience the
// Drive fetch already provides. Recoverable copies (see `required`) ignore this.
const AUDIO_CACHE_MAX_ITEM_BYTES = 2 * 1024 * 1024;

function approximateRecordBytes(record) {
  return (record?.audioBase64?.length || 0) + 256;
}

// Oldest first, until the incoming record fits the budget.
async function evictAudioCacheToFit(incomingBytes) {
  const all = await chrome.storage.local.get(null);
  const entries = Object.keys(all)
    .filter((key) => key.startsWith('audio_'))
    .map((key) => ({
      key: key,
      bytes: approximateRecordBytes(all[key]),
      cachedAt: all[key]?.cachedAt || 0
    }))
    .sort((a, b) => a.cachedAt - b.cachedAt);

  let projected = entries.reduce((sum, entry) => sum + entry.bytes, 0) + incomingBytes;
  const evict = [];
  for (const entry of entries) {
    if (projected <= AUDIO_CACHE_BUDGET_BYTES) break;
    evict.push(entry.key);
    projected -= entry.bytes;
  }

  if (evict.length) {
    console.info('[VoiceBridge] Evicting', evict.length, 'cached recording(s) to stay within the local cache budget');
    await chrome.storage.local.remove(evict);
  }
}

/**
 * Writes one recording into the local cache.
 *
 * @param {string} fileId
 * @param {Object} record
 * @param {boolean} required  True when this is the ONLY copy of the audio (the
 *                            offline fallback). Such a write ignores the per-item
 *                            cap and reports failure to the caller, because
 *                            failing silently there loses the recording.
 * @returns {Promise<boolean>} whether the recording is now cached
 */
async function cacheAudioLocally(fileId, record, required) {
  const bytes = approximateRecordBytes(record);
  if (!required && bytes > AUDIO_CACHE_MAX_ITEM_BYTES) {
    console.info('[VoiceBridge] Recording too large to cache locally; it will stream from Drive');
    return false;
  }

  try {
    await evictAudioCacheToFit(bytes);
    await chrome.storage.local.set({
      [`audio_${fileId}`]: Object.assign({ cachedAt: Date.now() }, record)
    });
    return true;
  } catch (err) {
    // Never swallowed. A failed cache write is invisible to the user otherwise.
    console.warn('[VoiceBridge] Local audio cache write failed:', err);
    return false;
  }
}

// Which account does this token actually belong to?
// getAuthToken hands back a token for the Chrome profile's PRIMARY account, and
// its `account` option needs a Gaia id that chrome.identity.getAccounts() only
// exposes on the dev channel — so the token cannot simply be pointed at the
// account the page is running as. Detecting the mismatch is what stops the
// recording from landing in the wrong Drive.
async function resolveTokenAccountEmail(token) {
  try {
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.user?.emailAddress || null;
  } catch (err) {
    console.warn('[VoiceBridge] Could not resolve token account:', err);
    return null;
  }
}

// Direct multipart upload to Student's Google Drive ($0 developer cost)
// Supports automatic local Demo Mode fallback when testing unpacked before Google Cloud OAuth is linked
async function uploadAudioToGoogleDrive(audioBase64, durationSeconds, studentNote, pageAccount) {
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

        return resolve({
          success: false,
          isDemoMode: false,
          error: `Google Drive sign-in failed: ${errorMsg}. Please check Google account authorization.`,
          duration: formattedTime,
          durationSeconds: durationSeconds
        });
      }

      try {
        // Check the account BEFORE getOrCreateDriveFolder: that helper searches by
        // name in whichever Drive the token belongs to and creates the folder if it
        // is missing, so running it first would litter the wrong account.
        const tokenEmail = await resolveTokenAccountEmail(token);
        const pageEmail = pageAccount?.email || null;
        if (tokenEmail && pageEmail && tokenEmail.toLowerCase() !== pageEmail.toLowerCase()) {
          console.warn('[VoiceBridge] Account mismatch, upload stopped:', pageEmail, '\u2260', tokenEmail);
          return resolve({
            success: false,
            isDemoMode: false,
            reason: 'account_mismatch',
            tokenEmail: tokenEmail,
            pageEmail: pageEmail,
            accountIndex: pageAccount?.index ?? null,
            error: `This page is open as ${pageEmail}, but VoiceBridge would upload to ${tokenEmail}.`,
            duration: formattedTime,
            durationSeconds: durationSeconds
          });
        }

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

        // Cache audio locally for instant in-page playback without network
        // round-trips. Optional: the file is already safely in Drive.
        await cacheAudioLocally(fileId, {
          audioBase64: audioBase64,
          durationSeconds: durationSeconds,
          timestamp: Date.now()
        }, false);

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

        // The upload failed, so this is the ONLY copy of the recording. Required,
        // and the result is reported: telling the user "audio saved locally" when
        // the write actually failed sends them looking for a file that is gone.
        const cachedLocally = await cacheAudioLocally(demoFileId, {
          audioBase64: audioBase64,
          durationSeconds: durationSeconds,
          timestamp: timestamp
        }, true);

        resolve({
          success: false,
          isDemoMode: true,
          error: cachedLocally
            ? `Upload to Google Drive failed: ${err.message || 'Network error'}. Audio saved on this device.`
            : `Upload to Google Drive failed: ${err.message || 'Network error'}, and the recording could not be saved on this device either. It has been lost — please record again.`,
          cachedLocally: cachedLocally,
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

// Drive read failures a listener can act on differently. "Not shared with you" is
// the common one in districts: drive.file is per-app-per-user, so a teacher's token
// cannot read a file the student's copy of the extension created.
const DRIVE_HTTP_REASONS = {
  401: 'not_authenticated',
  403: 'not_shared',
  404: 'not_found'
};

// --- Recording session state -------------------------------------------------
//
// Tracks which surface is currently recording, so an arbitrary UPLOAD_TO_DRIVE
// cannot be injected without a preceding recording (M-2, M-3).
//
// Held in chrome.storage.session, not a module variable. An MV3 service worker
// is evicted when idle, and a module variable goes with it — so a worker
// recycled mid-recording used to reject the upload that followed and the audio
// was simply lost. Keying by tab id also fixes the second half of that bug: a
// single boolean meant two tabs recording at once shared one flag while
// colliding over the one offscreen document the extension is allowed.
const RECORDING_SESSION_PREFIX = 'vb_recording_session_';

// Fast path for the audio-level relay, which fires about ten times a second.
// Storage stays the source of truth: this is only consulted after being set in
// the same worker lifetime, and a cold worker falls back to reading storage.
let cachedOwnerTabId = null;

// The popup can start a recording with no tab of its own, hence the sentinel.
function recordingSessionKey(sender) {
  const tabId = sender?.tab?.id;
  return `${RECORDING_SESSION_PREFIX}${typeof tabId === 'number' ? tabId : 'popup'}`;
}

async function markRecordingSession(sender) {
  cachedOwnerTabId = typeof sender?.tab?.id === 'number' ? sender.tab.id : null;
  await chrome.storage.session.set({
    [recordingSessionKey(sender)]: {
      tabId: typeof sender?.tab?.id === 'number' ? sender.tab.id : null,
      startedAt: Date.now()
    }
  });
}

async function clearRecordingSession(sender) {
  cachedOwnerTabId = null;
  try {
    await chrome.storage.session.remove(recordingSessionKey(sender));
  } catch (err) {
    console.warn('[VoiceBridge] Could not clear recording session:', err);
  }
}

async function hasRecordingSession(sender) {
  const key = recordingSessionKey(sender);
  const stored = await chrome.storage.session.get([key]);
  return !!stored[key];
}

// Whoever currently holds the single offscreen recorder, if anyone.
async function activeRecordingOwner() {
  const all = await chrome.storage.session.get(null);
  const key = Object.keys(all).find((k) => k.startsWith(RECORDING_SESSION_PREFIX));
  return key ? Object.assign({ key: key }, all[key]) : null;
}

// A tab closed mid-recording would otherwise hold the recorder forever, so no
// other tab could start one.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (cachedOwnerTabId === tabId) cachedOwnerTabId = null;
  chrome.storage.session.remove(`${RECORDING_SESSION_PREFIX}${tabId}`).catch(() => {});
});

// Periodic cleanup of expired demo recordings older than 24h (M-5)
async function cleanupExpiredRecordings() {
  try {
    const all = await chrome.storage.local.get(null);
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const expiredKeys = [];
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith('audio_vb_')) {
        // Prefer cachedAt: the fallback records' own `timestamp` is a filename-safe
        // ISO string with the colons replaced by hyphens, which Date() cannot parse,
        // so this cleanup silently matched nothing at all.
        const ts = typeof v?.cachedAt === 'number'
          ? v.cachedAt
          : (typeof v?.timestamp === 'number' ? v.timestamp : 0);
        if (ts && (now - ts > ONE_DAY_MS)) {
          expiredKeys.push(k);
        }
      }
    }
    if (expiredKeys.length > 0) {
      await chrome.storage.local.remove(expiredKeys);
      console.log(`[VoiceBridge] Cleaned up ${expiredKeys.length} expired demo audio recordings`);
    }
  } catch (err) {
    console.warn('[VoiceBridge] Expired-recording cleanup failed:', err);
  }
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

  if (action === 'AUDIO_LEVEL_UPDATE' || action === 'SILENCE_WARNING_TRIGGERED') {
    // The offscreen document sends these with chrome.runtime.sendMessage, which
    // reaches extension pages but NOT content scripts — a content script only
    // receives chrome.tabs.sendMessage. Without this relay the live level meter
    // and the "we didn't hear any sound" warning never fired at all, in either
    // recorder, despite both being listed accessibility features.
    if (typeof cachedOwnerTabId === 'number') {
      chrome.tabs.sendMessage(cachedOwnerTabId, message).catch(() => {});
      return false;
    }
    (async () => {
      const owner = await activeRecordingOwner();
      if (owner && typeof owner.tabId === 'number') {
        cachedOwnerTabId = owner.tabId;
        chrome.tabs.sendMessage(owner.tabId, message).catch(() => {});
      }
    })();
    return false;
  }

  if (action === 'OPEN_PERMISSION_PAGE') {
    chrome.tabs.create({ url: chrome.runtime.getURL('permissions/permission.html') });
    sendResponse({ success: true });
    return false;
  }

  if (action === 'START_RECORDING') {
    (async () => {
      try {
        // One offscreen document means one recording at a time. Refusing here is
        // what stops a second tab from silently hijacking the first tab's audio.
        const owner = await activeRecordingOwner();
        if (owner && owner.key !== recordingSessionKey(sender)) {
          sendResponse({
            success: false,
            error: 'Another tab is already recording with VoiceBridge. Finish or cancel that recording first.'
          });
          return;
        }
        await markRecordingSession(sender);
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
            clearRecordingSession(sender);
            sendResponse({
              success: false,
              permissionRequired: true,
              error: 'Microphone permission required. Opening one-time setup page...'
            });
            return;
          }
          if (res && res.success === false) clearRecordingSession(sender);
          sendResponse(res || { success: true });
        });
      } catch (err) {
        await clearRecordingSession(sender);
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
    clearRecordingSession(sender);
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
    (async () => {
      try {
        // Only accept an upload that follows a recording this sender actually
        // started (M-3). The check survives worker eviction now that the session
        // lives in chrome.storage.session rather than a module variable.
        if (sender.tab && !(await hasRecordingSession(sender))) {
          console.warn('[VoiceBridge] Blocked unauthorized UPLOAD_TO_DRIVE without preceding recording session');
          sendResponse({ success: false, error: 'No active recording session' });
          return;
        }

        const result = await uploadAudioToGoogleDrive(
          payload.audioBase64,
          payload.durationSeconds || 0,
          payload.note || '',
          payload.pageAccount || null
        );
        await closeOffscreenDocument();
        if (result.success) {
          await clearRecordingSession(sender);
        }
        sendResponse({ success: result.success, data: result, error: result.error, reason: result.reason });
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
          sendResponse({ success: false, reason: 'invalid_id', error: 'Invalid file ID' });
          return;
        }
        // Check local storage cache first for instant, zero-latency playback.
        // Only ever serve the exact `audio_${fileId}` key. There is deliberately no
        // "most recent recording" fallback: on a shared classroom Chromebook it served
        // one student's voice under another student's link, and it fired precisely when
        // the network had already failed and nobody would question what they heard.
        // A cache miss must fall through to the Drive fetch below.
        try {
          const cached = await chrome.storage.local.get([`audio_${fileId}`]);
          if (cached && cached[`audio_${fileId}`]?.audioBase64) {
            sendResponse({ success: true, base64Audio: cached[`audio_${fileId}`].audioBase64 });
            return;
          }
        } catch (storageErr) {
          console.warn('[VoiceBridge] Local audio cache lookup error:', storageErr);
        }

        chrome.identity.getAuthToken({ interactive: !!payload?.interactive }, async (token) => {
          if (chrome.runtime.lastError || !token) {
            sendResponse({ success: false, reason: 'not_authenticated', error: 'Not authenticated' });
            return;
          }
          try {
            const streamRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (!streamRes.ok) {
              // The caller shows a different message for each of these, so a
              // teacher who was never granted access is not told "network error".
              // 403 is the expected result of the drive.file scope: this extension
              // did not create the student's file, so it cannot read it by API.
              sendResponse({
                success: false,
                reason: DRIVE_HTTP_REASONS[streamRes.status] || 'drive_error',
                status: streamRes.status,
                error: `Drive fetch failed: ${streamRes.status}`
              });
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
            // Cache fetched audio for subsequent plays. Optional: Drive has it.
            await cacheAudioLocally(fileId, {
              audioBase64: audioDataUri,
              timestamp: Date.now()
            }, false);
            sendResponse({ success: true, base64Audio: audioDataUri });
          } catch (e) {
            // fetch() only rejects on a transport failure, so this is the network case
            sendResponse({ success: false, reason: 'network', error: e.message });
          }
        });
      } catch (err) {
        sendResponse({ success: false, reason: 'network', error: err.message });
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
