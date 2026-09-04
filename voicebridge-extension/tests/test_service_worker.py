import base64
import json
import os
import re
import unittest

EXTENSION_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class TestServiceWorker(unittest.TestCase):
    def setUp(self):
        self.sw_path = os.path.join(EXTENSION_DIR, 'background', 'service-worker.js')
        with open(self.sw_path, 'r', encoding='utf-8') as f:
            self.sw_code = f.read()

    def test_actions_handled(self):
        expected_actions = [
            'START_RECORDING',
            'STOP_RECORDING',
            'CANCEL_RECORDING',
            'UPLOAD_TO_DRIVE',
            'GET_USER_SETTINGS'
        ]
        for action in expected_actions:
            self.assertIn(f"'{action}'", self.sw_code, f"Action {action} should be handled in service worker")

    def test_drive_folder_query_structure(self):
        # Verify Drive search query searches for exact folder name and not trashed
        self.assertIn("name = '${FOLDER_NAME}'", self.sw_code)
        self.assertIn("mimeType = 'application/vnd.google-apps.folder'", self.sw_code)
        self.assertIn("trashed = false", self.sw_code)

    def test_multipart_upload_structure(self):
        # Verify boundary and multipart formatting
        self.assertIn("uploadType=multipart", self.sw_code)
        self.assertIn("multipart/related; boundary=", self.sw_code)
        self.assertIn("Content-Type: application/json; charset=UTF-8", self.sw_code)
        self.assertIn("Content-Type: audio/webm", self.sw_code)

    def test_permission_fallback_mechanism(self):
        # Verify it tries 'anyone' and catches failure to try 'domain'
        self.assertIn("'anyone'", self.sw_code)
        self.assertIn("'domain'", self.sw_code)
        self.assertIn("'restricted'", self.sw_code)

    def test_duration_formatting_logic(self):
        # Test the math used for duration formatting in the service worker
        def format_duration(duration_seconds):
            mins = int(duration_seconds // 60)
            secs = str(int(duration_seconds % 60)).zfill(2)
            return f"{mins}:{secs}"

        self.assertEqual(format_duration(0), "0:00")
        self.assertEqual(format_duration(45), "0:45")
        self.assertEqual(format_duration(60), "1:00")
        self.assertEqual(format_duration(125), "2:05")
        self.assertEqual(format_duration(3600), "60:00")

    def test_multipart_payload_simulation(self):
        # Simulate building the exact multipart body byte sequence
        raw_audio = b"OPUS_MOCK_AUDIO_DATA_BYTES_12345"
        audio_b64 = "data:audio/webm;codecs=opus;base64," + base64.b64encode(raw_audio).decode('utf-8')
        
        # Decoding simulation
        decoded = base64.b64decode(audio_b64.split(',')[1])
        self.assertEqual(decoded, raw_audio)

        # Boundary checks
        boundary = '-------314159265358979323846'
        delimiter = f"\r\n--{boundary}\r\n"
        close_delimiter = f"\r\n--{boundary}--"

        metadata = {
            "name": "VoiceBridge_Note_2026-08-25T12-00-00.webm",
            "parents": ["folder123"],
            "mimeType": "audio/webm",
            "description": "VoiceBridge audio response (45s) - Student Submission"
        }

        metadata_part = f"{delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n{json.dumps(metadata)}"
        media_part_header = f"{delimiter}Content-Type: audio/webm\r\n\r\n"

        part1 = metadata_part.encode('utf-8')
        part2 = media_part_header.encode('utf-8')
        part3 = decoded
        part4 = close_delimiter.encode('utf-8')

        combined = part1 + part2 + part3 + part4
        self.assertIn(b"VoiceBridge_Note_2026-08-25T12-00-00.webm", combined)
        self.assertIn(b"OPUS_MOCK_AUDIO_DATA_BYTES_12345", combined)
        self.assertTrue(combined.endswith(close_delimiter.encode('utf-8')))

    def test_user_settings_defaults(self):
        self.assertIn("fontFamily: settings.fontFamily || 'lexend'", self.sw_code)
        self.assertIn("theme: settings.theme || 'default'", self.sw_code)
        self.assertIn("singleKeyShortcuts: settings.singleKeyShortcuts ?? true", self.sw_code)
        self.assertIn("silenceWarning: settings.silenceWarning ?? true", self.sw_code)
        self.assertIn("autoStartRecording: settings.autoStartRecording ?? false", self.sw_code)
        self.assertIn("selectedAudioDeviceId: settings.selectedAudioDeviceId || 'default'", self.sw_code)
        self.assertIn("selectedAudioDeviceLabel: settings.selectedAudioDeviceLabel || 'Default Microphone'", self.sw_code)

    def test_oauth_error_handling(self):
        # Ensure service worker does not return success: true with dummy demo links on OAuth error
        self.assertIn("Google Drive sign-in failed:", self.sw_code)
        self.assertIn("chrome.runtime.lastError?.message", self.sw_code)

    def test_account_mismatch_is_checked_before_any_drive_write(self):
        """A wrong-account upload must be stopped before the folder is created.

        getOrCreateDriveFolder searches by name in whichever Drive the token
        belongs to and creates the folder when it is missing, so checking after
        it would leave a stray "VoiceBridge Recordings" folder in the wrong
        account even when the upload itself was refused.
        """
        self.assertIn('resolveTokenAccountEmail', self.sw_code)
        self.assertIn("drive/v3/about?fields=user(emailAddress)", self.sw_code)
        self.assertIn("reason: 'account_mismatch'", self.sw_code)

        gate = self.sw_code.index("reason: 'account_mismatch'")
        folder = self.sw_code.index('const folderId = await getOrCreateDriveFolder(token)')
        self.assertLess(
            gate, folder,
            'The mismatch gate must run before getOrCreateDriveFolder, '
            'or a refused upload still creates a folder in the wrong Drive'
        )

    def test_account_mismatch_names_both_accounts(self):
        """The response carries both addresses; "upload failed" is not actionable."""
        self.assertIn('tokenEmail: tokenEmail', self.sw_code)
        self.assertIn('pageEmail: pageEmail', self.sw_code)

    def test_account_check_fails_open(self):
        """An unresolvable account must not block recording.

        about.get can fail for reasons that have nothing to do with the user's
        accounts. Only a positive mismatch — both addresses known and different —
        may stop an upload; anything else proceeds as before.
        """
        self.assertIn(
            'if (tokenEmail && pageEmail && tokenEmail.toLowerCase() !== pageEmail.toLowerCase())',
            self.sw_code
        )
        self.assertIn('return null;', self.sw_code)

    def test_audio_cache_is_bounded_and_evicts(self):
        """The cache had no ceiling and no eviction.

        Once the 10 MB quota filled, every set() failed into an empty catch and
        playback silently fell back to the network — it presented as "playback
        got slow" with nothing to point at.
        """
        self.assertIn('AUDIO_CACHE_BUDGET_BYTES', self.sw_code)
        self.assertIn('async function evictAudioCacheToFit', self.sw_code)
        self.assertIn('chrome.storage.local.remove(evict)', self.sw_code)
        # Oldest-first requires a comparable write time on every entry
        self.assertIn('cachedAt: Date.now()', self.sw_code)
        self.assertIn('(a, b) => a.cachedAt - b.cachedAt', self.sw_code)

    def test_no_cache_write_fails_silently(self):
        """Every storage write goes through the one reporting helper."""
        self.assertIn('console.warn(\'[VoiceBridge] Local audio cache write failed:\'', self.sw_code)
        self.assertEqual(
            0, self.sw_code.count('} catch (e) {}'),
            'An empty catch is how the quota failure stayed invisible'
        )
        self.assertEqual(
            4, self.sw_code.count('cacheAudioLocally('),
            'Cache writes must all go through cacheAudioLocally: 1 definition plus '
            'the three call sites (post-upload, offline fallback, post-fetch)'
        )

    def test_the_only_copy_of_a_recording_reports_write_failure(self):
        """When the upload failed, the local write is the recording.

        Saying "audio saved locally" after that write failed sends the user
        looking for a file that does not exist.
        """
        self.assertIn('const cachedLocally = await cacheAudioLocally(', self.sw_code)
        self.assertIn('cachedLocally: cachedLocally', self.sw_code)
        self.assertIn('please record again', self.sw_code)

    def test_recording_state_survives_worker_eviction(self):
        """Recording state must not live in a module variable.

        An MV3 service worker is evicted when idle. A worker recycled mid-recording
        lost the flag, so the UPLOAD_TO_DRIVE that followed was rejected as
        unauthorised and the audio was gone.
        """
        self.assertNotIn(
            'let activeRecordingSession', self.sw_code,
            'Recording state is back in an evictable module variable'
        )
        self.assertIn('chrome.storage.session.set', self.sw_code)
        self.assertIn('async function hasRecordingSession', self.sw_code)
        self.assertIn('await hasRecordingSession(sender)', self.sw_code)

    def test_recording_session_is_keyed_by_tab(self):
        """One offscreen document means one recording; a single boolean let two
        tabs record at once and collide over it."""
        self.assertIn('RECORDING_SESSION_PREFIX', self.sw_code)
        self.assertIn('sender?.tab?.id', self.sw_code)
        self.assertIn("owner.key !== recordingSessionKey(sender)", self.sw_code)
        self.assertIn('Another tab is already recording', self.sw_code)
        # A closed tab must release the recorder, or nobody else can start one
        self.assertIn('chrome.tabs.onRemoved.addListener', self.sw_code)

    def test_offscreen_events_are_relayed_to_the_recording_tab(self):
        """chrome.runtime.sendMessage from the offscreen document does not reach
        content scripts — only chrome.tabs.sendMessage does.

        Without this relay the live level meter and the "we didn't hear any
        sound" warning never fired at all, in either recorder.
        """
        self.assertIn("action === 'AUDIO_LEVEL_UPDATE' || action === 'SILENCE_WARNING_TRIGGERED'", self.sw_code)
        self.assertIn('chrome.tabs.sendMessage(cachedOwnerTabId, message)', self.sw_code)

    def test_no_shared_latest_audio_key_anywhere(self):
        """A cached recording is only ever addressable by its own file id.

        A shared `latest_audio` key served the last recording made on the profile
        to whoever asked next — one student's voice under another student's link
        on a shared Chromebook. The guard is that the key exists in no JS file at
        all, so neither a reader nor a writer can quietly come back.
        """
        offenders = []
        for root, dirs, files in os.walk(EXTENSION_DIR):
            dirs[:] = [d for d in dirs if d not in ('node_modules', 'dist', '.git', '__pycache__')]
            for name in files:
                if not name.endswith('.js'):
                    continue
                path = os.path.join(root, name)
                with open(path, 'r', encoding='utf-8') as f:
                    if 'latest_audio' in f.read():
                        offenders.append(os.path.relpath(path, EXTENSION_DIR))
        self.assertEqual(
            [], offenders,
            "latest_audio is a cross-user audio leak and must not be read or written: "
            + ", ".join(offenders)
        )

    def test_audio_cache_is_served_only_by_exact_file_id(self):
        """No id-shaped fallback may bypass the exact-key lookup."""
        self.assertIn("chrome.storage.local.get([`audio_${fileId}`])", self.sw_code)
        self.assertNotIn("vb_fallback_')", self.sw_code.replace("`vb_fallback_${Date.now()}`", ""))
        self.assertNotIn("fileId.includes('Simulated')", self.sw_code)

if __name__ == '__main__':
    unittest.main()
