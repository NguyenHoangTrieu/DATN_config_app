"""
Shared path resolution and JSON loading utilities.

Provides a single ``_resource_path()`` for the whole application so that both
dev-mode and PyInstaller-frozen builds resolve data files consistently.

EXE deployment support:
    When frozen (``sys.frozen == True``), the function checks the directory
    **next to the .exe** first — allowing users to drop new JSON files there
    without rebuilding.  If the file does not exist externally it falls back
    to the bundled ``sys._MEIPASS`` temporary directory.
"""

import json
import os
import sys
from typing import Optional


# ──────────────────────────────────────────────────────────────────
# Path resolution
# ──────────────────────────────────────────────────────────────────

def _resource_path(relative: str) -> str:
    """Resolve *relative* against the project root.

    Resolution order (frozen / PyInstaller):
        1. ``<exe_dir>/config/<filename>`` — flat config folder next to .exe
        2. ``<exe_dir>/<relative>``        — full relative path next to .exe
        3. ``<sys._MEIPASS>/<relative>``   — bundled inside the archive

    This means users can simply drop updated JSON files into a ``config/``
    folder next to the .exe — no rebuild required.

    Resolution (dev / source):
        ``<project_root>/<relative>``  where project_root is three levels
        above this file (``src/config/paths.py``).
    """
    if getattr(sys, "frozen", False):
        exe_dir = os.path.dirname(sys.executable)
        # Priority 1: flat <exe_dir>/config/<filename>  (easiest for users)
        basename = os.path.basename(relative)
        flat = os.path.join(exe_dir, "config", basename)
        if os.path.exists(flat):
            return flat
        # Priority 2: full relative path next to exe (e.g. src/config/...)
        external = os.path.join(exe_dir, relative)
        if os.path.exists(external):
            return external
        # Priority 3: bundled inside PyInstaller archive
        return os.path.join(sys._MEIPASS, relative)  # type: ignore[attr-defined]
    else:
        base = os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        )
        return os.path.join(base, relative)


# ──────────────────────────────────────────────────────────────────
# stack_id_map.json helpers
# ──────────────────────────────────────────────────────────────────

def load_stack_id_map() -> dict:
    """Load and return the full ``stack_id_map.json`` content."""
    path = _resource_path("src/config/stack_id_map.json")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


def build_gateway_json_map() -> dict[str, str]:
    """Build ``{stack_id: relative_path}`` from the ``gateway_json`` field.

    Used by main.py to auto-send the default JSON config to the gateway
    when a stack slot reports ``json_len == 0``.
    """
    data = load_stack_id_map()
    result: dict[str, str] = {}
    for sid, entry in data.get("lan_stack_map", {}).items():
        gj = entry.get("gateway_json")
        if gj:
            result[sid] = f"src/config/{gj}"
    return result


def load_app_commands(stack_id: str) -> Optional[dict]:
    """Load the ``app_commands_json`` for *stack_id*.

    Returns the parsed dict or ``None`` if the stack has no app-commands
    file configured or the file cannot be read.
    """
    data = load_stack_id_map()
    entry = data.get("lan_stack_map", {}).get(stack_id, {})
    acj = entry.get("app_commands_json")
    if not acj:
        return None
    path = _resource_path(f"src/config/{acj}")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


# Module-level convenience — built once at import time.
STACK_DEFAULT_JSON: dict[str, str] = build_gateway_json_map()
