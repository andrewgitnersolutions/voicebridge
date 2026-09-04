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

    def test_every_declared_resource_exists_on_disk(self):
        """A manifest may not name a file that is not there.

        The dyslexia-friendly font was named in CSS with nothing bundled behind
        it, so the feature silently did nothing on the Chromebooks this product
        runs on. Declaring a path is not the same as shipping the file.
        """
        declared = []
        for entry in self.manifest.get('content_scripts', []):
            declared += entry.get('js', []) + entry.get('css', [])
        for entry in self.manifest.get('web_accessible_resources', []):
            declared += entry.get('resources', [])
        background = self.manifest.get('background', {}).get('service_worker')
        if background:
            declared.append(background)
        action_popup = self.manifest.get('action', {}).get('default_popup')
        if action_popup:
            declared.append(action_popup)
        declared += list(self.manifest.get('icons', {}).values())
        declared += list(self.manifest.get('action', {}).get('default_icon', {}).values())

        missing = [rel for rel in set(declared)
                   if '*' not in rel and not os.path.exists(os.path.join(EXTENSION_DIR, rel))]
        self.assertEqual([], missing, 'manifest.json declares files that do not exist: %r' % missing)

    def test_bundled_font_backs_the_dyslexic_option(self):
        """The OpenDyslexic option must resolve to a real, loadable font."""
        css_path = os.path.join(EXTENSION_DIR, 'content', 'content.css')
        with open(css_path, 'r', encoding='utf-8') as f:
            css = f.read()

        self.assertIn("font-family: 'OpenDyslexic';", css, '@font-face declaration missing')
        self.assertIn("opendyslexic-regular.woff2", css)

        # Every url() in an @font-face must point at a file that exists, resolved
        # relative to the stylesheet the way Chrome resolves it
        import re
        for rel in re.findall(r"src:\s*url\('([^']+)'\)", css):
            resolved = os.path.normpath(os.path.join(EXTENSION_DIR, 'content', rel))
            self.assertTrue(os.path.exists(resolved), 'Font file missing: %s' % rel)
            self.assertGreater(os.path.getsize(resolved), 1024, 'Font file looks empty: %s' % rel)

        # ...and be reachable from the page that uses it
        resources = []
        for entry in self.manifest.get('web_accessible_resources', []):
            resources += entry.get('resources', [])
        self.assertIn('assets/fonts/opendyslexic-regular.woff2', resources,
                      'The font must be web-accessible or the content script cannot load it')

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
        # Main content script covers Google Classroom, Docs, and Slides
        main_matches = cs_list[0].get('matches', [])
        self.assertTrue(any('classroom.google.com' in m for m in main_matches), "Main script must include Google Classroom")
        self.assertTrue(any('docs.google.com' in m for m in main_matches), "Main script must include Google Docs")
        self.assertTrue(any('slides.google.com' in m for m in main_matches), "Main script must include Google Slides")

        for cs in cs_list:
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
