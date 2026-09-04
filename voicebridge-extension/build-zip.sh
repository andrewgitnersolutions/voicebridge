#!/usr/bin/env bash
set -e

# build-zip.sh
# Packages VoiceBridge Chrome Extension for Chrome Web Store submission

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
# Read the version from the manifest rather than restating it: a hardcoded name
# silently ships an archive labelled with the wrong version after a bump.
VERSION="$(python3 -c "import json;print(json.load(open('${ROOT_DIR}/manifest.json'))['version'])")"
ZIP_NAME="voicebridge-v${VERSION}.zip"
ZIP_PATH="${DIST_DIR}/${ZIP_NAME}"

echo "=========================================="
echo " Packaging VoiceBridge Chrome Extension"
echo "=========================================="

# 1. Validation Checks
echo "[1/4] Validating files..."
if [ ! -f "${ROOT_DIR}/manifest.json" ]; then
  echo "❌ Error: manifest.json missing!"
  exit 1
fi

for size in 16 48 128; do
  if [ ! -f "${ROOT_DIR}/icons/icon-${size}.png" ]; then
    echo "❌ Error: icons/icon-${size}.png missing!"
    exit 1
  fi
done

# The dyslexia-friendly option is a named accessibility feature; without these
# files it silently falls back to a generic sans and does nothing.
for font in opendyslexic-regular opendyslexic-bold; do
  if [ ! -f "${ROOT_DIR}/assets/fonts/${font}.woff2" ]; then
    echo "❌ Error: assets/fonts/${font}.woff2 missing!"
    exit 1
  fi
done

echo "✅ All required icons & manifest verified."

# 2. Prepare Output Directory
echo "[2/4] Preparing dist directory..."
rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"

# 3. Create Clean Store ZIP
echo "[3/4] Creating ${ZIP_NAME}..."
cd "${ROOT_DIR}"

zip -r "${ZIP_PATH}" \
  manifest.json \
  background/ \
  offscreen/ \
  content/ \
  popup/ \
  permissions/ \
  player/ \
  icons/ \
  assets/ \
  -x "*.DS_Store" \
  -x "__pycache__*" \
  -x "*.git*"

# 4. Verify ZIP Contents
echo "[4/4] Verifying archive..."
ZIP_SIZE=$(du -h "${ZIP_PATH}" | cut -f1)
echo "✅ Package created successfully: ${ZIP_PATH} (${ZIP_SIZE})"
echo ""
echo "Archive contents:"
unzip -l "${ZIP_PATH}"
echo ""
echo "🚀 Ready for Chrome Web Store upload via the Chrome Developer Dashboard!"
