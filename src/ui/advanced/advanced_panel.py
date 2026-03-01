"""
Advanced Mode Panel for ESP32 Gateway Configuration Tool
Contains tabbed interface for detailed configuration - 7 tabs
WiFi | LTE | Server | LoRa | CAN | RS485 | Firmware
"""

import tkinter as tk
from tkinter import ttk
from typing import Optional, Callable

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

import json as _json

from src.config.protocol import GatewayConfig, WanConfig, LanConfig
from src.config.paths import load_stack_id_map
from src.ui.advanced.wifi_tab import WiFiTab
from src.ui.advanced.lte_tab import LTETab
from src.ui.advanced.server_tab import ServerTab
from src.ui.advanced.firmware_tab import FirmwareTab
from src.ui.advanced.ble_tab import BLETab

# ── Tab class registry keyed by *type string* ───────────────────────────────
# Maps the "type" field from stack_id_map.json → ttk.Frame subclass.
# Add a new module type here AND import its tab class above.
_TYPE_TO_TAB: dict = {
    "BLE":    BLETab,
    # "ZIGBEE": ZigbeeTab,
}

# Emoji label prefix per type string (for notebook tab decoration)
_TYPE_TO_EMOJI: dict = {
    "BLE":    "🔷",
    "ZIGBEE": "🔶",
}


def _build_stack_registry() -> "dict[str, dict]":
    """Build _STACK_TYPE_REGISTRY from stack_id_map.json at import time.

    Format of each resulting entry::

        stack_id → {
            "tab_class":       <ttk.Frame subclass>,
            "cmd_prefix":      "CFBL" | "CFZG" | …,
            "label":           "🔷 BLE (STM32WB55)",
            "default_cmd_map": None,
        }

    Adding a new stack only requires:
      1. Updating stack_id_map.json (add an entry with json_file + cmd_prefix)
      2. Adding the tab class to _TYPE_TO_TAB above (if it is a new type)
    No other Python file needs to change.
    """
    data = load_stack_id_map()

    registry: dict = {}
    for sid, entry in data.get("lan_stack_map", {}).items():
        type_str = entry.get("type", "NONE")
        tab_cls  = _TYPE_TO_TAB.get(type_str)
        if tab_cls is None:
            continue   # NONE or unknown type — no tab
        emoji = _TYPE_TO_EMOJI.get(type_str, "🔷")
        registry[sid] = {
            "tab_class":       tab_cls,
            "cmd_prefix":      entry.get("cmd_prefix", "CFBL"),
            "label":           f"{emoji} {entry.get('label', type_str)}",
            "default_cmd_map": None,   # tab's built-in default
        }
    return registry


# ── Stack type registry ─────────────────────────────────────────────────────
# Built dynamically from stack_id_map.json so new stacks require zero Python edits.
_STACK_TYPE_REGISTRY: dict[str, dict] = _build_stack_registry()


class AdvancedPanel(ttk.Frame):
    """Advanced mode configuration panel with 7 tabs"""

    def __init__(self, parent, serial_manager=None,
                 log_callback: Optional[Callable] = None, **kwargs):
        super().__init__(parent, **kwargs)

        self.serial_manager = serial_manager
        self.log_callback = log_callback
        # Tracks live stack tabs: key = stack_idx (0 or 1), value = tab widget
        self._stack_tabs: dict[int, ttk.Frame] = {}
        self._create_widgets()
    
    def _create_widgets(self):
        """Create advanced mode widgets"""
        # Title
        title_frame = ttk.Frame(self)
        title_frame.pack(fill=tk.X, padx=10, pady=5)
        
        ttk.Label(title_frame, text="⚙️ ADVANCED CONFIGURATION",
                 font=("Segoe UI", 12, "bold")).pack(anchor="w")
        
        # Notebook — expand to fill available vertical space so inner content
        # (BLETab PanedWindow, etc.) gets the height it needs.
        self.notebook = ttk.Notebook(self)
        self.notebook.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        # Create WAN tabs: WiFi, LTE, Server
        self.wifi_tab = WiFiTab(self.notebook,
                                serial_manager=self.serial_manager,
                                log_callback=self.log_callback)
        self.lte_tab = LTETab(self.notebook,
                              serial_manager=self.serial_manager,
                              log_callback=self.log_callback)
        self.server_tab = ServerTab(self.notebook,
                                    serial_manager=self.serial_manager,
                                    log_callback=self.log_callback)
        self.firmware_tab = FirmwareTab(self.notebook,
                                        log_callback=self.log_callback)

        # Add fixed tabs — BLE tab added dynamically in set_config()
        self.notebook.add(self.wifi_tab,     text="📶 WiFi")
        self.notebook.add(self.lte_tab,      text="📱 LTE")
        self.notebook.add(self.server_tab,   text="☁️ Server")
        self.notebook.add(self.firmware_tab, text="🔄 FW")
    
    def set_config(self, config: GatewayConfig):
        """Set config to all tabs; create/destroy stack tabs dynamically."""
        # ── WAN tabs — each wrapped individually so a failure in one tab
        # does NOT prevent LAN stack tabs from being created below.
        if hasattr(config.wan, 'wifi_ssid'):
            try:
                self.wifi_tab.set_config(config.wan)
            except Exception as _e:
                if self.log_callback:
                    self.log_callback(f"[AdvancedPanel] wifi_tab.set_config ERROR: {_e}", "ERROR")
        if hasattr(config.wan, 'lte_apn'):
            try:
                self.lte_tab.set_config(config.wan)
            except Exception as _e:
                if self.log_callback:
                    self.log_callback(f"[AdvancedPanel] lte_tab.set_config ERROR: {_e}", "ERROR")
        if hasattr(config.wan, 'server_type'):
            try:
                self.server_tab.set_config(config.wan)
            except Exception as _e:
                if self.log_callback:
                    self.log_callback(f"[AdvancedPanel] server_tab.set_config ERROR: {_e}", "ERROR")

        try:
            # ── Dynamic LAN stack tabs ─────────────────────────────────────────
            # Iterate BOTH stack slots.  For each slot:
            #   • If stack_id is in the registry → ensure a tab exists (create if needed,
            #     update if already present with potentially new stack_id or cmd_map).
            #   • If stack_id is "000" or unknown → remove any existing tab for that slot.
            stack_info = config.lan.stack_info
            stack_pairs = [
                (0, stack_info.stack1_id),
                (1, stack_info.stack2_id),
            ]

            if self.log_callback:
                self.log_callback(
                    f"[AdvancedPanel] set_config: stack1_id={stack_info.stack1_id!r}, "
                    f"stack2_id={stack_info.stack2_id!r}", "INFO"
                )

            for stack_idx, stack_id in stack_pairs:
                reg = _STACK_TYPE_REGISTRY.get(stack_id)
                if reg:
                    # Build a meaningful tab label: e.g. "🔷 BLE (S1)"
                    slot_label = f"{reg['label']} (S{stack_idx + 1})"
                    if stack_idx in self._stack_tabs:
                        # Tab already exists for this slot — update it if the type changed
                        existing = self._stack_tabs[stack_idx]
                        if not isinstance(existing, reg["tab_class"]):
                            # Type changed (e.g. BLE → Zigbee): destroy old, create new
                            self.notebook.forget(existing)
                            existing.destroy()
                            del self._stack_tabs[stack_idx]
                        else:
                            # Same type — just update the stack pointer
                            if hasattr(existing, "set_stack"):
                                existing.set_stack(stack_idx, stack_id,
                                                   cmd_map=reg["default_cmd_map"])
                            self.notebook.tab(existing, text=slot_label)

                    if stack_idx not in self._stack_tabs:
                        # Create new tab for this stack slot
                        if self.log_callback:
                            self.log_callback(
                                f"[AdvancedPanel] Creating {reg['tab_class'].__name__} "
                                f"tab for slot {stack_idx} (id={stack_id!r})", "INFO"
                            )
                        tab = reg["tab_class"](
                            self.notebook,
                            serial_manager=self.serial_manager,
                            log_callback=self.log_callback,
                            stack_idx=stack_idx,
                            stack_id=stack_id,
                            cmd_prefix=reg["cmd_prefix"],
                            cmd_map=reg["default_cmd_map"],
                        )
                        self.notebook.insert(
                            self.notebook.index(self.firmware_tab),
                            tab, text=slot_label
                        )
                        self._stack_tabs[stack_idx] = tab
                        if self.log_callback:
                            self.log_callback(
                                f"[AdvancedPanel] Tab '{slot_label}' inserted into notebook",
                                "INFO"
                            )
                else:
                    # Stack slot is empty or type unknown — remove tab if present
                    if stack_idx in self._stack_tabs:
                        self.notebook.forget(self._stack_tabs[stack_idx])
                        self._stack_tabs[stack_idx].destroy()
                        del self._stack_tabs[stack_idx]

        except Exception as exc:
            import traceback
            err = traceback.format_exc()
            if self.log_callback:
                self.log_callback(f"[AdvancedPanel] stack-tab set_config ERROR: {exc}\n{err}", "ERROR")
            else:
                print(f"[AdvancedPanel] stack-tab set_config ERROR: {exc}\n{err}")
    
    def refresh_ports(self, ports: list):
        """Refresh port list in firmware tab"""
        self.firmware_tab.refresh_ports(ports)
