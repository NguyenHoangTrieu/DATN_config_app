"""
Advanced Mode Panel for ESP32 Gateway Configuration Tool
Contains tabbed interface for detailed configuration.
Tabs: WiFi | LTE | Server | BLE | LoRa | Zigbee | FW

BLE / LoRa / Zigbee tabs are always visible (v5.0 JSON Config Builder).
"""

import tkinter as tk
from tkinter import ttk
from typing import Optional, Callable

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from src.config.protocol import GatewayConfig
from src.ui.advanced.wifi_tab import WiFiTab
from src.ui.advanced.lte_tab import LTETab
from src.ui.advanced.server_tab import ServerTab
from src.ui.advanced.firmware_tab import FirmwareTab
from src.ui.advanced.ble_tab import BLETab
from src.ui.advanced.ble_native_tab import BleNativeTab
from src.ui.advanced.lora_tab import LoRaTab
from src.ui.advanced.zigbee_tab import ZigbeeTab
from src.ui.advanced.rs485_tab import Rs485Tab


class AdvancedPanel(ttk.Frame):
    """Advanced mode configuration panel."""

    def __init__(self, parent, serial_manager=None,
                 log_callback: Optional[Callable] = None, **kwargs):
        super().__init__(parent, **kwargs)

        self.serial_manager = serial_manager
        self.log_callback = log_callback
        self._create_widgets()

    def _create_widgets(self):
        title_frame = ttk.Frame(self)
        title_frame.pack(fill=tk.X, padx=10, pady=5)

        ttk.Label(title_frame, text="⚙️ ADVANCED CONFIGURATION",
                  font=("Segoe UI", 12, "bold")).pack(anchor="w")

        self.notebook = ttk.Notebook(self)
        self.notebook.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)

        _sm = self.serial_manager
        _log = self.log_callback

        # WAN tabs
        self.wifi_tab = WiFiTab(self.notebook, serial_manager=_sm,
                                log_callback=_log)
        self.lte_tab = LTETab(self.notebook, serial_manager=_sm,
                               log_callback=_log)
        self.server_tab = ServerTab(self.notebook, serial_manager=_sm,
                                     log_callback=_log)

        # LAN module tabs (always visible)
        self.ble_tab = BLETab(self.notebook, serial_manager=_sm,
                               log_callback=_log)
        self.ble_native_tab = BleNativeTab(self.notebook, serial_manager=_sm,
                                            log_callback=_log)
        self.lora_tab = LoRaTab(self.notebook, serial_manager=_sm,
                                 log_callback=_log)
        self.zigbee_tab = ZigbeeTab(self.notebook, serial_manager=_sm,
                                     log_callback=_log)
        self.rs485_tab = Rs485Tab(self.notebook, serial_manager=_sm,
                                   log_callback=_log)

        # Firmware tab
        self.firmware_tab = FirmwareTab(self.notebook, log_callback=_log,
                                         serial_manager=_sm)

        # Add tabs to notebook
        self.notebook.add(self.wifi_tab,     text="📶 WiFi")
        self.notebook.add(self.lte_tab,      text="📱 LTE")
        self.notebook.add(self.server_tab,   text="☁️ Server")
        self.notebook.add(self.ble_tab,        text="🔷 BLE")
        self.notebook.add(self.ble_native_tab, text="🔵 BLE Native")
        self.notebook.add(self.lora_tab,       text="🟩 LoRa")
        self.notebook.add(self.zigbee_tab,   text="🔶 Zigbee")
        self.notebook.add(self.rs485_tab,    text="🔌 RS485")
        self.notebook.add(self.firmware_tab, text="🔄 FW")

    def set_config(self, config: GatewayConfig):
        """Push WAN config to WiFi / LTE / Server tabs."""
        if hasattr(config.wan, 'wifi_ssid'):
            try:
                self.wifi_tab.set_config(config.wan)
            except Exception as _e:
                if self.log_callback:
                    self.log_callback(
                        f"[AdvancedPanel] wifi_tab.set_config ERROR: {_e}", "ERROR")
        if hasattr(config.wan, 'lte_apn'):
            try:
                self.lte_tab.set_config(config.wan)
            except Exception as _e:
                if self.log_callback:
                    self.log_callback(
                        f"[AdvancedPanel] lte_tab.set_config ERROR: {_e}", "ERROR")
        if hasattr(config.wan, 'server_type'):
            try:
                self.server_tab.set_config(config.wan)
            except Exception as _e:
                if self.log_callback:
                    self.log_callback(
                        f"[AdvancedPanel] server_tab.set_config ERROR: {_e}", "ERROR")

    def refresh_ports(self, ports: list):
        """Refresh port list in firmware tab."""
        self.firmware_tab.refresh_ports(ports)
