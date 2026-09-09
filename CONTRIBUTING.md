# Contributing to VoiceBridge

Thank you for your interest in contributing to **VoiceBridge**! VoiceBridge is an open-source assistive technology project dedicated to empowering K-12 students—particularly neurodivergent learners and students with IEPs/504 plans—by providing accessible, asynchronous voice recording across Google Classroom and Google Docs.

To ensure VoiceBridge remains a safe, accessible, and reliable tool for students and educators worldwide, **all contributions must strictly adhere to the fundamental architecture of the application and the underlying intent of that architecture.**

---

## 🏛 The Fundamental Architecture & Its Intent (Non-Negotiables)

Before submitting an issue or pull request, please review these core architectural tenets. Any contribution that violates these principles will be respectfully declined.

### 1. Zero Developer Operating Cost ($0.00 Running Cost)
* **The Rationale**: Public school districts and Special Education departments operate under severe budgetary constraints. Tools that rely on developer-hosted backends inevitably incur cloud hosting, bandwidth, and database costs, forcing developers to introduce paid subscriptions, student seat licenses, or eventually shut the service down when grants run out.
* **The Architecture**: VoiceBridge has **zero backend servers, zero developer databases, and zero recording proxies**. All audio recorded in the browser is compressed locally using Opus at 32 kbps and uploaded directly to the student's personal Google Drive account via the official Google Drive REST API into an automatically created `"VoiceBridge Recordings"` folder.
* **The Rule**: **We will never accept PRs that introduce central backend servers, intermediate databases, external cloud transcoders, or subscription authentication services.** VoiceBridge will remain permanently free to run.

### 2. Strict Student Privacy by Design (FERPA, COPPA, GDPR)
* **The Rationale**: Student voices are sensitive educational and biometric identifiers. School districts cannot legally or ethically deploy tools that risk leaking student voice data or expose students to unauthorized tracking.
* **The Architecture**: 
  - VoiceBridge requests only the restricted `https://www.googleapis.com/auth/drive.file` OAuth scope. It can *only* access files it creates itself and has zero access to any other files in the student's Drive.
  - Recording, silence detection, and playback occur entirely on the client device.
* **The Rule**: **Zero telemetry, zero third-party analytics trackers, zero external data brokers, and zero AI model training on student voice recordings.** Audio data must never touch any infrastructure other than the student's own Google Drive.

### 3. Universal Design for Learning (UDL) & Cognitive Load Reduction
* **The Rationale**: VoiceBridge is intentionally designed for students with learning differences, ADHD, dyslexia, executive dysfunction, and motor challenges. Every additional button, modal, or animation introduces cognitive clutter that can overwhelm a struggling learner.
* **The Architecture**: The recording interface adheres strictly to a **4-step linear flow**:
  $$\text{Record} \longrightarrow \text{Speak} \longrightarrow \text{Review} \longrightarrow \text{Submit}$$
* **The Rule**:
  - **No nested menus or multi-layered modals.** Controls must remain visible, simple, and self-evident.
  - All interactive elements must maintain a minimum touch target size of **$48\text{px} \times 48\text{px}$** for touch-screen Chromebooks.
  - Must preserve **WCAG 2.2 AAA** color contrast standards, Lexend / OpenDyslexic font support, and single-key keyboard shortcuts (`Space` to record/stop, `Esc` to cancel).

### 4. Psychological Safety in Classrooms
* **The Rationale**: Vulnerable students often feel intense anxiety about their voice or speech differences. They must have confidence that their recordings are seen and heard only by their intended teacher.
* **The Architecture**: In Google Classroom, VoiceBridge strictly targets and injects recording triggers into **1-on-1 private comments** between the student and the teacher.
* **The Rule**: **Injections into the public class stream, public assignment comments, or group announcement feeds are strictly forbidden.**

### 5. Performance on Low-Spec Chromebooks
* **The Rationale**: Most public school students use school-issued Chromebooks with low-power mobile processors (e.g., Intel Celeron, MediaTek) and 4 GB of RAM. Heavy JavaScript frameworks degrade performance, causing audio dropouts and browser lag.
* **The Rule**: VoiceBridge is written in **pure vanilla JavaScript, HTML, and CSS** with Manifest V3. No heavy UI frameworks (React, Vue, Angular) in content scripts, and no external CDN dependencies.

### 6. Repository Scope & Website Boundary
* **Notice**: The public website files located at the root of this repository (`index.html`, `install.html`, `privacy-policy.html`, `terms-of-service.html`, root `assets/`) and VoiceBridge branding are proprietary (All Rights Reserved).
* **The Rule**: External contributions are restricted to the extension codebase (`voicebridge-extension/`). PRs modifying marketing copy, logos, or website files will be closed.

---

## 🛠 Local Development Setup

### Prerequisites
* Google Chrome (or Chromium-based browser) version 116+
* Python 3.8+ (for running the automated test suite)
* Git

### Step-by-Step
1. **Fork and Clone**:
   ```bash
   git clone https://github.com/<your-username>/voicebridge.git
   cd voicebridge
   ```
2. **Load the Unpacked Extension in Chrome**:
   - Open Chrome and navigate to `chrome://extensions/`.
   - Enable the **Developer mode** toggle in the top-right corner.
   - Click **Load unpacked** in the top-left corner.
   - Select the `voicebridge-extension/` directory.
3. **Inspect Background and Offscreen Contexts**:
   - On the `chrome://extensions/` page, click `service worker` to inspect the background script.
   - To inspect offscreen audio capture, open `chrome://inspect/#other` while recording is active.

---

## 🧪 Testing Guidelines

VoiceBridge includes a comprehensive automated test suite in `voicebridge-extension/tests/` covering:
* Manifest V3 validation & permissions scoping
* Content script CSS isolation & class scoping
* WCAG AAA color contrast ratios across high-contrast themes
* Store asset dimensions and packaging verification

Before submitting any code, you **must** run the test suite locally:

```bash
python3 voicebridge-extension/run_tests.py
```

All tests must pass with **0 failures and 0 errors**. If your change adds new functionality, please add corresponding unit tests to `voicebridge-extension/tests/`.

---

## 📋 Pull Request Process

1. Create a descriptive feature branch from `main`:
   ```bash
   git checkout -b feature/accessible-feature-name
   ```
2. Ensure all changes strictly comply with the [Fundamental Architecture](#-the-fundamental-architecture--its-intent-non-negotiables).
3. Run the automated test suite:
   ```bash
   python3 voicebridge-extension/run_tests.py
   ```
4. Push your branch and open a Pull Request against `main`.
5. Complete all items in the [Pull Request Template](.github/PULL_REQUEST_TEMPLATE.md).

Thank you for helping make education more accessible for every student!
