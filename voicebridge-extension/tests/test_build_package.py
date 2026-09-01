import os
import unittest
import zipfile

EXTENSION_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class TestBuildPackage(unittest.TestCase):
    def test_dist_zip_package(self):
        import json
        with open(os.path.join(EXTENSION_DIR, 'manifest.json'), 'r', encoding='utf-8') as f:
            version = json.load(f).get('version', '1.1.0')
        zip_path = os.path.join(EXTENSION_DIR, 'dist', f'voicebridge-v{version}.zip')
        self.assertTrue(os.path.exists(zip_path), f"Built package {zip_path} should exist")

        with zipfile.ZipFile(zip_path, 'r') as z:
            file_list = z.namelist()

            # Must contain core extension files
            required_files = [
                'manifest.json',
                'background/service-worker.js',
                'offscreen/offscreen.html',
                'offscreen/offscreen.js',
                'content/content.js',
                'content/content.css',
                'content/player.js',
                'popup/popup.html',
                'popup/popup.js',
                'popup/popup.css',
                'permissions/permission.html',
                'permissions/permission.js',
                'player/listen.html',
                'player/listen.js',
                'icons/icon-16.png',
                'icons/icon-48.png',
                'icons/icon-128.png'
            ]
            for req in required_files:
                self.assertIn(req, file_list, f"ZIP missing required file: {req}")

            # Disallowed files that must not be in CWS zip
            disallowed_patterns = ['.DS_Store', 'CHROMEWEBSTORE.md', 'README.md', 'tests/', '.git']
            for pattern in disallowed_patterns:
                for item in file_list:
                    self.assertNotIn(pattern, item, f"ZIP contains disallowed file/folder: {item}")

if __name__ == '__main__':
    unittest.main()
