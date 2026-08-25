# VoiceBridge — Accessible Voice Response & Feedback Chrome Extension

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Accessibility](https://img.shields.io/badge/WCAG-2.2%20AAA-green.svg)](https://www.w3.org/WAI/standards-guidelines/wcag/)
[![Compliance](https://img.shields.io/badge/FERPA%20%26%20COPPA-Compliant-success.svg)](PRIVACY_POLICY.md)
[![Storage](https://img.shields.io/badge/Developer%20Cost-%240.00-brightgreen.svg)](#zero-cost-storage-architecture)

> **Bridging the gap between thought and expression in K-12 Special Education.**

**VoiceBridge** is a lightweight, distraction-free Google Chrome extension designed to provide frictionless, asynchronous voice recording and playback across Chromebooks, Google Classroom, and Google Docs.

---

## 🌟 Key Features

- **4-Action Linear Workflow**: Record $\rightarrow$ Speak $\rightarrow$ Review $\rightarrow$ Submit. Zero nested menus or cognitive clutter.
- **Google Classroom Private Comments Injection**: Injects microphone triggers directly into 1-on-1 private comments while **strictly excluding public stream comments** for student psychological safety and privacy.
- **1-Click Inline Audio Player**: Embeds an interactive mini-player with $0.75\times - 2.0\times$ speed controls directly into Google Classroom comment threads and Google Docs.
- **Universal Design for Learning (UDL)**:
  - Lexend and OpenDyslexic typography.
  - WCAG AAA high-contrast themes (Yellow on Black, Soft Pastel low-glare mode).
  - $48\text{px}+$ touch targets for Chromebooks.
  - Single-key shortcuts (`Space` to record/stop, `Esc` to cancel).
- **Silence / Mute Detection**: Real-time DSP audio monitoring alerts students if their mic is muted before submitting empty recordings.
- **$0 Developer Operating Cost**: Files are uploaded directly to the student's own Google Drive folder (`"VoiceBridge Recordings"`). Zero developer servers, zero recording quotas, and zero monthly minute caps.
- **Strict Privacy**: FERPA, COPPA, and GDPR compliant. Zero AI training on student voices.

---

## 📁 Repository Structure

```
voicebridge-extension/
├── manifest.json                  # Manifest V3 extension configuration
├── background/
│   └── service-worker.js         # OAuth2 token manager & Google Drive direct uploader
├── offscreen/
│   ├── offscreen.html            # Web Audio API & MediaRecorder sandbox
│   └── offscreen.js              # Opus @ 32kbps audio capture & silence detector
├── content/
│   ├── content.js                # UDL floating recording widget & Classroom injector
│   ├── content.css               # WCAG AAA / Lexend accessible styling
│   └── player.js                 # Inline 1-click Google Drive audio player
├── popup/
│   ├── popup.html                # Settings, UDL font switcher, mic volume check
│   ├── popup.css                 # Popup stylesheet
│   └── popup.js                  # Settings controller & live mic test meter
├── icons/                        # 16px, 48px, 128px PNG icons (Suspension Bridge + Mic)
├── store-assets/                 # CWS promotional tiles & 1280x800 screenshots
├── CHROMEWEBSTORE.md             # Complete Chrome Web Store listing metadata
├── PRIVACY_POLICY.md             # Formal K-12 Student Privacy Policy
├── INSTALL_GUIDE.md              # Installation & District Admin deployment guide
└── build-zip.sh                  # One-click store packaging script
```

---

## 🚀 Quick Start (Testing Unpacked)

1. Clone or navigate to the directory:
   ```bash
   cd /Users/andrewgitner/Desktop/Voicebridge/voicebridge-extension
   ```
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `voicebridge-extension/` directory.
5. Open [Google Classroom](https://classroom.google.com) or [Google Docs](https://docs.google.com) and start recording!

---

## 🏫 District Administrator Deployment (Google Workspace)

School district IT administrators can force-install VoiceBridge across all managed Chromebooks via the **Google Workspace Admin Console**:

1. Navigate to **Devices $\rightarrow$ Chrome $\rightarrow$ Apps & extensions $\rightarrow$ Users & browsers**.
2. Select the target Organizational Unit (e.g., `Students / High School / SpEd`).
3. Click the `+` button and choose **Add Chrome app or extension by ID**.
4. Set installation policy to **Force install**.
5. Enable microphone auto-grant policy so students are never confused by browser permission popups.

See [INSTALL_GUIDE.md](INSTALL_GUIDE.md) for full configuration details.

---

## 📄 License & Compliance

Built for educational equity. Designed in full compliance with FERPA, COPPA, and GDPR.
