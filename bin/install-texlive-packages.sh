#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-${TEXLIVE_PROFILE:-academic}}"

echo "=========================================================="
echo "TeX Live Installer for Overleaf Community Edition"
echo "Target Profile: ${PROFILE}"
echo "=========================================================="

# Ensure tlmgr is in PATH
if ! command -v tlmgr >/dev/null 2>&1; then
  TLMGR_PATH=$(find /usr/local/texlive -name tlmgr -type f 2>/dev/null | head -n 1 || true)
  if [ -n "$TLMGR_PATH" ]; then
    export PATH="$(dirname "$TLMGR_PATH"):$PATH"
    echo "Found tlmgr at: ${TLMGR_PATH}"
  else
    echo "ERROR: tlmgr not found in /usr/local/texlive"
    exit 1
  fi
fi

# Detect local TeX Live release year
TL_YEAR=$(tlmgr --version 2>/dev/null | grep -oE "20[0-9]{2}" | head -n 1 || true)
if [ -z "$TL_YEAR" ]; then
  TL_YEAR=$(ls -d /usr/local/texlive/20* 2>/dev/null | grep -oE "20[0-9]{2}" | head -n 1 || echo "2024")
fi
echo "Detected local TeX Live release year: ${TL_YEAR}"

PRIMARY_MIRROR="https://mirror.ctan.org/systems/texlive/tlnet"
HISTORIC_MIRROR="https://www.tug.org/historic/systems/texlive/${TL_YEAR}/tlnet-final"

# Determine which repository to use
REPO="${PRIMARY_MIRROR}"
echo "Testing connectivity with primary CTAN repository: ${PRIMARY_MIRROR}..."
if ! tlmgr --verify-repo=none --repository "${PRIMARY_MIRROR}" update --list >/dev/null 2>&1; then
  echo "Notice: Live CTAN is unavailable or version differs from local TeX Live ${TL_YEAR}."
  echo "Switching to historic repository archive: ${HISTORIC_MIRROR}"
  REPO="${HISTORIC_MIRROR}"
fi

echo "Using repository: ${REPO}"
tlmgr --verify-repo=none option repository "${REPO}" || true

if [ "${PROFILE}" = "full" ]; then
  echo "Installing scheme-full (all CTAN packages)..."
  tlmgr install --verify-repo=none --repository "${REPO}" scheme-full
else
  echo "Installing academic publishing suite..."
  echo "  - scheme-medium (plain, latex, latexrecommended [booktabs, caption, beamer, microtype, etc.])"
  echo "  - collection-latexextra (algorithmicx, multirow, manyfoot, listings, lipsum, authblk, etc.)"
  echo "  - collection-mathscience (siunitx, chemfig, mathrsfs, physics, etc.)"
  echo "  - collection-publishers (Springer Nature, IEEE, ACM, Elsevier, etc.)"
  echo "  - collection-fontsrecommended"
  echo "  - collection-bibtexextra"
  tlmgr install --verify-repo=none --repository "${REPO}" \
    scheme-medium \
    collection-latexextra \
    collection-mathscience \
    collection-publishers \
    collection-fontsrecommended \
    collection-bibtexextra
fi

echo "Updating system paths and font maps..."
tlmgr path add || true
fmtutil-sys --all || true

echo "=========================================================="
echo "TeX Live packages installed successfully!"
echo "=========================================================="
