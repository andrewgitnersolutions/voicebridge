# Security Policy

VoiceBridge takes the security and privacy of its users—particularly K-12 students and educators—with the utmost seriousness. Because VoiceBridge operates within sensitive educational environments (Google Classroom, Google Docs) and accesses microphone hardware and Google Drive storage, maintaining a rigorous security posture is essential.

---

## 🔒 Supported Versions

Only the latest release of VoiceBridge is supported with security updates.

| Version | Supported          | Notes |
| ------- | ------------------ | ----- |
| 1.2.x   | :white_check_mark: | Current production release |
| < 1.2.0 | :x:                | Deprecated |

---

## 🛡 Reporting a Vulnerability

**Please DO NOT open a public GitHub issue to report a security vulnerability.** Publicly disclosing vulnerabilities before a patch is available puts student and educator data at risk.

If you believe you have discovered a security vulnerability in VoiceBridge (such as an OAuth token leak, unauthorized scope escalation, cross-site scripting in content injection, or audio data leakage), please report it via private email:

* **Security Contact**: Andrew Gitner (`agitner@gmail.com`)
* **Subject Line**: `[SECURITY] VoiceBridge Vulnerability Report: <Brief Description>`

### What to Include in Your Report
To help us triage and resolve the issue quickly, please provide:
1. **Description**: A clear summary of the vulnerability and its potential impact.
2. **Steps to Reproduce**: A minimal, reproducible proof of concept (PoC).
3. **Environment**: Chrome version, OS (macOS, ChromeOS, Windows), and VoiceBridge version.
4. **Proposed Fix (Optional)**: If you have identified a potential fix, feel free to include suggestions.

---

## ⏱ Our Response Process

* **Acknowledgment**: We aim to acknowledge receipt of your vulnerability report within **48 hours**.
* **Assessment**: We will investigate and confirm the issue, keeping you informed of our progress.
* **Resolution**: Once a fix is developed and tested against our automated test suite, we will release an update to the Chrome Web Store and coordinate a responsible public disclosure with you.
* **Credit**: We are glad to credit researchers who report vulnerabilities responsibly.

---

## 🧱 Core Security Architecture Principles

When reviewing VoiceBridge code or proposing changes, keep in mind:

1. **Restricted OAuth Scopes**: VoiceBridge strictly requests `https://www.googleapis.com/auth/drive.file`. It cannot access, view, or modify any files outside of those created by VoiceBridge itself.
2. **Offscreen Audio Sandbox**: Audio recording and DSP silence analysis are isolated inside Chrome's Manifest V3 `offscreen` document sandbox.
3. **No External Dependencies**: Content scripts must not load external scripts or styles from remote CDNs (preventing supply-chain injections).
4. **Zero-Backend Architecture**: All files are stored directly in the student's own Google Drive. VoiceBridge maintains zero developer-side storage or database servers.
