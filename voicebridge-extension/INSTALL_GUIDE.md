# VoiceBridge — Installation & Deployment Guide

---

## 1. Local Developer & Teacher Testing (Unpacked)

To test VoiceBridge locally on a Chromebook, Mac, Windows, or Linux machine:

### Step 1: Open Extensions Page
In Google Chrome, type `chrome://extensions/` in the omnibox and press `Enter`.

### Step 2: Enable Developer Mode
In the top right corner of the Extensions page, switch the **Developer mode** toggle to **ON**.

### Step 3: Load Unpacked Extension
1. Click the **Load unpacked** button in the top left.
2. Select the `/Users/andrewgitner/Desktop/Voicebridge/voicebridge-extension` directory.
3. Confirm that **VoiceBridge** appears in your active extensions list with version `1.0.0`.

### Step 4: Configure OAuth Client ID (For Google Drive Direct Uploads)
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project named `VoiceBridge-District`.
3. Enable the **Google Drive API**.
4. Configure the OAuth Consent Screen (User Type: **Internal** for district domains, or **External** with verification for public).
5. Create OAuth Credentials $\rightarrow$ **OAuth client ID** $\rightarrow$ Application Type: **Chrome extension**.
6. Set the Extension ID to your VoiceBridge extension ID (found on `chrome://extensions/`).
7. Paste your generated Client ID into `manifest.json` under `"oauth2.client_id"`.

---

## 2. Google Workspace Admin Console (District-Wide Force Deployment)

District IT administrators can automatically install VoiceBridge on all managed student Chromebooks without requiring any manual action from students.

### Step 1: Navigate to Chrome App Management
1. Log in to [admin.google.com](https://admin.google.com) as a Super Admin.
2. Go to **Menu $\rightarrow$ Devices $\rightarrow$ Chrome $\rightarrow$ Apps & extensions $\rightarrow$ Users & browsers**.

### Step 2: Select the Target Organizational Unit (OU)
Select your student OU (e.g., `All Students` or `Special Education / Accommodations`).

### Step 3: Force Install VoiceBridge
1. Click the yellow **+** icon in the bottom right $\rightarrow$ **Add Chrome app or extension by ID**.
2. Enter the VoiceBridge Chrome Web Store ID (or Extension ID from your private store listing).
3. Under **Installation policy**, choose:
   - **Force install** (Installs automatically on all student Chromebooks).
   - **Pin to Chrome OS taskbar** (Optional, recommended for easy student access).

### Step 4: Pre-Grant Microphone Permissions (Recommended for SpEd)
To prevent confusing "VoiceBridge wants to use your microphone" browser dialogs for young or SpEd students:
1. In the Google Admin Console, go to **Devices $\rightarrow$ Chrome $\rightarrow$ Settings $\rightarrow$ Users & browsers**.
2. Search for **Audio input (Microphone)**.
3. Add `https://classroom.google.com` and your extension origin to the **Allowed URLs for audio capture** list without asking for user permission.

---

## 3. Chrome Web Store Upload Instructions

When ready to publish to the Chrome Web Store:

1. Run the build script to generate the production ZIP:
   ```bash
   bash build-zip.sh
   ```
2. Log into the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole).
3. Click **Add new item** and upload the generated `dist/voicebridge-v1.0.0.zip`.
4. Copy and paste the store metadata, descriptions, category, and permission justifications from [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md).
5. Upload the generated graphics from `store-assets/`:
   - Store Icon: `store-assets/icon-128.png`
   - Small Promo Tile: `store-assets/promo-small-440x280.png`
   - Marquee Banner: `store-assets/promo-marquee-1400x560.png`
   - Screenshots: `store-assets/screenshot-1-recording-1280x800.png`, `store-assets/screenshot-2-teacher-player-1280x800.png`, `store-assets/screenshot-3-accessibility-1280x800.png`.
6. Submit for review!
