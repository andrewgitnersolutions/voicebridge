# VoiceBridge — Accessible Voice Response & Feedback for Classrooms

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Accessibility](https://img.shields.io/badge/WCAG-2.2%20AAA-green.svg)](https://www.w3.org/WAI/standards-guidelines/wcag/)
[![Compliance](https://img.shields.io/badge/FERPA%20%26%20COPPA-Compliant-success.svg)](voicebridge-extension/PRIVACY_POLICY.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Architecture](https://img.shields.io/badge/Operating%20Cost-%240.00-brightgreen.svg)](#-architecture--zero-cost-privacy)

> **Bridging the gap between thought and expression in K-12 Special Education.**

**VoiceBridge** is a lightweight, distraction-free Google Chrome extension engineered to provide frictionless, asynchronous voice recording and playback across Chromebooks, Google Classroom, and Google Docs.

🌐 **Website & Documentation:** [andrewgitnersolutions.github.io/voicebridge](https://andrewgitnersolutions.github.io/voicebridge/)

---

## 🎯 The Mission & Why VoiceBridge Exists

Many neurodivergent learners, students with IEPs/504 plans, and emerging bilingual students face major cognitive bottlenecks when forced to express their understanding through standard keyboard typing. 

Existing commercial voice-feedback tools frequently introduce:
1. **Costly District Subscriptions**: Per-seat recurring licenses that strain public school budgets.
2. **Privacy Vulnerabilities**: Student voice recordings stored on private third-party vendor clouds, creating FERPA, COPPA, and biometric data concerns.
3. **Cognitive Clutter**: Overly complex interfaces with multi-tiered menus that distract students.

**VoiceBridge was built to solve this:**
- **$0 Developer Operating Cost**: Audio recordings stream directly to the student's personal Google Drive folder (`"VoiceBridge Recordings"`). No middleman servers, no databases, and no subscription fees.
- **Strict Privacy & Safety**: 100% client-side. Zero audio storage on developer infrastructure, zero telemetry, and zero AI model training on student voices.
- **Universal Design for Learning (UDL)**: Built from the ground up for students with learning differences.

---

## 🌟 Key Features

* **4-Action Linear Workflow**: `Record` $\rightarrow$ `Speak` $\rightarrow$ `Review` $\rightarrow$ `Submit`. Zero nested menus or distracting multi-step modals.
* **Google Classroom Private Comments Injection**: Injects microphone triggers directly into 1-on-1 private comments while **strictly excluding public stream comments** for student psychological safety.
* **1-Click Inline Audio Player**: Embeds an interactive mini-player with $0.75\times - 2.0\times$ speed controls directly into Google Classroom comment threads and Google Docs.
* **Universal Design for Learning (UDL) & Accessibility**:
  * Integrated **Lexend** and **OpenDyslexic** typography.
  * WCAG AAA high-contrast themes (Yellow on Black, Soft Pastel low-glare mode).
  * $48\text{px}+$ touch targets designed specifically for touch-screen Chromebooks.
  * Single-key shortcuts (`Space` to record/stop, `Esc` to cancel).
* **Silence / Mute Detection**: Real-time Web Audio DSP alerts students if their mic is muted before submitting empty recordings.
* **FERPA, COPPA & GDPR Compliant**: Leverages Google's restricted `drive.file` OAuth scope—VoiceBridge can only access the files it creates itself.

---

## 🏗 Architecture & Zero-Cost Privacy

VoiceBridge operates entirely within the user's browser, communicating directly with Google APIs:

```
┌────────────────────────────────────────────────────────┐
│                   Student Chromebook                   │
│                                                        │
│   [Google Classroom / Docs]                            │
│              │                                         │
│              ▼                                         │
│   [VoiceBridge Content Script]                         │
│              │                                         │
│              ▼                                         │
│   [Offscreen Audio Sandbox] ──(Web Audio API DSP)      │
│   (Opus @ 32kbps compression + Silence Detector)       │
│              │                                         │
│              ▼                                         │
│   [Background Service Worker]                          │
└──────────────┬─────────────────────────────────────────┘
               │
               │ Direct Google Drive REST API (drive.file scope)
               ▼
┌────────────────────────────────────────────────────────┐
│            Student's Personal Google Drive             │
│            Folder: "VoiceBridge Recordings"            │
│                                                        │
│   • Direct File Upload                                 │
│   • Share Link Returned to Private Classroom Comment   │
└────────────────────────────────────────────────────────┘
```

**Zero backend servers. Zero databases. Zero external data brokers.**

---

## 📁 Repository Structure

```
Voicebridge/
├── voicebridge-extension/         # Open-source Chrome Extension (MIT Licensed)
│   ├── manifest.json              # Manifest V3 extension configuration
│   ├── background/                # Service worker: OAuth token manager & direct Drive uploader
│   ├── offscreen/                 # Web Audio sandbox (MediaRecorder, Opus @ 32kbps, silence detector)
│   ├── content/                   # Accessible floating recorder, Classroom injector, inline player
│   ├── popup/                     # Settings menu, UDL font switcher, mic test meter
│   ├── icons/                     # Extension icons (16px, 48px, 128px)
│   ├── store-assets/             # Chrome Web Store promotional tiles & screenshots
│   ├── tests/                     # Automated Python test suite
│   ├── run_tests.py               # Test runner
│   └── build-zip.sh              # Chrome Web Store packaging script
│
├── index.html                     # Official VoiceBridge Landing Page (GitHub Pages / Proprietary)
├── install.html                   # Guided student/teacher install page
├── privacy-policy.html            # Public student privacy policy
├── terms-of-service.html          # Terms of service
├── assets/                        # Public website graphics & stylesheets
├── .github/
│   ├── workflows/                 # CI/CD (Automated tests & GitHub Pages deployment)
│   ├── ISSUE_TEMPLATE/            # Standardized bug report & feature request templates
│   └── PULL_REQUEST_TEMPLATE.md   # Architectural integrity checklist
├── CONTRIBUTING.md                # Contribution guidelines & architecture non-negotiables
├── CODE_OF_CONDUCT.md            # Contributor Covenant v2.1
├── SECURITY.md                    # Vulnerability disclosure policy
└── LICENSE                        # MIT License (Extension) & Website Proprietary Reservation
```

---

## 🚀 Quick Start for Developers

### 1. Clone the Repository
```bash
git clone https://github.com/andrewgitnersolutions/voicebridge.git
cd voicebridge/voicebridge-extension
```

### 2. Load Unpacked in Google Chrome
1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Toggle on **Developer mode** in the upper right corner.
3. Click **Load unpacked** in the upper left.
4. Select the `voicebridge-extension/` directory.
5. Open [Google Classroom](https://classroom.google.com) or [Google Docs](https://docs.google.com) to test.

### 3. Run the Automated Test Suite
VoiceBridge includes automated tests for manifest validation, permissions scoping, WCAG AAA contrast ratios, and packaging integrity:
```bash
python3 voicebridge-extension/run_tests.py
```

---

## 🏫 District Administrator Deployment (Google Workspace)

School district IT administrators can force-install VoiceBridge across all managed Chromebooks through the **Google Workspace Admin Console**:

1. Log in to [admin.google.com](https://admin.google.com).
2. Navigate to **Devices** $\rightarrow$ **Chrome** $\rightarrow$ **Apps & extensions** $\rightarrow$ **Users & browsers**.
3. Select your target Organizational Unit (e.g., `Students / Special Education`).
4. Click **Add Chrome app or extension by ID**.
5. Set the installation policy to **Force install** or **Force install + pin to taskbar**.
6. Enable the microphone auto-grant policy so students are never confused by browser permission prompts.

Detailed instructions can be found in [INSTALL_GUIDE.md](voicebridge-extension/INSTALL_GUIDE.md).

---

## 🤝 Contributing

We welcome community contributions! Please read [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before opening an issue or pull request.

> [!IMPORTANT]
> All pull requests must strictly preserve VoiceBridge's **Zero-Backend / $0 Cost Architecture**, **FERPA/COPPA Student Privacy**, and **WCAG AAA / UDL Simplicity**. PRs introducing developer servers, databases, or public comment injections will not be accepted.

---

## 🔒 Security & Privacy

For responsible disclosure of security vulnerabilities, please refer to [SECURITY.md](SECURITY.md).
Review our complete Student Privacy Policy in [voicebridge-extension/PRIVACY_POLICY.md](voicebridge-extension/PRIVACY_POLICY.md) or online at [voicebridge.io/privacy-policy.html](https://andrewgitnersolutions.github.io/voicebridge/privacy-policy.html).

---

## 📄 License & Intellectual Property

* **Extension Source Code (`voicebridge-extension/`)**: Released under the [MIT License](LICENSE).
* **Website & Brand Assets (`index.html`, `assets/`, logos, trademarks)**: Proprietary. All Rights Reserved. See [LICENSE](LICENSE) for full legal terms.
