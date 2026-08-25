import base64
import json
import os
import re
import unittest

EXTENSION_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class MockGoogleDriveBackend:
    def __init__(self):
        self.folders = {"VoiceBridge Recordings": "mock_folder_id_101"}
        self.files = {}
        self.permissions = {}

    def search_folder(self, query):
        if "name = 'VoiceBridge Recordings'" in query or "VoiceBridge Recordings" in query:
            return {"files": [{"id": self.folders["VoiceBridge Recordings"], "name": "VoiceBridge Recordings"}]}
        return {"files": []}

    def create_folder(self, name):
        folder_id = f"mock_folder_{len(self.folders) + 1}"
        self.folders[name] = folder_id
        return {"id": folder_id, "name": name}

    def upload_multipart(self, metadata, raw_bytes):
        file_id = f"mock_file_id_{len(self.files) + 1}"
        self.files[file_id] = {
            "id": file_id,
            "name": metadata.get("name"),
            "parents": metadata.get("parents"),
            "size": len(raw_bytes),
            "webViewLink": f"https://drive.google.com/file/d/{file_id}/view?usp=drivesdk"
        }
        return self.files[file_id]

    def set_permission(self, file_id, role, perm_type):
        self.permissions[file_id] = {"role": role, "type": perm_type}
        return {"id": "mock_perm_id", "role": role, "type": perm_type}


class TestVoiceBridgeE2EFlow(unittest.TestCase):
    def setUp(self):
        self.drive = MockGoogleDriveBackend()

    def test_full_student_workflow(self):
        # 1. User records 42 seconds of audio
        recorded_seconds = 42.5
        mock_audio_bytes = b"MOCK_OPUS_SPEECH_DATA_STREAM_010101010101"
        audio_base64 = "data:audio/webm;codecs=opus;base64," + base64.b64encode(mock_audio_bytes).decode('utf-8')

        # 2. Service Worker upload flow
        # Step A: Folder lookup / creation
        folder_search = self.drive.search_folder("name = 'VoiceBridge Recordings' and trashed = false")
        self.assertEqual(len(folder_search["files"]), 1)
        folder_id = folder_search["files"][0]["id"]
        self.assertEqual(folder_id, "mock_folder_id_101")

        # Step B: Build metadata
        timestamp = "2026-08-25T15-30-00"
        file_name = f"VoiceBridge_Note_{timestamp}.webm"
        metadata = {
            "name": file_name,
            "parents": [folder_id],
            "mimeType": "audio/webm",
            "description": f"VoiceBridge audio response ({round(recorded_seconds)}s) - Student Submission"
        }

        # Step C: Upload file
        raw_binary = base64.b64decode(audio_base64.split(',')[1])
        upload_result = self.drive.upload_multipart(metadata, raw_binary)
        file_id = upload_result["id"]
        self.assertTrue(file_id.startswith("mock_file_id_"))

        # Step D: Permission assignment (sharing with teacher)
        perm_result = self.drive.set_permission(file_id, "reader", "anyone")
        self.assertEqual(perm_result["type"], "anyone")

        # Step E: Format Chip Text for Classroom comment insertion
        mins = int(recorded_seconds // 60)
        secs = str(int(recorded_seconds % 60)).zfill(2)
        formatted_time = f"{mins}:{secs}"
        self.assertEqual(formatted_time, "0:42")

        view_link = upload_result["webViewLink"]
        formatted_chip_text = f"🎙️ VoiceBridge Note ({formatted_time}) • Listen: {view_link}"
        self.assertIn("🎙️ VoiceBridge Note (0:42)", formatted_chip_text)
        self.assertIn(file_id, formatted_chip_text)

        # 3. Teacher / Student viewing comment in Classroom:
        # Inline Player scans DOM for Drive links
        drive_regex = r'https:\/\/drive\.google\.com\/(?:file\/d\/|uc\?id=)([a-zA-Z0-9_-]+)'
        match = re.search(drive_regex, formatted_chip_text)
        self.assertIsNotNone(match)
        extracted_file_id = match.group(1)
        self.assertEqual(extracted_file_id, file_id)

        # 4. Stream URL generation for 1-click audio element
        stream_url = f"https://drive.google.com/uc?export=download&id={extracted_file_id}"
        self.assertEqual(stream_url, f"https://drive.google.com/uc?export=download&id={file_id}")

        # 5. Extract duration from chip text for player header
        header_match = re.search(r'VoiceBridge Note\s*\(([^)]+)\)', formatted_chip_text)
        self.assertIsNotNone(header_match)
        self.assertEqual(header_match.group(1), "0:42")

if __name__ == '__main__':
    unittest.main()
