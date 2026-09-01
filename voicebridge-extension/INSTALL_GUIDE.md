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
2. Create or select your Google Cloud project (e.g. `VoiceBridge-Production`).
3. Enable the **Google Drive API** (**APIs & Services $\rightarrow$ Library $\rightarrow$ Google Drive API**).
4. Configure the **OAuth Consent Screen**:
   - User Type: **External** (for general public / Web Store) or **Internal** (for school district Workspace domains).
   - Scopes: Add `https://www.googleapis.com/auth/drive.file`.
   - Publishing status: **In production** (or add test accounts under Test Users if testing).
5. Create OAuth Credentials $\rightarrow$ **Create Credentials $\rightarrow$ OAuth client ID**:
   - Application Type: **Chrome extension**.
   - Item ID: For Chrome Web Store releases, set this to your Chrome Web Store Extension ID (e.g., `jpmkccmocfahkohmnldjmadlggoeplfm`). For local testing, set it to the extension ID shown in `chrome://extensions/`.
6. Copy the generated Client ID and paste it into `manifest.json` under `"oauth2.client_id"`.
7. When uploaded to the Chrome Web Store, the extension will now directly authenticate with Google Drive and upload recordings straight into the user's `VoiceBridge Recordings` folder, generating shareable Google Drive links (`https://drive.google.com/file/d/.../view`).

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
