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
                'icons/icon-128.png',
                'assets/fonts/opendyslexic-regular.woff2',
                'assets/fonts/opendyslexic-bold.woff2'
            ]
            for req in required_files:
                self.assertIn(req, file_list, f"ZIP missing required file: {req}")

            # Every file the code asks Chrome for at runtime must be in the
            # package. Two shipped code paths already pointed at files that were
            # never packaged: the OpenDyslexic @font-face, and a Quick Record
            # fallback that opened a developer test fixture — a blank 404 in any
            # real install. Neither failed a test, because neither is a syntax
            # error; they only fail for users.
            import re
            referenced = set()
            for root, dirs, files in os.walk(EXTENSION_DIR):
                dirs[:] = [d for d in dirs if d not in
                           ('node_modules', 'dist', '.git', '__pycache__', 'tests', 'store-assets')]
                for name in files:
                    if not name.endswith(('.js', '.html')):
                        continue
                    with open(os.path.join(root, name), 'r', encoding='utf-8') as fh:
                        body = fh.read()
                    for match in re.findall(r"getURL\(\s*[`'\"]([^`'\"]+)", body):
                        referenced.add(match.split('?')[0].split('#')[0])

            missing = sorted(r for r in referenced if r and r not in file_list)
            self.assertEqual(
                [], missing,
                'Code calls chrome.runtime.getURL() for files the package does not '
                'contain, so they 404 for every user: %r' % missing
            )

            # Disallowed files that must not be in CWS zip
            disallowed_patterns = ['.DS_Store', 'CHROMEWEBSTORE.md', 'README.md', 'tests/', '.git']
            for pattern in disallowed_patterns:
                for item in file_list:
                    self.assertNotIn(pattern, item, f"ZIP contains disallowed file/folder: {item}")

if __name__ == '__main__':
    unittest.main()
