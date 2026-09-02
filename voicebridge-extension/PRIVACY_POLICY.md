# VoiceBridge — Student Data Privacy Policy

> Effective Date: August 25, 2026

At **VoiceBridge**, we believe that student privacy, emotional safety, and data security are foundational human rights. This Privacy Policy details our strict adherence to student privacy regulations and explains how VoiceBridge processes data for K-12 students, educators, and school districts.

---

## 1. Compliance with Student Privacy Laws

VoiceBridge is designed from the ground up to comply with all major federal, state, and international student data privacy laws:

- **FERPA (Family Educational Rights and Privacy Act)**: VoiceBridge recognizes student voice recordings as protected educational records. Audio files remain under the direct custody and control of the educational agency (the school district) inside the student’s Google Workspace tenant.
- **COPPA (Children’s Online Privacy Protection Act)**: VoiceBridge does not knowingly collect personal information directly from children under 13 for commercial purposes. Use is authorized under school district consent for educational instructional purposes.
- **GDPR (General Data Protection Regulation)**: VoiceBridge adheres to data minimization, purpose limitation, and storage limitation principles.
- **State Student Privacy Acts (e.g., California SOPIPA, New York Ed Law 2-d)**: No student profiling, no targeted advertising, and zero monetization of student data.

---

## 2. Zero-Developer-Database Architecture ($0 Developer Server Footprint)

VoiceBridge operates on a **decentralized, serverless client architecture**:

1. **No External Audio Servers**: Student voice recordings are **never sent to or stored on developer-owned servers or third-party cloud databases**.
2. **Direct Student Ownership**: When a student records audio, the file is uploaded **directly from the student’s browser to their own district Google Drive account** into a folder named `"VoiceBridge Recordings"`.
3. **No Account Creation**: Students and teachers do not create a separate VoiceBridge account, username, or password. Authentication is handled natively via Google Workspace Single Sign-On (SSO).

---

## 3. Google Permissions & Least-Privilege Scopes

VoiceBridge requests the absolute minimum permissions required to function:

- **Google Drive API Scope (`https://www.googleapis.com/auth/drive.file`)**:
  - *What this means*: VoiceBridge is granted permission **only to access and create files that VoiceBridge itself created**.
  - *What VoiceBridge CANNOT do*: VoiceBridge **cannot read, list, view, modify, or delete any other files, folders, or documents** in the student’s Google Drive.
- **Microphone Access**: Used solely in real-time to capture audio input during active recording sessions. Audio streams are discarded immediately upon file generation.

---

## 4. Absolute Prohibitions: No AI Training, No Advertising

- **Zero AI Training**: Student voice recordings, transcripts, or audio samples are **NEVER used to train, fine-tune, or benchmark commercial AI models or speech recognizers**.
- **Zero Behavioral Advertising**: VoiceBridge contains no advertisements, no tracking cookies, and no third-party marketing pixels.
- **Zero Data Selling**: VoiceBridge does not sell, lease, or trade student data under any circumstance.

---

## 5. Data Retention & Deletion

Because all recordings reside in the student's own Google Drive account:
- The school district, student, or parent may delete recordings at any time directly through Google Drive.
- Recordings are subject to the district’s native Google Workspace data retention and archival policies.

---

## 6. Contact Information

For inquiries regarding student privacy, district data protection agreements (DPAs), or accessibility compliance:

- **Email**: `privacy@voicebridge.app`
- **Website**: `https://voicebridge-ext.web.app`
- **GitHub Repository**: `https://github.com/andrewgitnersolutions/voicebridge`
