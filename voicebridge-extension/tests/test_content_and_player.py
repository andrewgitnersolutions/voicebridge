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
        with open(os.path.join(EXTENSION_DIR, 'content', 'content.css'), 'r', encoding='utf-8') as f:
            self.content_css = f.read()

    def test_classroom_private_comment_selectors(self):
        # Selector for private comments
        self.assertIn('div[aria-label*="private" i]', self.content_js)
        self.assertIn('div[data-is-private="true"]', self.content_js)

    def _js_string_array(self, name):
        """Read a JS string-array literal out of content.js as real Python data.

        The word lists ARE the guard, so the tests assert on the shipped lists
        rather than on a Python re-implementation of the matching.
        """
        start = self.content_js.index('const %s = [' % name)
        end = self.content_js.index('];', start)
        return re.findall(r"'([^']*)'", self.content_js[start:end])

    def test_public_stream_exclusion(self):
        # Exclusion of public class comments, in the locales users actually run
        stream_words = self._js_string_array('CLASS_STREAM_WORDS')
        self.assertIn('class comment', stream_words)
        self.assertIn('if (IS_CLASSROOM && !isPrivateClassroomSurface(el)) return true;', self.content_js)

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
        # Speaker notes are one of the in-box recorder's targets
        self.assertIn('punch-speakernotes', self.content_js)
        self.assertIn('collectInboxTargets', self.content_js)
        # Punch canvas guards live in the one shared constant
        self.assertIn('.punch-stage', self._canvas_guard())
        self.assertIn('.punch-canvas', self._canvas_guard())

    def test_gdoc_comment_card_structure(self):
        # Google Docs comment card container and header
        self.assertIn('vb-gdoc-comment-card', self.player_js)
        self.assertIn('vb-gdoc-comment-header', self.player_js)
        self.assertIn('vb-gdoc-avatar', self.player_js)
        self.assertIn('vb-gdoc-author-meta', self.player_js)
        self.assertIn('vb-gdoc-menu-btn', self.player_js)

    def test_play_and_rewind_buttons(self):
        # Exactly two controls: Rewind 5s and Play/Pause
        self.assertIn('vb-gdoc-play-btn', self.player_js)
        self.assertIn('vb-gdoc-rewind-btn', self.player_js)
        self.assertIn('REWIND_SECONDS = 5', self.player_js)
        self.assertIn('rewindBtn.addEventListener', self.player_js)
        self.assertIn('audio.currentTime - REWIND_SECONDS', self.player_js)
        # No third control in the cluster
        self.assertNotIn('vb-gdoc-forward-btn', self.player_js)
        self.assertNotIn('SKIP_SECONDS', self.player_js)
        self.assertEqual(self.player_js.count('controlsRow.appendChild'), 2)

    def test_hide_raw_comment_text(self):
        # Hides raw comment text so only the Google Docs player is visible
        self.assertIn('vb-hide-raw-text', self.player_js)
        self.assertIn('hideRawCommentContent', self.player_js)
        self.assertIn("style.display = 'none'", self.player_js)

    def test_in_page_playback_no_separate_tab(self):
        # Verify audio stays 100% in-page and never opens Drive tabs
        self.assertNotIn('window.open', self.player_js, "player.js must never call window.open to keep user in page")
        self.assertIn('FETCH_DRIVE_AUDIO', self.player_js)

    # --- Voice comment bubble ---

    def test_player_exposes_reusable_card_factory(self):
        # content.js builds the post-recording bubble from the same component
        self.assertIn('window.VoiceBridgePlayer', self.player_js)
        self.assertIn('createPlayerCard', self.player_js)
        self.assertIn('createPlayerCard: createPlayerCard', self.player_js)

    def test_bubble_control_cluster(self):
        # Rewind 5s alongside the big Play/Pause circle
        self.assertIn('vb-gdoc-circle-btn', self.player_js)
        self.assertIn('vb-bubble-variant', self.player_js)
        # Local blob playback skips the Drive round-trip for a just-made recording
        self.assertIn('localSrc', self.player_js)

    def test_card_control_surface_exposed(self):
        # content.js drives the card through this handle (focus, teardown)
        self.assertIn('__voicebridgeControls', self.player_js)
        self.assertIn('focusPlay', self.player_js)
        self.assertIn('destroy', self.player_js)

    def test_bubble_opens_after_recording(self):
        self.assertIn('showVoiceCommentBubble', self.content_js)
        self.assertIn('dismissVoiceCommentBubble', self.content_js)
        # The bubble is opened from the successful upload path
        upload_idx = self.content_js.index('UPLOAD_TO_DRIVE')
        bubble_idx = self.content_js.index('showVoiceCommentBubble(', upload_idx)
        self.assertGreater(bubble_idx, upload_idx)
        # Audio is captured before closeModal() clears the recording state
        self.assertIn('const savedAudioBase64 = recordedAudioBase64;', self.content_js)

    def test_bubble_is_dismissable(self):
        # Close button, Escape, and outside click all tear the bubble down
        self.assertIn("e.key === 'Escape' && activeVoiceBubble", self.content_js)
        self.assertIn('onOutsideClick', self.content_js)
        self.assertIn('URL.revokeObjectURL(bubble.blobUrl)', self.content_js)
        self.assertIn('onDismiss', self.player_js)

    def test_bubble_anchors_to_the_floating_button(self):
        # The bubble only appears for flows with no comment box, which start from
        # the floating Record button
        self.assertIn("getElementById('vb-open-modal-btn')", self.content_js)
        self.assertIn('--vb-tail-x', self.content_js)
        self.assertIn('vb-tail-top', self.content_js)

    def test_bubble_suppressed_when_link_lands_in_a_comment_box(self):
        # insertLinkIntoComment reports whether the link actually landed
        self.assertIn('return directlyInserted;', self.content_js)
        self.assertIn('if (insertedIntoBox) return;', self.content_js)

    # --- In-box recorder ---

    def test_inbox_targets_cover_all_three_surfaces(self):
        self.assertIn('collectInboxTargets', self.content_js)
        # Detection is structural, not pinned to one release's class names
        self.assertIn('looksLikeCommentField', self.content_js)
        self.assertIn('textarea, input[type="text"], [contenteditable="true"]', self.content_js)
        self.assertIn('[class*="docos-"]', self.content_js)
        self.assertIn('punch-speakernotes', self.content_js)
        self.assertIn('div[aria-label*="private" i]', self.content_js)

    def test_public_class_stream_excluded_on_every_path(self):
        # Broadening detection once let a public class-comment box through the
        # generic pass; the exclusion now lives in add(), which every path uses.
        self.assertIn('function isPublicClassStream', self.content_js)
        self.assertIn('if (isPublicClassStream(el)) return;', self.content_js)
        # Exactly one call site: inside add(), which every detection path funnels through
        self.assertEqual(self.content_js.count('if (isPublicClassStream(el)) return;'), 1)

    def test_class_stream_is_excluded_in_every_shipped_locale(self):
        """The guard used to compare against two English strings.

        That meant it excluded nothing at all outside English — and the districts
        this product is sold into are the multilingual ones. Each label below is
        how Classroom names the public stream in that locale; each must match.
        """
        stream_words = self._js_string_array('CLASS_STREAM_WORDS')
        public_labels = [
            ('en', 'Add class comment'),
            ('es', 'Comentarios de la clase'),
            ('pt', 'Comentários da turma'),
            ('fr', 'Commentaires de classe'),
            ('de', 'Kommentare für den Kurs'),
            ('it', 'Commenti del corso'),
            ('nl', 'Reactie voor de klas'),
            ('pl', 'Komentarz dla klasy'),
            ('ru', 'Комментарии класса'),
            ('uk', 'Коментарі класу'),
            ('ar', 'تعليقات الصف'),
            ('he', 'הערת כיתה'),
            ('zh-CN', '班级评论'),
            ('zh-TW', '課堂留言'),
            ('ja', 'クラスのコメント'),
            ('ko', '수업 댓글'),
            ('hi', 'कक्षा टिप्पणी'),
            ('vi', 'Nhận xét lớp học'),
            ('tr', 'Sınıf yorumları'),
            ('id', 'Komentar kelas'),
            ('th', 'ความคิดเห็นในชั้นเรียน'),
            ('sw', 'Maoni ya darasa'),
            ('fil', 'Puna ng klase'),
        ]
        for locale, label in public_labels:
            self.assertTrue(
                any(word in label.lower() for word in stream_words),
                'Public class stream not excluded in %s: %r' % (locale, label)
            )

    def test_private_surfaces_are_recognised_in_every_shipped_locale(self):
        """Fail-closed only works if private surfaces are actually recognised.

        On Classroom an unidentified surface now gets no button at all, so a
        locale missing from this list loses the feature entirely — the trade the
        gate deliberately makes, and the reason the list has to be broad.
        """
        private_words = self._js_string_array('PRIVATE_WORDS')
        stream_words = self._js_string_array('CLASS_STREAM_WORDS')
        private_labels = [
            ('en', 'Add private comment'),
            ('es', 'Comentario privado'),
            ('pt-PT', 'Comentário privado'),
            ('pt-BR', 'Comentário particular'),
            ('fr', 'Commentaire privé'),
            ('de', 'Privater Kommentar'),
            ('it', 'Commento privato'),
            ('nl', 'Privéreactie'),
            ('pl', 'Komentarz prywatny'),
            ('ru', 'Личный комментарий'),
            ('ar', 'تعليق خاص'),
            ('he', 'הערה פרטית'),
            ('zh-CN', '私人评论'),
            ('zh-TW', '不公開留言'),
            ('ja', '限定公開のコメント'),
            ('ko', '비공개 댓글'),
            ('hi', 'निजी टिप्पणी'),
            ('vi', 'Nhận xét riêng tư'),
            ('tr', 'Özel yorum'),
            ('id', 'Komentar pribadi'),
            ('th', 'ความคิดเห็นส่วนตัว'),
            ('sw', 'Maoni binafsi'),
        ]
        for locale, label in private_labels:
            self.assertTrue(
                any(word in label.lower() for word in private_words),
                'Private comment box unrecognised in %s: %r — the mic button '
                'would disappear there' % (locale, label)
            )
            # ...and a private box must never read as the public stream
            self.assertFalse(
                any(word in label.lower() for word in stream_words),
                'Private box misread as the class stream in %s: %r' % (locale, label)
            )

    def test_comment_field_detection_is_not_english_only(self):
        """looksLikeCommentField's regex was English-only on the same footing."""
        comment_words = self._js_string_array('COMMENT_WORDS')
        for locale, label in [
            ('en', 'Add comment'), ('es', 'Añadir comentario'), ('fr', 'Ajouter un commentaire'),
            ('de', 'Kommentar hinzufügen'), ('pt', 'Adicionar comentário'), ('ru', 'Добавить комментарий'),
            ('ja', 'コメントを追加'), ('zh-CN', '添加评论'), ('ko', '댓글 추가'),
            ('ar', 'إضافة تعليق'), ('vi', 'Thêm nhận xét'), ('tr', 'Yorum ekle'),
            ('hi', 'टिप्पणी जोड़ें'), ('th', 'เพิ่มความคิดเห็น'), ('id', 'Tambahkan komentar'),
        ]:
            self.assertTrue(
                any(word in label.lower() for word in comment_words),
                'Comment field undetected in %s: %r' % (locale, label)
            )

    def test_classroom_gate_fails_closed(self):
        """An unidentifiable Classroom surface must get nothing.

        Before this, an unrecognised container produced NO exclusion, so the
        button appeared. That is the wrong default on the one host where a
        mistake publishes a student's voice to the whole class.
        """
        self.assertIn('function isPrivateClassroomSurface', self.content_js)
        self.assertIn("const IS_CLASSROOM = location.hostname === 'classroom.google.com'", self.content_js)
        self.assertIn('if (IS_CLASSROOM && !isPrivateClassroomSurface(el)) return true;', self.content_js)
        # Docs and Slides must NOT be caught by the fail-closed rule, or every
        # ordinary comment box loses its button
        gate = self.content_js[self.content_js.index('function isPublicClassStream'):]
        gate = gate[:gate.index('\n  }')]
        self.assertIn('IS_CLASSROOM &&', gate)

    def test_contenteditable_comment_fields_are_writable(self):
        # Detection and the writer guard must agree, or the button appears on a
        # box it cannot actually write into
        self.assertIn("if ((target.isContentEditable || target.tagName === 'TEXTAREA') && looksLikeCommentField(target))", self.content_js)

    def _canvas_guard(self):
        """The CANVAS_SELECTOR literal only, without the comment explaining it."""
        body = self.player_js[self.player_js.index('const CANVAS_SELECTOR'):]
        return body[:body.index(';')]

    def test_canvas_guard_has_exactly_one_definition(self):
        """Both content scripts used to carry their own copy, and the copy in
        player.js kept the bug after content.js was fixed."""
        literal = '.docs-texteventtarget-iframe, .kix-page'
        self.assertEqual(self.player_js.count(literal), 1)
        self.assertEqual(self.content_js.count(literal), 0)
        self.assertIn('CANVAS_SELECTOR: CANVAS_SELECTOR', self.player_js)
        self.assertIn('window.VoiceBridgePlayer.CANVAS_SELECTOR', self.content_js)
        # Both scripts consult it
        self.assertIn('el.closest?.(CANVAS_SELECTOR)', self.player_js)
        self.assertIn('target.closest?.(CANVAS_SELECTOR)', self.content_js)
        self.assertIn('el.closest(CANVAS_SELECTOR)', self.content_js)

    def test_canvas_guard_excludes_only_the_drawing_surface(self):
        """The Docs comment sidebar is nested inside .kix-appview / #docs-editor.

        Guarding on those app-shell wrappers rejected every comment box as if it
        were canvas — no mic button appeared, and no posted comment rendered a
        player.
        """
        guard = self._canvas_guard()
        for dangerous in ('.docs-texteventtarget-iframe', '.kix-page',
                          '.kix-canvas-tile-content', '.punch-canvas',
                          '.punch-stage', '.punch-texteventtarget-iframe'):
            self.assertIn(dangerous, guard)
        for too_broad in ('.kix-appview', '#docs-editor', '.docs-ui-unprintable'):
            self.assertNotIn(too_broad, guard,
                             '%s wraps the comment sidebar and must not be treated as canvas' % too_broad)

    def test_posted_comments_render_a_player(self):
        # Comment containers matched by prefix, not by one release's class names
        self.assertIn('NATIVE_COMMENT_SELECTOR', self.player_js)
        self.assertIn('[class*="docos-replyview"]', self.player_js)
        self.assertIn('[class*="docos-docoview"]', self.player_js)
        # The draft input must never be converted into a player
        self.assertIn('docos-input-textarea', self.player_js)
        self.assertIn('hideRawCommentContent', self.player_js)
        # Playback stays in the page
        self.assertIn('FETCH_DRIVE_AUDIO', self.player_js)
        self.assertNotIn('window.open', self.player_js)


    def test_inbox_recorder_lifecycle(self):
        for fn in ('syncInboxButtons', 'positionInboxUI', 'startInboxRecording',
                   'finishInboxRecording', 'cancelInboxRecording', 'teardownInboxRecorder'):
            self.assertIn(fn, self.content_js)
        # Reuses the existing pipeline rather than a parallel one
        for msg in ('START_RECORDING', 'STOP_RECORDING', 'UPLOAD_TO_DRIVE', 'CANCEL_RECORDING'):
            self.assertIn(msg, self.content_js)
        # Only one recording at a time
        self.assertIn("if (inboxRecorder || activeModal || recordingState !== 'IDLE') return;", self.content_js)

    def test_inbox_recorder_writes_link_into_the_box(self):
        # Shared writer, used by both the modal flow and the in-box recorder
        self.assertIn('function writeTextIntoInput', self.content_js)
        self.assertEqual(self.content_js.count('writeTextIntoInput('), 3)
        self.assertIn('formattedChipText', self.content_js)

    def test_inbox_recorder_never_steals_focus(self):
        # Google Docs closes its comment box on blur
        self.assertIn("btn.addEventListener('mousedown', (e) => e.preventDefault());", self.content_js)
        self.assertIn("overlay.addEventListener('mousedown', (e) => e.preventDefault());", self.content_js)

    def test_viewport_measurement_is_defensive(self):
        # innerWidth/innerHeight read 0 in embedded contexts; 0 must mean
        # "unknown", not "everything is off-screen"
        self.assertIn('function viewportSize', self.content_js)
        self.assertIn('document.documentElement?.clientHeight', self.content_js)
        self.assertIn('if (vh && (r.bottom < 0 || r.top > vh)) return null;', self.content_js)

    def test_icon_fills_survive_host_page_css(self):
        """The icons carry fill="currentColor" as a presentation attribute, the
        lowest-priority way to set fill. Google Docs styles svg/path inside its
        comment cards, which rendered the play triangle in Docs grey. The CSS
        must restate the fill, and must cover the child shapes: a rule matching
        only the svg element leaves a Docs `path` rule winning.
        """
        css = self.content_css

        # Play/pause glyph, including the shapes each icon is built from
        for shape in ('svg', 'svg path', 'svg rect'):
            self.assertIn('.voicebridge-inline-player .vb-gdoc-play-btn %s' % shape, css)
        self.assertIn('fill: var(--vb-player-on-accent) !important;', css)

        # Outline icons must stay unfilled on every child shape
        for shape in ('svg', 'svg path', 'svg polyline'):
            self.assertIn('.voicebridge-inline-player .vb-gdoc-circle-btn %s' % shape, css)

        # Glyph colour is themed, not hardcoded, so high contrast still inverts
        self.assertIn('--vb-player-on-accent: #ffffff;', css)
        self.assertIn('--vb-player-on-accent: #000000;', css)
        self.assertIn('color: var(--vb-player-on-accent)', css)

    def test_icon_colours_have_one_source_each(self):
        # The rewind icon colour is applied in exactly ONE rule, from a token each
        # surface variant overrides. Two application sites is how the glyph went
        # grey: one rule was fixed and the other kept winning.
        self.assertEqual(
            1, self.content_css.count('color: var(--vb-player-icon);'),
            'The icon colour must be applied from the token in exactly one rule'
        )
        # One definition per surface variant, and every one of them a variant
        # override rather than a stray literal on the icon rule itself
        definitions = re.findall(r'--vb-player-icon:\s*([^;]+);', self.content_css)
        self.assertEqual(
            ['#3c4043', '#e8eaed', '#fef08a'], definitions,
            'expected the default plus the dark-surface and high-contrast overrides'
        )

    def test_inbox_styles_present(self):
        for cls in ('.vb-injected-mic-btn', '.vb-inbox-recorder', '.vb-inbox-done',
                    '.vb-inbox-cancel', '.vb-inbox-level', '.vb-inbox-silent'):
            self.assertIn(cls, self.content_css)
        self.assertIn('.vb-theme-high-contrast .vb-inbox-recorder', self.content_css)

    def test_playback_failures_are_distinguishable(self):
        """A failed play must say which failure it was.

        "Not shared with you" is fixed by asking a person, "deleted" cannot be
        fixed at all, and "offline" is worth retrying. A single generic error —
        the old two-second flash of the time display — told a teacher none of
        that and made the product look simply broken.
        """
        for reason in ('not_shared', 'not_found', 'not_authenticated', 'network'):
            self.assertIn(
                f'{reason}:', self.player_js,
                f'Player has no distinct message for the {reason} failure'
            )
        # Each message must be a real sentence, not a code or a bare glyph
        for reason in ('not_shared', 'not_found'):
            message = re.search(reason + r":\s*'([^']+)'", self.player_js)
            self.assertIsNotNone(message, f'{reason} message missing')
            self.assertGreater(
                len(message.group(1).split()), 5,
                f'{reason} message is too terse to act on'
            )
        # The reason has to survive the direct-URL fallback to be reportable
        self.assertIn('lastFailureReason', self.player_js)
        self.assertNotIn("flashError('\u26a0\ufe0f Error')", self.player_js)

    def test_error_surface_is_announced(self):
        """The failure message is a live region, not colour alone."""
        self.assertIn("errorRow.setAttribute('role', 'status')", self.player_js)
        self.assertIn("errorRow.setAttribute('aria-live', 'polite')", self.player_js)
        self.assertIn('.vb-gdoc-error', self.content_css)
        self.assertIn('--vb-player-error', self.content_css)

    def test_page_account_is_sent_with_every_upload(self):
        """Both recording paths report which account the page is running as.

        The modal and the in-box recorder share one message pipeline; a detector
        wired into only one of them leaves the other silently uploading to the
        wrong Drive.
        """
        self.assertIn('function detectPageAccount()', self.content_js)
        self.assertIn(r"location.pathname.match(/\/u\/(\d+)\//)", self.content_js)
        self.assertEqual(
            2, self.content_js.count('pageAccount: detectPageAccount()'),
            'Every UPLOAD_TO_DRIVE call site must carry the page account'
        )
        self.assertEqual(
            2, self.content_js.count("action: 'UPLOAD_TO_DRIVE'"),
            'A new upload path was added without the account check'
        )

    def test_account_mismatch_is_reported_on_both_paths(self):
        self.assertIn('function accountMismatchMessage(', self.content_js)
        self.assertEqual(
            2, self.content_js.count("reason === 'account_mismatch'"),
            'Both the modal and the in-box recorder must surface the mismatch'
        )
        # Long enough to read: the default 4s toast cannot hold this message
        self.assertEqual(
            2, self.content_js.count('showToastNotification(accountMismatchMessage('),
            'Both paths must actually display the mismatch message'
        )
        self.assertIn('durationMs || 4000', self.content_js)
        for shown in re.findall(r'showToastNotification\(accountMismatchMessage\([^)]*\), (\d+)\)', self.content_js):
            self.assertGreaterEqual(
                int(shown), 10000,
                'The mismatch message names two addresses and needs time to read'
            )

    def test_recording_has_a_hard_length_cap(self):
        """Unbounded audio breaks the transport, not just the UX.

        The base64 crosses chrome.runtime.sendMessage in one message and uploads
        as a single non-chunked multipart request. Both recording paths enforce
        the cap, because a fix wired into only one leaves the other unbounded.
        """
        self.assertIn('const MAX_RECORDING_SECONDS = 300;', self.content_js)
        self.assertEqual(
            2, self.content_js.count('>= MAX_RECORDING_SECONDS'),
            'Both the modal and the in-box recorder must stop at the cap'
        )
        # Announced before it happens, not sprung on the speaker
        self.assertIn('COUNTDOWN_FROM_SECONDS', self.content_js)
        self.assertIn('vb-timer-ending', self.content_css)

    def test_empty_recordings_are_not_uploaded(self):
        """Mic then immediately confirm used to post a 0:00 note that plays silence."""
        self.assertIn('const MIN_RECORDING_SECONDS = 1;', self.content_js)
        self.assertEqual(
            2, self.content_js.count('< MIN_RECORDING_SECONDS'),
            'Both recording paths must refuse an empty recording'
        )

    def test_two_notes_in_one_comment_each_render(self):
        """The guard is keyed per note, not per parent element.

        Keyed on the parent, a comment holding two voice notes rendered only the
        first: the second was marked processed before the guard, so it got no
        player, never retried, and left its raw Drive URL visible.
        """
        self.assertIn('data-voicebridge-file-id', self.player_js)
        self.assertIn(
            "'.voicebridge-inline-player[data-voicebridge-file-id=\"' + fileId + '\"]'",
            self.player_js
        )
        # The bare parent-wide guard must be gone
        self.assertNotIn(
            "!parent.querySelector('.voicebridge-inline-player')", self.player_js
        )

    def test_card_surface_is_tokenised_for_dark_hosts(self):
        """The card hardcoded Docs' light greys, so it stayed a white rectangle
        with near-black text in a dark Google Doc."""
        for token in ('--vb-player-surface', '--vb-player-text',
                      '--vb-player-text-muted', '--vb-player-border'):
            self.assertIn('%s:' % token, self.content_css)
        self.assertIn('.voicebridge-inline-player.vb-dark-surface', self.content_css)

        # No literal colour may remain in the player block, or the dark variant
        # cannot retint it
        block = self.content_css[
            self.content_css.index('/* --- Google Docs Voice Comment Bubble'):
            self.content_css.index('/* Dark surface (Google Docs dark theme')
        ]
        body = block[block.index('margin: 8px 0;'):]
        literals = re.findall(r'^\s*(?:background|color)\s*:\s*#[0-9a-fA-F]{3,6}\s*;', body, re.M)
        self.assertEqual([], literals, 'Untokenised colours left in the player card: %r' % literals)

    def test_dark_mode_is_measured_not_assumed(self):
        """prefers-color-scheme reports the OS setting, not the document's.

        A Doc left in light mode on a dark-themed machine would get a dark,
        unreadable card. Google Docs exposes no stable class for its own theme,
        so the brightness of the surface behind the card is what decides.
        """
        self.assertIn('function surfaceIsDark', self.player_js)
        self.assertIn('function brightnessOf', self.player_js)
        self.assertIn("classList.toggle('vb-dark-surface'", self.player_js)
        self.assertNotIn(
            '@media (prefers-color-scheme', self.content_css,
            'The card must not switch theme on the OS setting'
        )
        # Every mount point runs the check, including the one in content.js
        self.assertEqual(2, self.player_js.count('applySurfaceTheme(player);'))
        self.assertIn('window.VoiceBridgePlayer.applySurfaceTheme(card);', self.content_js)

    def test_each_note_gets_its_own_duration(self):
        """Duration is read from the text beside the link, not the whole block.

        Surfaced by the two-notes fix: both players in one comment were labelled
        with the first note's length, because extractDuration matched the first
        parenthetical anywhere in the enclosing element.
        """
        self.assertIn('function textBefore(link)', self.player_js)
        self.assertIn('textBefore(link) || rawText', self.player_js)
        # Nearest match wins, so a run of text ending at the second link does not
        # return the first note's label
        self.assertIn('labelled[labelled.length - 1]', self.player_js)

    def test_seeking_works_without_a_duration_header(self):
        """MediaRecorder webm carries no duration, so audio.duration is Infinity.

        Every control that divided by it bailed out first: the scrubber never
        moved, the total never appeared, and clicking or arrowing the track did
        nothing at all. The chip text carries the real length.
        """
        self.assertIn('function parseClock', self.player_js)
        self.assertIn('function effectiveDuration', self.player_js)
        self.assertIn('const declaredSeconds = parseClock(durationStr)', self.player_js)
        # No control may gate itself on the raw duration any more
        self.assertNotIn('if (!audio.duration || isNaN(audio.duration)) return;', self.player_js)
        self.assertIn('function seekTo(seconds)', self.player_js)

    def test_scrubber_is_a_slider_not_a_progressbar(self):
        """The track takes arrow keys and clicks; progressbar says read-only."""
        self.assertIn("scrubberTrack.setAttribute('role', 'slider')", self.player_js)
        self.assertNotIn("'role', 'progressbar'", self.player_js)
        self.assertIn("'aria-valuetext'", self.player_js)
        # A time, not a bare percentage
        self.assertIn('of ${formatTime(total)}', self.player_js)

    def test_playback_speed_is_remembered(self):
        """A student who needs 0.75x had to set it again on every single note."""
        self.assertIn("chrome.storage.local.get(['playbackRate']", self.player_js)
        self.assertIn('function rememberSpeed', self.player_js)
        self.assertIn('rememberSpeed(newSpeed)', self.player_js)
        self.assertIn('SPEEDS.indexOf(preferredSpeed)', self.player_js)

    def test_speed_label_matches_the_speed_played(self):
        """toFixed(1) rendered and announced the 1.25x step as "1.3x" — a speed
        the player never actually plays at."""
        self.assertIn('function formatSpeed', self.player_js)
        self.assertNotIn('newSpeed.toFixed(1)', self.player_js)
        self.assertNotIn('preferredSpeed.toFixed(1)', self.player_js)

    def test_polling_pauses_on_hidden_tabs(self):
        """Two always-on whole-document polls, on classroom Chromebooks."""
        for source, name in ((self.player_js, 'player.js'), (self.content_js, 'content.js')):
            self.assertIn('if (document.hidden) return;', source,
                          '%s polls a hidden tab' % name)
            self.assertIn("addEventListener('visibilitychange'", source,
                          '%s never catches up after being hidden' % name)

    def test_long_requests_have_a_deadline(self):
        """A sendMessage callback never fires if the worker is torn down.

        That left "Saving to your Google Drive…" on screen forever, with no way
        back to the recording.
        """
        self.assertIn('function sendMessageWithTimeout', self.content_js)
        self.assertIn('timedOut: true', self.content_js)
        self.assertEqual(
            4, self.content_js.count('sendMessageWithTimeout({'),
            'Both stop calls and both upload calls need a deadline'
        )
        # ...and no bare send may remain on those two actions
        for action in ("action: 'STOP_RECORDING'", "action: 'UPLOAD_TO_DRIVE'"):
            self.assertNotIn(
                'chrome.runtime.sendMessage({\n        %s' % action, self.content_js
            )

    def test_no_dead_player_api(self):
        # Only what content.js actually consumes is exported
        self.assertIn('createPlayerCard: createPlayerCard', self.player_js)
        # Only the card factory and the shared guard are exported
        export = self.player_js[self.player_js.index('window.VoiceBridgePlayer = {'):]
        export = export[:export.index('};')]
        self.assertNotIn('formatTime', export)
        self.assertNotIn('createInlinePlayer', export)
        self.assertNotIn('scan:', export)
        for dead in ('opts.autoplay', 'vb-is-playing', 'vb-voice-bubble', 'vb-gdoc-close-btn'):
            self.assertNotIn(dead, self.player_js, '%s is emitted but nothing uses it' % dead)

    def test_bubble_styles_present(self):
        self.assertIn('#voicebridge-voice-bubble', self.content_css)
        self.assertIn('.vb-gdoc-circle-btn', self.content_css)
        self.assertIn('--vb-player-accent', self.content_css)
        self.assertIn('var(--vb-tail-x', self.content_css)
        # High contrast retheming and reduced-motion support
        self.assertIn('.vb-theme-high-contrast .vb-gdoc-circle-btn', self.content_css)
        self.assertIn('prefers-reduced-motion', self.content_css)

if __name__ == '__main__':
    unittest.main()
