import os
import re
import unittest

EXTENSION_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class TestPopupAndUDL(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(EXTENSION_DIR, 'popup', 'popup.html'), 'r', encoding='utf-8') as f:
            self.popup_html = f.read()
        with open(os.path.join(EXTENSION_DIR, 'popup', 'popup.js'), 'r', encoding='utf-8') as f:
            self.popup_js = f.read()
        with open(os.path.join(EXTENSION_DIR, 'content', 'content.css'), 'r', encoding='utf-8') as f:
            self.content_css = f.read()
        with open(os.path.join(EXTENSION_DIR, 'popup', 'popup.css'), 'r', encoding='utf-8') as f:
            self.popup_css = f.read()

    def test_popup_element_bindings(self):
        # Ensure all DOM IDs selected in popup.js for popup UI exist in popup.html
        popup_dom_ids = [
            'select-font',
            'select-theme',
            'toggle-shortcuts',
            'toggle-silence',
            'toggle-autostart',
            'select-mic',
            'btn-quick-record',
            'btn-test-mic',
            'mic-meter-fill',
            'mic-test-status'
        ]
        for element_id in popup_dom_ids:
            self.assertIn(f'id="{element_id}"', self.popup_html, f"Element #{element_id} used in popup.js must exist in popup.html")

    def test_microphone_selection_support(self):
        # Verify microphone selection and enumeration logic
        self.assertIn("enumerateDevices", self.popup_js)
        self.assertIn("selectedAudioDeviceId", self.popup_js)
        self.assertIn("devicechange", self.popup_js)
        self.assertIn('value="default"', self.popup_html)
        self.assertIn("Default Microphone", self.popup_html)

    def test_minimum_touch_target_size(self):
        # WCAG 2.2 AAA requires 44px-48px touch targets for accessibility on Chromebooks
        self.assertIn('--vb-min-target: 48px;', self.content_css)
        self.assertIn('min-height: 52px;', self.popup_css)

    def test_font_family_options(self):
        self.assertIn('Lexend', self.content_css)
        self.assertIn('OpenDyslexic', self.content_css)
        self.assertIn('value="lexend"', self.popup_html)
        self.assertIn('value="opendyslexic"', self.popup_html)
        self.assertIn('value="system"', self.popup_html)

    def test_theme_options(self):
        self.assertIn('value="default"', self.popup_html)
        self.assertIn('value="pastel"', self.popup_html)
        self.assertIn('value="high-contrast"', self.popup_html)

    def test_quick_record_dynamic_injection(self):
        self.assertIn("TRIGGER_RECORDING", self.popup_js)
        self.assertIn("chrome.scripting.executeScript", self.popup_js)
        self.assertIn("test-classroom-simulation.html", self.popup_js)

    def test_no_inline_scripts_in_html(self):
        # CSP Compliance: No inline script tags with JS code
        script_tags = re.findall(r'<script\b[^>]*>(.*?)</script>', self.popup_html, re.DOTALL)
        for body in script_tags:
            self.assertEqual(body.strip(), '', "Inline scripts are forbidden under Manifest V3 CSP")

    def test_brand_palette_matches_the_website(self):
        """Extension chrome uses the same brand tokens as voicebridge-ext.web.app
        (--brand-primary #4f46e5 / --brand-primary-hover #4338ca)."""
        with open(os.path.join(EXTENSION_DIR, 'popup', 'popup.css'), 'r', encoding='utf-8') as f:
            popup_css = f.read()

        self.assertIn('--vb-primary: #4f46e5;', self.content_css)
        self.assertIn('--vb-primary-hover: #4338ca;', self.content_css)
        self.assertIn('#4f46e5', popup_css)

        # The old off-brand blue must be gone from both surfaces
        for stale in ('#2563eb', '#1d4ed8'):
            self.assertNotIn(stale, self.content_css)
            self.assertNotIn(stale, popup_css)

        # The player accent derives from the brand token rather than restating it,
        # so themes retint it in one place
        self.assertIn('--vb-player-accent: var(--vb-primary);', self.content_css)
        self.assertIn('--vb-player-speed: var(--vb-primary);', self.content_css)

if __name__ == '__main__':
    unittest.main()
