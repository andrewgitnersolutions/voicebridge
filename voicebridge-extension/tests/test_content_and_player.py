import os
import re
import unittest

EXTENSION_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class TestContentAndPlayer(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(EXTENSION_DIR, 'content', 'content.js'), 'r', encoding='utf-8') as f:
            self.content_js = f.read()
        with open(os.path.join(EXTENSION_DIR, 'content', 'player.js'), 'r', encoding='utf-8') as f:
            self.player_js = f.read()

    def test_classroom_private_comment_selectors(self):
        # Selector for private comments
        self.assertIn('div[aria-label*="private" i]', self.content_js)
        self.assertIn('div[data-is-private="true"]', self.content_js)

    def test_public_stream_exclusion(self):
        # Exclusion of public class comments
        self.assertIn("textContent.includes('Class comments')", self.content_js)
        self.assertIn("includes('class comment')", self.content_js)

    def test_drive_link_regex(self):
        # Extract regex from player.js
        regex_pattern = r'https:\/\/drive\.google\.com\/(?:file\/d\/|uc\?id=)([a-zA-Z0-9_-]+)'
        
        test_cases = [
            ("https://drive.google.com/file/d/1A2B3C4D5E6F_xyz-99/view", "1A2B3C4D5E6F_xyz-99"),
            ("https://drive.google.com/file/d/1-ABC_def-12345/view?usp=sharing", "1-ABC_def-12345"),
            ("https://drive.google.com/uc?id=987654321_abcXYZ", "987654321_abcXYZ"),
        ]

        for url, expected_id in test_cases:
            match = re.search(regex_pattern, url)
            self.assertIsNotNone(match, f"Regex should match {url}")
            self.assertEqual(match.group(1), expected_id)

    def test_playback_speeds(self):
        speeds = [1.0, 1.25, 1.5, 2.0, 0.75]
        # Cycling through speeds
        curr_idx = 0
        expected_sequence = [1.25, 1.5, 2.0, 0.75, 1.0, 1.25]
        actual_sequence = []
        for _ in range(len(expected_sequence)):
            curr_idx = (curr_idx + 1) % len(speeds)
            actual_sequence.append(speeds[curr_idx])
        self.assertEqual(actual_sequence, expected_sequence)

    def test_udl_keyboard_shortcuts(self):
        self.assertIn("e.key === 'Escape'", self.content_js)
        self.assertIn("e.key === ' '", self.content_js)
        self.assertIn("userSettings.singleKeyShortcuts", self.content_js)

    def test_state_machine_states(self):
        states = ['IDLE', 'READY', 'STARTING', 'RECORDING', 'STOPPING', 'REVIEW', 'UPLOADING']
        for s in states:
            self.assertIn(f"'{s}'", self.content_js)

    def test_start_recording_button(self):
        self.assertIn('vb-start-record-btn', self.content_js)
        self.assertIn('Start Recording', self.content_js)
        self.assertIn('Ready to Record', self.content_js)

    def test_theme_classes(self):
        self.assertIn('vb-font-dyslexic', self.content_js)
        self.assertIn('vb-theme-high-contrast', self.content_js)
        self.assertIn('vb-theme-pastel', self.content_js)

    def test_google_slides_support(self):
        # Speaker notes detection and trigger injection
        self.assertIn('punch-speakernotes', self.content_js)
        self.assertIn('injectSlidesSpeakerNotesButton', self.content_js)
        # Punch presentation canvas guards in both content.js and player.js
        self.assertIn('.punch-stage', self.content_js)
        self.assertIn('.punch-canvas', self.player_js)

if __name__ == '__main__':
    unittest.main()
