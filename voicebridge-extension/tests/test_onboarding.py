import json
import os
import unittest

EXTENSION_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class TestOnboarding(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(EXTENSION_DIR, 'manifest.json'), 'r', encoding='utf-8') as f:
            self.manifest = json.load(f)
        with open(os.path.join(EXTENSION_DIR, 'content', 'onboarding.js'), 'r', encoding='utf-8') as f:
            self.onboarding_js = f.read()
        with open(os.path.join(EXTENSION_DIR, 'content', 'onboarding.css'), 'r', encoding='utf-8') as f:
            self.onboarding_css = f.read()
        with open(os.path.join(EXTENSION_DIR, 'content', 'content.js'), 'r', encoding='utf-8') as f:
            self.content_js = f.read()
        with open(os.path.join(EXTENSION_DIR, 'content', 'content.css'), 'r', encoding='utf-8') as f:
            self.content_css = f.read()
        with open(os.path.join(EXTENSION_DIR, 'content', 'forms-readaloud.js'), 'r', encoding='utf-8') as f:
            self.forms_readaloud_js = f.read()
        with open(os.path.join(EXTENSION_DIR, 'popup', 'popup.html'), 'r', encoding='utf-8') as f:
            self.popup_html = f.read()
        with open(os.path.join(EXTENSION_DIR, 'popup', 'popup.js'), 'r', encoding='utf-8') as f:
            self.popup_js = f.read()

    def test_manifest_load_order_and_file_declarations(self):
        """Manifest content_scripts must preserve player.js first and include onboarding files."""
        cs = self.manifest['content_scripts'][0]
        js_files = cs['js']
        css_files = cs['css']

        self.assertIn('content/onboarding.js', js_files)
        self.assertIn('content/onboarding.css', css_files)

        # Invariant: player.js must run before content.js
        player_idx = js_files.index('content/player.js')
        onboarding_idx = js_files.index('content/onboarding.js')
        content_idx = js_files.index('content/content.js')

        self.assertLess(player_idx, content_idx, "player.js must load before content.js")
        self.assertLess(onboarding_idx, content_idx, "onboarding.js must load before content.js")

        # Must also be declared in web_accessible_resources
        war = self.manifest['web_accessible_resources'][0]['resources']
        self.assertIn('content/onboarding.css', war)

    def test_manifest_forms_declares_onboarding_css(self):
        """Manifest must include content/onboarding.css for Google Forms content script."""
        forms_cs = None
        for cs in self.manifest['content_scripts']:
            if any('forms' in match for match in cs.get('matches', [])):
                forms_cs = cs
                break
        self.assertIsNotNone(forms_cs, "Google Forms content_script must be declared in manifest")
        self.assertIn('content/onboarding.css', forms_cs.get('css', []))

    def test_onboarding_state_machine_steps(self):
        """All 6 confirmed workflow steps must be defined in onboarding.js."""
        steps = [
            'FLOATING_TRIGGER',
            'MODAL_START',
            'MODAL_SPEAK',
            'MODAL_REVIEW',
            'PASTE_INSTRUCTION',
            'INTRODUCE_INBOX'
        ]
        for step in steps:
            self.assertIn(step, self.onboarding_js, f"Onboarding state machine must include step {step}")

    def test_comment_onboarding_state_machine_steps(self):
        """Comment onboarding steps must be defined in onboarding.js."""
        comment_steps = [
            'PROMPT_OPEN_COMMENT',
            'COMMENT_MIC',
            'COMMENT_RECORDING',
            'COMMENT_SUBMIT'
        ]
        for step in comment_steps:
            self.assertIn(step, self.onboarding_js, f"Comment state machine must include step {step}")

    def test_comment_onboarding_storage_and_scaffolding(self):
        """Comment onboarding must track count under vb_comment_onboarding_count across 3 sessions."""
        self.assertIn('vb_comment_onboarding_count', self.onboarding_js)
        self.assertIn('getCommentCompletedCount', self.onboarding_js)
        self.assertIn('incrementCommentCompletedCount', self.onboarding_js)

    def test_comment_onboarding_hooks_in_content_js(self):
        """content.js must call comment onboarding lifecycle notifications."""
        self.assertIn('notifyInboxRecordingStarted', self.content_js)
        self.assertIn('notifyInboxRecordingCancelled', self.content_js)
        self.assertIn('notifyInboxRecordingFinished', self.content_js)
        self.assertIn('notifyInboxButtonsUpdated', self.content_js)

    def test_forms_readaloud_onboarding_integration(self):
        """forms-readaloud.js must include onboarding logic, storage key, and replay listener."""
        self.assertIn('vb_forms_onboarding_count', self.forms_readaloud_js)
        self.assertIn('MAX_FORMS_ONBOARDING_SESSIONS', self.forms_readaloud_js)
        self.assertIn('VoiceBridgeFormsOnboarding', self.forms_readaloud_js)
        self.assertIn('showFormsTour', self.forms_readaloud_js)
        self.assertIn('showFormsFadedTip', self.forms_readaloud_js)
        self.assertIn('RESTART_ONBOARDING', self.forms_readaloud_js)

    def test_onboarding_three_session_counter_cap(self):
        """The onboarding flow must be scaffolded across exactly 3 sessions."""
        self.assertIn('MAX_ONBOARDING_SESSIONS = 3', self.onboarding_js)
        self.assertIn('vb_onboarding_completed_count', self.onboarding_js)

    def test_accessible_speech_synthesis_read_aloud(self):
        """Must use browser-native Web Speech API with an accessible speech rate."""
        self.assertIn('speechSynthesis', self.onboarding_js)
        self.assertIn('SpeechSynthesisUtterance', self.onboarding_js)
        self.assertIn('utterance.rate = 0.9', self.onboarding_js)
        self.assertIn('vb-onboard-tts-btn', self.onboarding_js)

    def test_motor_accessibility_minimum_touch_target(self):
        """Touch targets must meet WCAG 2.2 AAA standard (48px) for SpEd students on Chromebooks."""
        self.assertIn('--vb-onboard-min-target: 48px;', self.onboarding_css)
        self.assertIn('min-height: var(--vb-onboard-min-target);', self.onboarding_css)
        self.assertIn('min-width: var(--vb-onboard-min-target);', self.onboarding_css)

    def test_udl_theme_and_font_support(self):
        """Styles must support high contrast (yellow on black) and dyslexic typography."""
        self.assertIn('vb-theme-high-contrast', self.onboarding_css)
        self.assertIn('#ffff00', self.onboarding_css)
        self.assertIn('#000000', self.onboarding_css)
        self.assertIn('vb-font-dyslexic', self.onboarding_css)
        self.assertIn('OpenDyslexic', self.onboarding_css)

    def test_no_forbidden_stale_blues_in_onboarding_css(self):
        """Onboarding stylesheet must not contain legacy off-brand blues."""
        for stale in ('#2563eb', '#1d4ed8'):
            self.assertNotIn(stale, self.onboarding_css, f"Forbidden legacy blue {stale} found in onboarding.css")

    def test_google_docs_comment_focus_protection(self):
        """Mousedown events on onboarding cards must prevent default to keep Docs comments open."""
        self.assertIn("activeCard.addEventListener('mousedown', (e) => {", self.onboarding_js)
        self.assertIn("e.preventDefault()", self.onboarding_js)

    def test_popup_replay_onboarding_controls(self):
        """Popup must provide a button to reset and replay the 3-session guidance for teachers."""
        self.assertIn('id="btn-replay-onboarding"', self.popup_html)
        self.assertIn('id="replay-guide-status"', self.popup_html)
        self.assertIn('btn-replay-onboarding', self.popup_js)
        self.assertIn('vb_onboarding_completed_count', self.popup_js)
        self.assertIn('vb_comment_onboarding_count', self.popup_js)
        self.assertIn('vb_forms_onboarding_count', self.popup_js)
        self.assertIn('RESTART_ONBOARDING', self.popup_js)

    def test_content_script_onboarding_hooks(self):
        """content.js must notify onboarding on modal open, record start/stop, and completion."""
        self.assertIn('notifyModalOpened', self.content_js)
        self.assertIn('notifyRecordingStarted', self.content_js)
        self.assertIn('notifyRecordingStopped', self.content_js)
        self.assertIn('notifyRecordingFinished', self.content_js)
        self.assertIn('notifyInboxButtonsUpdated', self.content_js)

    def test_modal_onboarding_centering_and_position_tracking(self):
        """In-modal onboarding card must be vertically centered, dynamically tracked, with no scale distortion."""
        self.assertIn('modalCenterTop', self.onboarding_js)
        self.assertIn('modalRect.height - cardHeight', self.onboarding_js)
        self.assertIn('startTrackingTarget', self.onboarding_js)
        self.assertIn('stopTracking', self.onboarding_js)
        self.assertIn('requestAnimationFrame', self.onboarding_js)
        self.assertIn('ResizeObserver', self.onboarding_js)
        # Verify vbFadeIn does not distort getBoundingClientRect with scale
        self.assertIn('@keyframes vbFadeIn {\n  from { opacity: 0; }\n  to { opacity: 1; }\n}', self.content_css)
        # Verify in-modal spotlight snaps without transition drift
        self.assertIn('transition: none !important;', self.onboarding_css)
        self.assertIn('border-radius: 14px !important;', self.onboarding_css)

    def test_hint_sequencing_and_mutual_exclusion(self):
        """Hint 2 must suggest leaving a voice comment without showing the large button hint, and hints must never overlap."""
        # Ensure sequential branching in startOnboarding for Docs/Classroom
        self.assertIn('modalCount === 0', self.onboarding_js)
        self.assertIn('commentCount === 0', self.onboarding_js)
        # Ensure renderFadedScaffolding guards against activePromptBanner and activeOverlay
        self.assertIn('activePromptBanner', self.onboarding_js)
        self.assertIn('activeOverlay || activePromptBanner', self.onboarding_js)
        # Ensure showOpenCommentPrompt removes any activeFadedTip and suppresses trigger pulse
        self.assertIn('vb-trigger-pulse-badge', self.onboarding_js)
        self.assertIn("floatingBtn.classList.remove('vb-trigger-pulse-badge')", self.onboarding_js)
        # Ensure prompt banner sits cleanly 144px from bottom above floating trigger
        self.assertIn('bottom: 144px !important;', self.onboarding_css)
        # Ensure Hint 2 badge is declared
        self.assertIn('Hint 2 • Voice Comment', self.onboarding_js)

    def test_comment_scaffolding_placement_above_and_debounced(self):
        """Comment guidance must be placed above the comment box to avoid blocking clicks, and debounced."""
        self.assertIn('findActiveCommentBox', self.onboarding_js)
        self.assertIn('targetRect.top - tipHeight - margin', self.onboarding_js)
        self.assertIn('boxRect.top - cardHeight - margin', self.onboarding_js)
        self.assertIn('commentScaffoldingTimer', self.onboarding_js)
        self.assertIn('commentTourTimer', self.onboarding_js)
        self.assertIn('clearCommentTimers', self.onboarding_js)

if __name__ == '__main__':
    unittest.main()
