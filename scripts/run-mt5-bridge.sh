#!/usr/bin/env bash
set -euo pipefail

export HOME="${HOME:-/home/investfund-mt5}"
export DISPLAY="${DISPLAY:-:95}"
export WINEPREFIX="${WINEPREFIX:-$HOME/.wine-investfund}"

python_exe="${MT5_PYTHON_EXE:-$WINEPREFIX/drive_c/users/investfund-mt5/AppData/Local/Programs/Python/Python311/python.exe}"
bridge_script="${MT5_BRIDGE_SCRIPT:-/home/deno/web/ndumb.hs.vc/public_html/scripts/mt5-readonly-bridge.py}"

if [[ ! -f "$python_exe" ]]; then
  echo "MT5 Windows Python was not found: $python_exe" >&2
  exit 1
fi

if [[ ! -f "$bridge_script" ]]; then
  echo "MT5 bridge script was not found: $bridge_script" >&2
  exit 1
fi

bridge_windows="$(winepath -w "$bridge_script")"
exec wine "$python_exe" "$bridge_windows"
