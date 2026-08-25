import json
import os
import unittest
import struct

EXTENSION_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class TestManifest(unittest.TestCase):
    def setUp(self):
        self.manifest_path = os.path.join(EXTENSION_DIR, 'manifest.json')
        with open(self.manifest_path, 'r', encoding='utf-8') as f:
            self.manifest = json.load(f)

    def test_manifest_version_is_3(self):
        self.assertEqual(self.manifest.get('manifest_version'), 3, "Manifest version must be 3")

    def test_basic_metadata(self):
        self.assertTrue(self.manifest.get('name'), "Name must be present")
        self.assertTrue(self.manifest.get('version'), "Version must be present")
        self.assertTrue(self.manifest.get('description'), "Description must be present")
        self.assertLessEqual(len(self.manifest.get('description', '')), 132, "Description should be <= 132 chars for CWS")

    def test_icons_exist_and_dimensions(self):
        icons = self.manifest.get('icons', {})
        self.assertIn('16', icons)
        self.assertIn('48', icons)
        self.assertIn('128', icons)

        for size_str, rel_path in icons.items():
            full_path = os.path.join(EXTENSION_DIR, rel_path)
            self.assertTrue(os.path.exists(full_path), f"Icon file {rel_path} does not exist")
            
            # Check PNG dimensions
            with open(full_path, 'rb') as f:
                data = f.read(24)
                self.assertEqual(data[:8], b'\x89PNG\r\n\x1a\n', f"{rel_path} is not a valid PNG")
                w, h = struct.unpack('>LL', data[16:24])
                expected_size = int(size_str)
                self.assertEqual(w, expected_size, f"{rel_path} width is {w}, expected {expected_size}")
                self.assertEqual(h, expected_size, f"{rel_path} height is {h}, expected {expected_size}")

    def test_action_and_popup(self):
        action = self.manifest.get('action', {})
        self.assertIsNotNone(action, "Action must be defined")
        popup_path = action.get('default_popup')
        self.assertTrue(popup_path, "default_popup must be defined")
        self.assertTrue(os.path.exists(os.path.join(EXTENSION_DIR, popup_path)), f"Popup file {popup_path} must exist")

    def test_background_service_worker(self):
        bg = self.manifest.get('background', {})
        sw = bg.get('service_worker')
        self.assertTrue(sw, "service_worker must be defined in background")
        self.assertTrue(os.path.exists(os.path.join(EXTENSION_DIR, sw)), f"Service worker {sw} must exist")

    def test_content_scripts(self):
        cs_list = self.manifest.get('content_scripts', [])
        self.assertGreater(len(cs_list), 0, "At least one content script must be defined")
        for cs in cs_list:
            matches = cs.get('matches', [])
            self.assertTrue(any('classroom.google.com' in m for m in matches), "Matches must include Google Classroom")
            self.assertTrue(any('docs.google.com' in m for m in matches), "Matches must include Google Docs")
            self.assertTrue(any('slides.google.com' in m for m in matches), "Matches must include Google Slides")
            
            for js in cs.get('js', []):
                self.assertTrue(os.path.exists(os.path.join(EXTENSION_DIR, js)), f"Content script JS {js} must exist")
            for css in cs.get('css', []):
                self.assertTrue(os.path.exists(os.path.join(EXTENSION_DIR, css)), f"Content script CSS {css} must exist")

    def test_web_accessible_resources(self):
        war_list = self.manifest.get('web_accessible_resources', [])
        self.assertGreater(len(war_list), 0)
        for war in war_list:
            for r in war.get('resources', []):
                self.assertTrue(os.path.exists(os.path.join(EXTENSION_DIR, r)), f"WAR resource {r} must exist")

    def test_permissions(self):
        perms = self.manifest.get('permissions', [])
        self.assertIn('storage', perms, "Storage permission required")
        self.assertIn('offscreen', perms, "Offscreen permission required")
        self.assertIn('identity', perms, "Identity permission required")

    def test_oauth2_configuration(self):
        oauth = self.manifest.get('oauth2', {})
        self.assertIn('client_id', oauth)
        scopes = oauth.get('scopes', [])
        self.assertIn('https://www.googleapis.com/auth/drive.file', scopes, "Must request drive.file scope for least-privilege")

if __name__ == '__main__':
    unittest.main()
