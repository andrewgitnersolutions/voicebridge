# Chrome Web Store Listing — VoiceBridge

> Last Updated: 2026-09-04

## Store Listing

**Extension Name** [REQUIRED]
VoiceBridge — Voice Feedback & Response for Classrooms

**Short Description** [REQUIRED]
Record accessible voice responses in Google Classroom & Docs. Built for Special Education & UDL with $0 developer storage costs.

**Detailed Description** [REQUIRED]
VoiceBridge is an accessible voice recording and asynchronous feedback tool designed specifically for Special Education (SpEd) accommodations and Universal Design for Learning (UDL) in K-12 classrooms.

VoiceBridge bridges the gap between thought and expression by allowing students with dysgraphia, executive functioning challenges, or speech accommodations to record oral responses in place of written text, and enabling teachers to leave 1-click voice feedback.

KEY FEATURES BUILT FOR INCLUSIVE CLASSROOMS:

• 4-Action Linear Simplicity: Frictionless Record, Speak, Review, and Submit workflow with zero confusing menus or nested popups.
• Google Classroom Private Comments: Directly injects voice recording into 1-on-1 private comments while intentionally excluding public stream comments to protect student privacy and eliminate peer anxiety. Private and public comment boxes are told apart in 20+ languages, and any surface VoiceBridge cannot positively identify as private gets no recording button at all — the safe default for multilingual districts.
• 1-Click Inline Audio Player: Teachers and students listen to voice notes directly inside Google Classroom and Google Docs — play/pause, rewind 5 seconds, and a draggable timeline you can also move with the arrow keys, Home and End. Playback speed runs 0.75x–2.0x and is remembered across every note and every session, so a student who needs 0.75x sets it once.
• Universal Design for Learning (UDL): Lexend and OpenDyslexic typography — OpenDyslexic is bundled with the extension, so it renders correctly on managed Chromebooks with no font download and no network call. Includes WCAG AAA contrast for body text in every theme (15:1 or better, measured), a soft pastel low-glare mode, a high-contrast mode, and 48px+ touch targets.
• Readable in Light or Dark: The inline player reads the page it is sitting on and re-tints itself for Google Docs dark theme, or any dark page, instead of dropping a white card into a dark document.
• Single-Key & Switch Access: Navigate and record effortlessly using Space to record/stop and Esc to cancel. The player's timeline is exposed to screen readers as a slider that announces real times ("0:12 of 0:45"), not a bare percentage.
• Silence & Mute Detection: A live input-level meter shows the microphone is working while recording, and VoiceBridge alerts students if their microphone is accidentally muted or not picking up sound before they submit.
• Wrong-Account Protection: Students and teachers are often signed in to a personal and a school account at once. If the page is open under a different account than the one VoiceBridge would upload to, it stops before uploading and names both accounts — instead of silently filing the recording in a Drive the student cannot reach.
• Recordings You Do Not Lose: A 5-minute limit per note keeps uploads reliable on school networks, with an on-screen countdown in the final 30 seconds and an automatic save rather than a lost recording. Empty recordings are refused instead of posting a silent 0:00 note, and playback problems say which problem they are — not shared with you yet, removed from Drive, or simply offline.
• 100% Student-Owned Storage ($0 Developer Cost): Recordings are uploaded directly to the student's own district Google Drive folder ("VoiceBridge Recordings"). No third-party servers, no recording quotas, and zero monthly minute caps.
• Google Forms Read-Aloud: A VoiceBridge speaker icon appears beside every question on Google Forms quizzes and assignments. One click reads the full question — title, description, and every answer option — aloud using the browser's built-in text-to-speech, with karaoke-style word highlighting so students can follow along visually. Zero cloud API cost, works offline, and respects your chosen VoiceBridge theme and font.

HOW TO USE VOICEBRIDGE:

1. Click the floating microphone icon or the injected mic button in a Google Classroom Private Comment.
2. Speak your response. Watch the live visual waveform to confirm your microphone is working.
3. Click "Stop & Review" to listen to your voice note, or click "Redo" to try again.
4. Click "Insert Voice Note" to attach your recording directly to your assignment comment.

HOW TO USE VOICEBRIDGE READ-ALOUD (GOOGLE FORMS):

1. Open any Google Form quiz or assignment shared by your teacher.
2. Click the VoiceBridge speaker icon next to any question.
3. Follow along as each word highlights in sync with the voice reading the question, description, and all answer choices.
4. Click the icon again to stop at any time.

PRIVACY, SECURITY & COMPLIANCE:

VoiceBridge is built strictly for K-12 student data privacy:
• Fully compliant with FERPA, COPPA, and GDPR.
• Zero developer database: Student audio never touches external servers or third-party databases.
• Least-privilege Google Drive permissions: VoiceBridge only requests access to files it creates itself (`drive.file`) and cannot view or edit any other student files.
• Cached audio is addressed only by its own file ID, so a shared classroom Chromebook can never play one student's recording under another student's link.
• Student voices are NEVER collected, sold, or used to train commercial AI models.

---

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
| :--- | :--- | :--- | :--- |
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `store-assets/icon-128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 PNG | ✅ Ready | `store-assets/screenshot-1-recording-1280x800.png` |
| Screenshot 2 [RECOMMENDED] | 1280×800 PNG | ✅ Ready | `store-assets/screenshot-2-teacher-player-1280x800.png` |
| Screenshot 3 [RECOMMENDED] | 1280×800 PNG | ✅ Ready | `store-assets/screenshot-3-accessibility-1280x800.png` |
| Small Promo Tile [RECOMMENDED] | 440×280 PNG | ✅ Ready | `store-assets/promo-small-440x280.png` |
| Marquee Promo Tile | 1400×560 PNG | ✅ Ready | `store-assets/promo-marquee-1400x560.png` |

### Screenshot Notes
- **Screenshot 1**: Demonstrates student recording workflow inside Google Classroom Private Comments, highlighting the live audio waveform and Lexend typography.
- **Screenshot 2**: Shows teacher 1-click inline audio playback card with speed controls directly inside Google Classroom/Docs.
- **Screenshot 3**: Showcases Special Education accessibility settings (OpenDyslexic font, High Contrast Yellow/Black theme, and Student Drive zero-cost storage).

---

## Permissions Justification

| Permission | Type | Justification |
| :--- | :--- | :--- |
| `storage` | permissions | Stores the user's accessibility preferences (Lexend/OpenDyslexic font choice, color theme, single-key shortcut toggles, and preferred playback speed) locally on the device. Also holds a size-bounded local cache of the user's own recently recorded or played audio, so a voice note replays instantly without re-downloading it, and short-lived recording-session state keyed by tab. All of it stays on the device; none of it is transmitted anywhere. |
| `offscreen` | permissions | Required in Manifest V3 to capture microphone audio via `navigator.mediaDevices.getUserMedia` and encode compressed Opus audio in an offscreen document without blocking browser performance. |
| `identity` | permissions | Used to obtain a Google OAuth2 token to upload student voice recordings directly to their own district Google Drive folder (`VoiceBridge Recordings`), ensuring $0 developer operating costs and complete student data privacy. The token is also used for a single `drive/v3/about?fields=user(emailAddress)` call that reads the signed-in account's own address, so VoiceBridge can warn the user when the page is open under a different Google account than the one it would upload to. That address is compared on the device and shown back to the user in the warning; it is never stored or transmitted. |
| `scripting` | permissions | Used only when the student triggers recording from the popup on a supported Google page and the content script is not yet present: VoiceBridge injects its own bundled `content/player.js`, `content/content.js` and `content/content.css` into that tab. No remote or generated code is injected. |
| `activeTab` | permissions | Used when the student triggers recording from the popup quick record action on the active Google Classroom or Google Docs tab. |
| `https://classroom.google.com/*` | host_permissions | Required to inject the accessible recording trigger into Google Classroom Private Comments and render inline 1-click audio playback cards for teachers. |
| `https://docs.google.com/*` | host_permissions | Required to inject voice comment triggers into Google Docs / Slides comment threads and render inline audio players. |
| `https://slides.google.com/*` | host_permissions | Required to inject voice comment triggers into Google Slides comment threads and speaker notes, and to render inline audio players there. |
| `https://www.googleapis.com/*` | host_permissions | Required to communicate with the Google Drive API v3 to upload audio recordings and configure shareable view permissions. |

---

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No (Audio is stored solely on the student's own Google Drive account; zero developer servers exist).

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
| :--- | :--- | :--- | :--- | :--- |
| Personally identifiable info | No | No | N/A | No |
| Health info | No | No | N/A | No |
| Financial info | No | No | N/A | No |
| Authentication info | Yes (OAuth Token) | Only to Google Drive API | Direct Drive upload | No |
| Personal communications | Yes (Voice note) | Only to Student's Drive | Student submission | No |
| Location | No | No | N/A | No |
| Web history | No | No | N/A | No |
| User activity | No | No | N/A | No |
| Website content | No | No | N/A | No |

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

---

## Privacy Policy

**Privacy Policy URL** [REQUIRED]
https://voicebridge-ext.web.app/privacy-policy.html (See `PRIVACY_POLICY.md` for full text)

---

## Distribution

- **Visibility**: Public (or Unlisted for district pilots)
- **Regions**: All regions
- **Pricing**: Free ($0.00)

---

## Version History

| Version | Date | Changes | Status |
| :--- | :--- | :--- | :--- |
| 1.2.0 | 2026-09-04 | Privacy: removed a shared audio cache key that could serve one user's recording to another on a shared profile; Classroom private/public detection now works in 20+ languages and fails closed. Reliability: 5-minute recording cap with countdown, bounded local cache, recording state survives service-worker eviction, deadlines on stop/upload, wrong-Google-account detection before upload. Accessibility: OpenDyslexic now actually bundled and loading, working timeline seeking, slider role with spoken times, dark-surface support, remembered playback speed, live level meter and silence warning reconnected. No permission or OAuth scope changes. | Ready for Submission |
| 1.1.0 | 2026-08-27 | Added Google Forms Read-Aloud feature: browser-native TTS with karaoke-style word highlighting for all Google Forms questions, descriptions, and answer options. | Ready for Submission |
| 1.0.0 | 2026-08-25 | Initial production release with UDL accessibility, Google Classroom Private Comments injection, and Student Drive direct upload pipeline. | Published |
