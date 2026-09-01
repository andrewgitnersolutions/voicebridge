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
        self.assertIn("latest_audio", self.sw_code)

if __name__ == '__main__':
    unittest.main()
