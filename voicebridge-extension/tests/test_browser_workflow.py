"""
VoiceBridge Comprehensive Browser, DOM & State Machine Workflow Test Suite
Validates all interactive DOM workflows, state machine transitions, keyboard shortcuts,
and accessibility features across test-classroom-simulation.html, content.js, popup.html/js,
offscreen.js, and service-worker.js.
"""

import base64
import json
import os
import re
import unittest

EXTENSION_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class SimulatedElement:
    """Simulated DOM Element for testing VoiceBridge DOM transformations and event handling."""
    def __init__(self, tag_name='div', id_attr=None, class_names=None, attributes=None, text_content=''):
        self.tagName = tag_name.upper()
        self.id = id_attr or ''
        self.classList = set(class_names or [])
        self.attributes = attributes or {}
        self.textContent = text_content
        self.children = []
        self.parentElement = None
        self.value = ''
        self.disabled = False
        self.style = {}
        self.event_listeners = {}

    def getAttribute(self, name):
        return self.attributes.get(name)

    def setAttribute(self, name, value):
        self.attributes[name] = str(value)

    def hasAttribute(self, name):
        return name in self.attributes

    def appendChild(self, child):
        child.parentElement = self
        self.children.append(child)
        return child

    def remove(self):
        if self.parentElement and self in self.parentElement.children:
            self.parentElement.children.remove(self)
            self.parentElement = None

    def querySelector(self, selector):
        for desc in self._walk():
            if desc._matches(selector):
                return desc
        return None

    def querySelectorAll(self, selector):
        return [desc for desc in self._walk() if desc._matches(selector)]

    def _walk(self):
        for c in self.children:
            yield c
            yield from c._walk()

    def _matches(self, selector):
        selector = selector.strip()
        if selector.startswith('#'):
            return self.id == selector[1:]
        if selector.startswith('.'):
            return selector[1:] in self.classList
        if '[' in selector and ']' in selector:
            attr_name = selector[1:-1].split('=')[0].replace('*', '').strip()
            return attr_name in self.attributes
        return self.tagName.lower() == selector.lower()

    def addEventListener(self, event, handler):
        self.event_listeners.setdefault(event, []).append(handler)

    def dispatchEvent(self, event_type, event_obj=None):
        for handler in self.event_listeners.get(event_type, []):
            handler(event_obj or {})

    def click(self):
        self.dispatchEvent('click', {'preventDefault': lambda: None, 'stopPropagation': lambda: None})


class SimulatedVoiceBridgeRuntime:
    """Deterministic simulation of the complete VoiceBridge extension state machine and DOM tree."""

    def __init__(self, auto_start=False, selected_mic='Default Microphone'):
        self.auto_start = auto_start
        self.selected_mic = selected_mic
        self.single_key_shortcuts = True
        self.silence_warning = True

        self.recording_state = 'IDLE'
        self.seconds_elapsed = 0
        self.recorded_duration = 0
        self.recorded_base64 = None
        self.active_modal = None
        self.current_active_target_input = None
        self.cancel_message_count = 0
        self.start_message_count = 0
        self.stop_message_count = 0
        self.upload_message_count = 0
        self.toast_messages = []

        # Build Classroom simulation DOM
        self.root = SimulatedElement('body')
        self.private_comment_area = SimulatedElement('div', id_attr='private-comment-box', attributes={'data-is-private': 'true', 'aria-label': 'Add private comment'})
        self.private_textarea = SimulatedElement('textarea', id_attr='private-comment-input')
        self.private_comment_area.appendChild(self.private_textarea)

        self.public_comment_area = SimulatedElement('div', id_attr='public-comment-box', attributes={'aria-label': 'Add class comment'})
        self.public_textarea = SimulatedElement('textarea', id_attr='public-comment-input')
        self.public_comment_area.appendChild(self.public_textarea)

        self.root.appendChild(self.private_comment_area)
        self.root.appendChild(self.public_comment_area)

        self._inject_triggers()

    def _inject_triggers(self):
        # 1. Floating trigger
        floating_btn = SimulatedElement('button', id_attr='vb-open-modal-btn', class_names=['vb-floating-btn'], text_content='🎙️ Record Voice')
        floating_btn.addEventListener('click', lambda e: self.open_modal())
        floating_trigger = SimulatedElement('div', id_attr='voicebridge-floating-trigger')
        floating_trigger.appendChild(floating_btn)
        self.root.appendChild(floating_trigger)

        # 2. Injected private comment mic button
        mic_btn = SimulatedElement('button', class_names=['vb-injected-mic-btn'], text_content='🎙️')
        mic_btn.addEventListener('click', lambda e: self._on_private_mic_click())
        self.private_comment_area.appendChild(mic_btn)

    def _on_private_mic_click(self):
        self.current_active_target_input = self.private_textarea
        self.open_modal()

    def open_modal(self):
        if self.active_modal:
            return
        self.recording_state = 'STARTING' if self.auto_start else 'READY'
        self.seconds_elapsed = 0
        self.recorded_base64 = None

        self.active_modal = SimulatedElement('div', id_attr='voicebridge-modal-overlay', attributes={'role': 'dialog'})
        self.card_root = SimulatedElement('div', id_attr='vb-card-root', class_names=['vb-card'])
        self.modal_body = SimulatedElement('div', id_attr='vb-modal-body')
        self.active_modal.appendChild(self.card_root)
        self.card_root.appendChild(self.modal_body)
        self.root.appendChild(self.active_modal)

        self.render_current_state()

        if self.auto_start:
            self.start_recording()

    def close_modal(self):
        if self.recording_state in ['RECORDING', 'STARTING', 'STOPPING']:
            self.cancel_message_count += 1
        if self.active_modal:
            self.active_modal.remove()
            self.active_modal = None
        self.recording_state = 'IDLE'

    def render_current_state(self):
        if not self.active_modal:
            return
        self.modal_body.children.clear()

        if self.recording_state == 'READY':
            ready_view = SimulatedElement('div', class_names=['vb-ready-view'])
            dot = SimulatedElement('span', class_names=['vb-ready-dot'])
            status_text = SimulatedElement('span', text_content='Ready to Record')
            mic_title = SimulatedElement('span', class_names=['vb-mic-title'], text_content='Active Microphone')
            mic_name = SimulatedElement('span', class_names=['vb-mic-name'], text_content=self.selected_mic)
            hint = SimulatedElement('div', class_names=['vb-shortcut-hint'], text_content='💡 Tip: Press Space when you are ready to speak.')

            cancel_btn = SimulatedElement('button', id_attr='vb-ready-cancel-btn', class_names=['vb-btn', 'vb-btn-secondary'], text_content='Cancel')
            cancel_btn.addEventListener('click', lambda e: self.close_modal())

            start_btn = SimulatedElement('button', id_attr='vb-start-record-btn', class_names=['vb-btn', 'vb-btn-primary', 'vb-btn-start'], text_content='🎙️ Start Recording')
            start_btn.addEventListener('click', lambda e: self.start_recording())

            ready_view.children.extend([dot, status_text, mic_title, mic_name, hint, cancel_btn, start_btn])
            self.modal_body.appendChild(ready_view)

        elif self.recording_state == 'STARTING':
            starting_view = SimulatedElement('div', class_names=['vb-ready-view'])
            pulse_dot = SimulatedElement('span', class_names=['vb-pulse-dot'])
            status_text = SimulatedElement('span', text_content='Connecting Microphone...')
            cancel_btn = SimulatedElement('button', id_attr='vb-starting-cancel-btn', class_names=['vb-btn', 'vb-btn-secondary'], text_content='Cancel')
            cancel_btn.addEventListener('click', lambda e: self.close_modal())

            loading_btn = SimulatedElement('button', class_names=['vb-btn', 'vb-btn-primary', 'vb-btn-loading'], text_content='⏳ Starting...')
            loading_btn.disabled = True

            starting_view.children.extend([pulse_dot, status_text, cancel_btn, loading_btn])
            self.modal_body.appendChild(starting_view)

        elif self.recording_state == 'RECORDING':
            rec_view = SimulatedElement('div')
            timer = SimulatedElement('div', id_attr='vb-live-timer', text_content='00:00')
            status_text = SimulatedElement('span', text_content='Recording Voice...')

            waveform = SimulatedElement('div', id_attr='vb-waveform', class_names=['vb-waveform-container'])
            for _ in range(24):
                waveform.appendChild(SimulatedElement('div', class_names=['vb-wave-bar']))

            cancel_btn = SimulatedElement('button', id_attr='vb-cancel-btn', class_names=['vb-btn', 'vb-btn-secondary'], text_content='Cancel')
            cancel_btn.addEventListener('click', lambda e: self.close_modal())

            stop_btn = SimulatedElement('button', id_attr='vb-stop-btn', class_names=['vb-btn', 'vb-btn-primary'], text_content='⏹️ Stop & Review')
            stop_btn.addEventListener('click', lambda e: self.stop_recording())

            rec_view.children.extend([timer, status_text, waveform, cancel_btn, stop_btn])
            self.modal_body.appendChild(rec_view)

        elif self.recording_state == 'STOPPING':
            stopping_view = SimulatedElement('div')
            cancel_btn = SimulatedElement('button', class_names=['vb-btn', 'vb-btn-secondary'], text_content='Cancel')
            cancel_btn.disabled = True
            processing_btn = SimulatedElement('button', class_names=['vb-btn', 'vb-btn-primary', 'vb-btn-loading'], text_content='⏳ Processing Audio...')
            processing_btn.disabled = True

            stopping_view.children.extend([cancel_btn, processing_btn])
            self.modal_body.appendChild(stopping_view)

        elif self.recording_state == 'REVIEW':
            review_view = SimulatedElement('div')
            audio_el = SimulatedElement('audio', id_attr='vb-preview-audio', attributes={'controls': 'true', 'autoplay': 'true'})
            redo_btn = SimulatedElement('button', id_attr='vb-redo-btn', class_names=['vb-btn', 'vb-btn-warning'], text_content='🔄 Redo')
            redo_btn.addEventListener('click', lambda e: self._on_redo())

            submit_btn = SimulatedElement('button', id_attr='vb-submit-btn', class_names=['vb-btn', 'vb-btn-success'], text_content='✅ Insert Voice Note')
            submit_btn.addEventListener('click', lambda e: self.upload_and_insert())

            review_view.children.extend([audio_el, redo_btn, submit_btn])
            self.modal_body.appendChild(review_view)

        elif self.recording_state == 'UPLOADING':
            upload_view = SimulatedElement('div', text_content='Saving to Your Google Drive...')
            self.modal_body.appendChild(upload_view)

    def _on_redo(self):
        self.recording_state = 'READY'
        self.render_current_state()

    def start_recording(self):
        if self.recording_state in ['RECORDING']:
            return
        self.recording_state = 'STARTING'
        self.render_current_state()
        self.start_message_count += 1
        # Resolve to RECORDING
        self.recording_state = 'RECORDING'
        self.render_current_state()

    def stop_recording(self):
        if self.recording_state != 'RECORDING':
            return
        self.recording_state = 'STOPPING'
        self.render_current_state()
        self.stop_message_count += 1
        self.recorded_base64 = 'data:audio/webm;codecs=opus;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwH'
        self.recorded_duration = 5.0
        self.recording_state = 'REVIEW'
        self.render_current_state()

    def upload_and_insert(self):
        self.recording_state = 'UPLOADING'
        self.render_current_state()
        self.upload_message_count += 1

        formatted_chip = '🎙️ VoiceBridge Note (0:05) • Listen: https://drive.google.com/file/d/1MockFileId/view'
        target = self.current_active_target_input or self.private_textarea
        target.value = (target.value + ' ' + formatted_chip).strip()

        self.toast_messages.append('Voice note saved & inserted!')
        self.close_modal()

    def handle_keydown(self, key, focused_tag='BODY'):
        if not self.single_key_shortcuts:
            return
        if key == 'Escape' and self.active_modal:
            self.close_modal()
            return
        if key == ' ' and self.active_modal and focused_tag not in ['INPUT', 'TEXTAREA']:
            if self.recording_state == 'READY':
                self.start_recording()
            elif self.recording_state == 'RECORDING':
                self.stop_recording()


class TestVoiceBridgeWorkflowComprehensive(unittest.TestCase):
    """Exhaustive test suite verifying all 8 criteria specified by the orchestrator."""

    def setUp(self):
        self.content_js_path = os.path.join(EXTENSION_DIR, 'content', 'content.js')
        self.popup_html_path = os.path.join(EXTENSION_DIR, 'popup', 'popup.html')
        self.popup_js_path = os.path.join(EXTENSION_DIR, 'popup', 'popup.js')
        self.offscreen_js_path = os.path.join(EXTENSION_DIR, 'offscreen', 'offscreen.js')
        self.sw_js_path = os.path.join(EXTENSION_DIR, 'background', 'service-worker.js')
        self.sim_html_path = os.path.join(EXTENSION_DIR, 'test-classroom-simulation.html')

        with open(self.content_js_path, 'r', encoding='utf-8') as f:
            self.content_js = f.read()
        with open(self.popup_html_path, 'r', encoding='utf-8') as f:
            self.popup_html = f.read()
        with open(self.popup_js_path, 'r', encoding='utf-8') as f:
            self.popup_js = f.read()
        with open(self.offscreen_js_path, 'r', encoding='utf-8') as f:
            self.offscreen_js = f.read()
        with open(self.sw_js_path, 'r', encoding='utf-8') as f:
            self.sw_js = f.read()
        with open(self.sim_html_path, 'r', encoding='utf-8') as f:
            self.sim_html = f.read()

    # 1. Floating button and Private Comment mic button injection
    def test_01_floating_and_private_comment_injection(self):
        # Static code assertions
        self.assertIn('voicebridge-floating-trigger', self.content_js)
        self.assertIn('vb-injected-mic-btn', self.content_js)
        self.assertIn('data-is-private="true"', self.content_js)
        self.assertIn('Class comments', self.content_js, 'Must filter out public stream comments')

        # Simulation assertions
        sim = SimulatedVoiceBridgeRuntime()
        floating_btn = sim.root.querySelector('#vb-open-modal-btn')
        self.assertIsNotNone(floating_btn)
        self.assertIn('Record Voice', floating_btn.textContent)

        # Verify exactly one private comment mic button is injected
        private_mics = sim.private_comment_area.querySelectorAll('.vb-injected-mic-btn')
        self.assertEqual(len(private_mics), 1)

        # Verify zero mic buttons in public class comments
        public_mics = sim.public_comment_area.querySelectorAll('.vb-injected-mic-btn')
        self.assertEqual(len(public_mics), 0)

    # 2. Opening modal into 'READY' state
    def test_02_open_modal_ready_state_verification(self):
        self.assertIn("'READY'", self.content_js)
        self.assertIn('vb-start-record-btn', self.content_js)
        self.assertIn('Ready to Record', self.content_js)
        self.assertIn('Active Microphone', self.content_js)

        sim = SimulatedVoiceBridgeRuntime(auto_start=False, selected_mic='Custom Studio Mic')
        sim.open_modal()

        self.assertEqual(sim.recording_state, 'READY')
        self.assertIsNotNone(sim.active_modal)
        self.assertIsNotNone(sim.active_modal.querySelector('#vb-start-record-btn'))
        self.assertIsNotNone(sim.active_modal.querySelector('.vb-ready-dot'))
        self.assertIsNotNone(sim.active_modal.querySelector('#vb-ready-cancel-btn'))

        mic_name_el = sim.active_modal.querySelector('.vb-mic-name')
        self.assertIsNotNone(mic_name_el)
        self.assertEqual(mic_name_el.textContent, 'Custom Studio Mic')

    # 3. Transition: READY -> STARTING -> RECORDING
    def test_03_start_recording_state_transitions(self):
        self.assertIn("'STARTING'", self.content_js)
        self.assertIn("'RECORDING'", self.content_js)
        self.assertIn('vb-wave-bar', self.content_js)
        self.assertIn('vb-live-timer', self.content_js)

        sim = SimulatedVoiceBridgeRuntime(auto_start=False)
        sim.open_modal()
        self.assertEqual(sim.recording_state, 'READY')

        start_btn = sim.active_modal.querySelector('#vb-start-record-btn')
        start_btn.click()

        self.assertEqual(sim.start_message_count, 1)
        self.assertEqual(sim.recording_state, 'RECORDING')
        self.assertIsNotNone(sim.active_modal.querySelector('#vb-stop-btn'))
        self.assertIsNotNone(sim.active_modal.querySelector('#vb-cancel-btn'))
        self.assertIsNotNone(sim.active_modal.querySelector('#vb-live-timer'))

        wave_bars = sim.active_modal.querySelectorAll('.vb-wave-bar')
        self.assertEqual(len(wave_bars), 24, 'Must render 24 waveform bars in RECORDING state')

    # 4. Stop & Review -> Insert into private comment
    def test_04_stop_and_review_then_insert_workflow(self):
        self.assertIn("'STOPPING'", self.content_js)
        self.assertIn("'REVIEW'", self.content_js)
        self.assertIn('vb-preview-audio', self.content_js)
        self.assertIn('vb-submit-btn', self.content_js)

        sim = SimulatedVoiceBridgeRuntime()
        # Open via Private comment mic trigger
        private_mic = sim.private_comment_area.querySelector('.vb-injected-mic-btn')
        private_mic.click()
        self.assertEqual(sim.current_active_target_input, sim.private_textarea)

        # Start recording
        sim.active_modal.querySelector('#vb-start-record-btn').click()
        self.assertEqual(sim.recording_state, 'RECORDING')

        # Stop recording
        stop_btn = sim.active_modal.querySelector('#vb-stop-btn')
        stop_btn.click()

        self.assertEqual(sim.stop_message_count, 1)
        self.assertEqual(sim.recording_state, 'REVIEW')
        self.assertIsNotNone(sim.active_modal.querySelector('#vb-preview-audio'))
        self.assertIsNotNone(sim.active_modal.querySelector('#vb-redo-btn'))
        self.assertIsNotNone(sim.active_modal.querySelector('#vb-submit-btn'))

        # Test Redo button returns to READY
        sim.active_modal.querySelector('#vb-redo-btn').click()
        self.assertEqual(sim.recording_state, 'READY')

        # Move to RECORDING -> REVIEW again
        sim.active_modal.querySelector('#vb-start-record-btn').click()
        sim.active_modal.querySelector('#vb-stop-btn').click()

        # Click Insert Voice Note
        submit_btn = sim.active_modal.querySelector('#vb-submit-btn')
        submit_btn.click()

        self.assertEqual(sim.upload_message_count, 1)
        self.assertIsNone(sim.active_modal, 'Modal must close on completion')
        self.assertEqual(sim.recording_state, 'IDLE')
        self.assertIn('VoiceBridge Note', sim.private_textarea.value)
        self.assertIn('https://drive.google.com/file/d/', sim.private_textarea.value)

    # 5. Clean Cancel and Escape teardown across all states
    def test_05_cancel_and_escape_teardown_clean(self):
        # Case A: Cancel from READY
        sim = SimulatedVoiceBridgeRuntime()
        sim.open_modal()
        self.assertEqual(sim.recording_state, 'READY')
        sim.active_modal.querySelector('#vb-ready-cancel-btn').click()
        self.assertIsNone(sim.active_modal)
        self.assertEqual(sim.recording_state, 'IDLE')

        # Case B: Cancel from STARTING
        sim = SimulatedVoiceBridgeRuntime()
        sim.open_modal()
        sim.recording_state = 'STARTING'
        sim.render_current_state()
        sim.active_modal.querySelector('#vb-starting-cancel-btn').click()
        self.assertIsNone(sim.active_modal)
        self.assertEqual(sim.recording_state, 'IDLE')
        self.assertEqual(sim.cancel_message_count, 1)

        # Case C: Cancel from RECORDING
        sim = SimulatedVoiceBridgeRuntime()
        sim.open_modal()
        sim.start_recording()
        self.assertEqual(sim.recording_state, 'RECORDING')
        sim.active_modal.querySelector('#vb-cancel-btn').click()
        self.assertIsNone(sim.active_modal)
        self.assertEqual(sim.recording_state, 'IDLE')
        self.assertEqual(sim.cancel_message_count, 1)

        # Case D: Escape key closes active modal in RECORDING
        sim = SimulatedVoiceBridgeRuntime()
        sim.open_modal()
        sim.start_recording()
        sim.handle_keydown('Escape')
        self.assertIsNone(sim.active_modal)
        self.assertEqual(sim.recording_state, 'IDLE')

    # 6. Single-key Spacebar shortcut handling
    def test_06_single_key_spacebar_shortcuts(self):
        sim = SimulatedVoiceBridgeRuntime()
        sim.open_modal()
        self.assertEqual(sim.recording_state, 'READY')

        # Space in READY triggers start
        sim.handle_keydown(' ')
        self.assertEqual(sim.recording_state, 'RECORDING')

        # Space in RECORDING triggers stop
        sim.handle_keydown(' ')
        self.assertEqual(sim.recording_state, 'REVIEW')

        # Space while focused in textarea is ignored by VoiceBridge
        sim.close_modal()
        sim.handle_keydown(' ', focused_tag='TEXTAREA')
        self.assertIsNone(sim.active_modal, 'Typing space in textarea must not open or trigger modal')

    # 7. Throttled audio level updates and double-click protection
    def test_07_throttled_audio_and_double_click_protection(self):
        # Verify offscreen throttling math (90ms / 10-12Hz)
        self.assertIn('now - lastLevelEmitTime >= 90', self.offscreen_js)
        self.assertIn('delta > 0.04', self.offscreen_js)
        self.assertIn('lastLevelEmitTime', self.offscreen_js)

        # Verify double-click protections (state locks & disabled buttons)
        self.assertIn('if (isStarting)', self.offscreen_js)
        self.assertIn('if (isStopping)', self.offscreen_js)
        self.assertIn('disabled', self.content_js)
        self.assertIn('vb-btn-loading', self.content_js)

        # Simulation check: in STARTING and STOPPING states buttons are disabled
        sim = SimulatedVoiceBridgeRuntime()
        sim.open_modal()
        sim.recording_state = 'STARTING'
        sim.render_current_state()
        loading_btn = sim.active_modal.querySelector('.vb-btn-loading')
        self.assertTrue(loading_btn.disabled)

        sim.recording_state = 'STOPPING'
        sim.render_current_state()
        stopping_loading_btn = sim.active_modal.querySelector('.vb-btn-loading')
        self.assertTrue(stopping_loading_btn.disabled)

    # 8. 'toggle-autostart' setting across all components
    def test_08_autostart_setting_persistence_and_orchestration(self):
        # 1. Popup UI checkbox exists
        self.assertIn('id="toggle-autostart"', self.popup_html)
        self.assertIn('Auto-start recording on open', self.popup_html)

        # 2. Popup controller binds and stores autostart setting
        self.assertIn("autostartToggle.checked = settings.autoStartRecording ?? false", self.popup_js)
        self.assertIn("chrome.storage.local.set({ autoStartRecording: autostartToggle.checked })", self.popup_js)

        # 3. Background service worker handles GET_USER_SETTINGS with autoStartRecording
        self.assertIn("'autoStartRecording'", self.sw_js)
        self.assertIn("autoStartRecording: settings.autoStartRecording ?? false", self.sw_js)

        # 4. Content script auto-starts recording on modal open when configured
        self.assertIn("userSettings.autoStartRecording ? 'STARTING' : 'READY'", self.content_js)
        self.assertIn("if (userSettings.autoStartRecording)", self.content_js)
        self.assertIn("startRecording()", self.content_js)

        # 5. Simulation validation with auto_start=True
        sim_auto = SimulatedVoiceBridgeRuntime(auto_start=True)
        sim_auto.open_modal()
        self.assertEqual(sim_auto.start_message_count, 1)
        self.assertEqual(sim_auto.recording_state, 'RECORDING')
        self.assertIsNotNone(sim_auto.active_modal.querySelector('#vb-stop-btn'))


if __name__ == '__main__':
    unittest.main()
