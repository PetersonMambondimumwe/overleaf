#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-${TEXLIVE_PROFILE:-academic}}"

echo "=========================================================="
echo "TeX Live Installer for Overleaf Community Edition"
echo "Target Profile: ${PROFILE}"
echo "=========================================================="

if [ "${PROFILE}" = "none" ] || [ "${PROFILE}" = "skip" ]; then
  echo "Skipping TeX Live package installation as requested (profile: ${PROFILE})."
  exit 0
fi

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

# CRITICAL: When CTAN releases infrastructure updates, tlmgr refuses to install
# any package until 'tlmgr update --self' has completed.
echo "Updating TeX Live package manager infrastructure (tlmgr update --self)..."
for attempt in 1 2 3; do
  echo "Running 'tlmgr update --self' (attempt ${attempt}/3)..."
  if tlmgr --verify-repo=none --repository "${REPO}" update --self; then
    echo "tlmgr self-update succeeded."
    break
  else
    echo "Warning: tlmgr update --self attempt ${attempt} returned non-zero."
    if [ "${attempt}" -lt 3 ]; then
      echo "Attempting official CTAN update-tlmgr-latest.sh script..."
      TMP_UPDATER="/tmp/update-tlmgr-latest.sh"
      if curl -fsSL "https://mirror.ctan.org/systems/texlive/tlnet/update-tlmgr-latest.sh" -o "${TMP_UPDATER}" 2>/dev/null || \
         wget -qO "${TMP_UPDATER}" "https://mirror.ctan.org/systems/texlive/tlnet/update-tlmgr-latest.sh" 2>/dev/null; then
        chmod +x "${TMP_UPDATER}"
        sh "${TMP_UPDATER}" -- --upgrade || true
        rm -f "${TMP_UPDATER}"
      fi
      sleep 2
    fi
  fi
done

hash -r || true

install_with_retry() {
  local target="$1"
  echo "--> Installing package / collection: ${target}..."
  for attempt in 1 2 3; do
    if tlmgr install --verify-repo=none --repository "${REPO}" "${target}"; then
      echo "--> Successfully installed: ${target}"
      return 0
    else
      echo "--> Warning: Attempt ${attempt}/3 for ${target} failed."
      if [ "${attempt}" -lt 3 ]; then
        echo "--> Retrying ${target} in 5 seconds..."
        sleep 5
      fi
    fi
  done
  echo "--> ERROR: Failed to install ${target} after 3 attempts."
  return 1
}

if [ "${PROFILE}" = "full" ]; then
  echo "Installing scheme-full (all CTAN packages)..."
  install_with_retry scheme-full
elif [ "${PROFILE}" = "essential" ] || [ "${PROFILE}" = "fast" ]; then
  echo "Installing essential academic packages..."
  ESSENTIAL_PKGS=(
    "booktabs"
    "caption"
    "beamer"
    "multirow"
    "ncctools"
    "algorithmicx"
    "algorithms"
    "listings"
    "lipsum"
    "authblk"
    "siunitx"
    "physics"
    "cite"
    "amsmath"
    "hyperref"
    "xcolor"
    "microtype"
  )
  for pkg in "${ESSENTIAL_PKGS[@]}"; do
    install_with_retry "${pkg}"
  done
else
  echo "Installing academic publishing suite..."
  # First ensure the most commonly requested journal/article packages are installed
  CORE_PKGS=(
    "booktabs"
    "multirow"
    "ncctools"
    "algorithmicx"
    "algorithms"
  )
  for pkg in "${CORE_PKGS[@]}"; do
    install_with_retry "${pkg}"
  done

  # Then install broader academic collections
  ACADEMIC_COLLECTIONS=(
    "scheme-medium"
    "collection-latexextra"
    "collection-mathscience"
    "collection-publishers"
    "collection-fontsrecommended"
    "collection-bibtexextra"
  )
  for coll in "${ACADEMIC_COLLECTIONS[@]}"; do
    install_with_retry "${coll}"
  done
fi

echo "Updating system paths and font maps..."
tlmgr path add || true
updmap-sys || true
fmtutil-sys --all || true

echo "=========================================================="
echo "TeX Live packages installed successfully!"
echo "=========================================================="
