# Chrome Web Store Listing — VoiceBridge

> Last Updated: 2026-08-25

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
• Google Classroom Private Comments: Directly injects voice recording into 1-on-1 private comments while intentionally excluding public stream comments to protect student privacy and eliminate peer anxiety.
• 1-Click Inline Audio Player: Teachers and students can listen to voice notes directly inside Google Classroom and Google Docs with 0.75x–2.0x playback speed controls.
• Universal Design for Learning (UDL): Includes Lexend and OpenDyslexic typography, WCAG AAA 7:1 contrast themes, soft pastel low-glare mode, and 48px+ touch targets for Chromebooks.
• Single-Key & Switch Access: Navigate and record effortlessly using Space to record/stop and Esc to cancel.
• Silence & Mute Detection: Alerts students if their microphone is accidentally muted or not picking up sound before they submit.
• 100% Student-Owned Storage ($0 Developer Cost): Recordings are uploaded directly to the student's own district Google Drive folder ("VoiceBridge Recordings"). No third-party servers, no recording quotas, and zero monthly minute caps.

HOW TO USE VOICEBRIDGE:

1. Click the floating microphone icon or the injected mic button in a Google Classroom Private Comment.
2. Speak your response. Watch the live visual waveform to confirm your microphone is working.
3. Click "Stop & Review" to listen to your voice note, or click "Redo" to try again.
4. Click "Insert Voice Note" to attach your recording directly to your assignment comment.

PRIVACY, SECURITY & COMPLIANCE:

VoiceBridge is built strictly for K-12 student data privacy:
• Fully compliant with FERPA, COPPA, and GDPR.
• Zero developer database: Student audio never touches external servers or third-party databases.
• Least-privilege Google Drive permissions: VoiceBridge only requests access to files it creates itself (`drive.file`) and cannot view or edit any other student files.
• Student voices are NEVER collected, sold, or used to train commercial AI models.

SUPPORT & DISTRICT DEPLOYMENT:

VoiceBridge is easily deployable across entire school districts via the Google Workspace Admin Console. For deployment guides, feature requests, or technical support, visit:
https://voicebridge-ext.web.app/install.html (or https://github.com/andrewgitnersolutions/voicebridge)

**Category** [REQUIRED]
Accessibility

**Single Purpose** [REQUIRED]
Allows students and teachers to record and insert accessible voice notes into Google Classroom Private Comments and Google Docs.

**Primary Language** [REQUIRED]
English

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
| `storage` | permissions | Used to persist the user's accessibility preferences (Lexend/OpenDyslexic font choice, color theme, and single-key shortcut toggles) locally on the device. |
| `offscreen` | permissions | Required in Manifest V3 to capture microphone audio via `navigator.mediaDevices.getUserMedia` and encode compressed Opus audio in an offscreen document without blocking browser performance. |
| `identity` | permissions | Used to obtain a Google OAuth2 token to upload student voice recordings directly to their own district Google Drive folder (`VoiceBridge Recordings`), ensuring $0 developer operating costs and complete student data privacy. |
| `activeTab` | permissions | Used when the student triggers recording from the popup quick record action on the active Google Classroom or Google Docs tab. |
| `https://classroom.google.com/*` | host_permissions | Required to inject the accessible recording trigger into Google Classroom Private Comments and render inline 1-click audio playback cards for teachers. |
| `https://docs.google.com/*` | host_permissions | Required to inject voice comment triggers into Google Docs / Slides comment threads and render inline audio players. |
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
| 1.1.0 | 2026-08-27 | Added Google Forms Read-Aloud feature: browser-native TTS with karaoke-style word highlighting for all Google Forms questions, descriptions, and answer options. | Ready for Submission |
| 1.0.0 | 2026-08-25 | Initial production release with UDL accessibility, Google Classroom Private Comments injection, and Student Drive direct upload pipeline. | Published |
