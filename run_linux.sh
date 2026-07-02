#!/bin/bash
# ========================================
# Run Gateway Config Tool from source (Linux)
# ========================================
# No build/compile step — runs main.py directly with system Python.
# Requires: python3-tk python3-serial python3-pil python3-ttkthemes
#   sudo apt install python3-tk python3-serial python3-pil python3-ttkthemes

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

python3 -c "import tkinter, serial, PIL, ttkthemes" 2>/dev/null || {
    echo "ERROR: missing dependencies. Install them with:"
    echo "  sudo apt install python3-tk python3-serial python3-pil python3-ttkthemes"
    exit 1
}

exec python3 main.py
