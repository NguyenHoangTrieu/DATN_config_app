"""
Basic Mode Panel for ESP32 Gateway Configuration Tool
Simple configuration interface with 4 tabs
"""

import tkinter as tk
from tkinter import ttk, messagebox
from typing import Callable, Optional
import threading
import time

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

import json

from src.config.protocol import GatewayConfig
from src.config.protocol import (
    SERVER_TYPE_LABELS, SERVER_TYPE_FROM_LABEL,
    SERVER_TYPE_MQTT, SERVER_TYPE_COAP, SERVER_TYPE_HTTP,
    build_server_type_cmd, build_mqtt_cmd, build_http_cmd, build_coap_cmd,
)
from src.config.paths import load_stack_id_map
from src.ui.basic.ble_basic_tab import BLEBasicTab

_STACK_ID_BLE = "002"  # kept for backward compatibility — use _LAN_STACK_REGISTRY below

# ── LAN stack type registry ───────────────────────────────────────────────────
# Maps stack_id → metadata for dynamic widget creation in the Interfaces tab.
# To add a new module type (e.g. Zigbee):
#   1. Create ZigbeeBasicTab in src/ui/basic/zigbee_basic_tab.py
#   2. Import it here, add an entry below.
_LAN_STACK_REGISTRY: dict[str, dict] = {
    "002": {
        "widget_class": BLEBasicTab,
        "cmd_prefix":   "CFBL",
        "default_cmd_map": None,   # None → BLEBasicTab loads from JSON
        "label":        "🔷 BLE",
    },
    "004": {
        "widget_class": BLEBasicTab,
        "cmd_prefix":   "CFBL",
        "default_cmd_map": None,
        "label":        "🔷 BLE",
    },
    # "001": {
    #     "widget_class": ZigbeeBasicTab,
    #     "cmd_prefix":   "CFZG",
    #     "default_cmd_map": None,
    #     "label":        "🔶 Zigbee",
    # },
}

_STACK_MAP = load_stack_id_map()


class BasicPanel(ttk.Frame):
    """Basic mode configuration panel with tabs"""
    
    def __init__(self, parent, serial_manager=None, log_callback=None, **kwargs):
        super().__init__(parent, **kwargs)
        
        self.serial_manager = serial_manager
        self.log = log_callback or (lambda msg, lvl: None)
        self._create_widgets()
    
    def _create_widgets(self):
        """Create tabbed interface"""
        # Title
        title_frame = ttk.Frame(self)
        title_frame.pack(fill=tk.X, padx=10, pady=5)

        ttk.Label(title_frame, text="📋 BASIC CONFIGURATION",
                 font=("Segoe UI", 12, "bold")).pack(anchor="w")

        # Notebook — fixed tabs first, dynamic module tabs added by set_config()
        self.notebook = ttk.Notebook(self)
        self.notebook.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)

        # Tracks dynamically-added LAN stack tabs: key = stack slot (0 or 1)
        self._stack_tabs: dict[int, ttk.Frame] = {}

        # Create fixed tabs
        self._create_wifi_tab()
        self._create_lte_tab()
        self._create_server_tab()
        self._create_interfaces_tab()
    
    def _create_wifi_tab(self):
        """Create WiFi configuration tab"""
        tab = ttk.Frame(self.notebook, padding=10)
        self.notebook.add(tab, text="📶 WiFi")
        
        # WiFi Settings LabelFrame
        wifi_frame = ttk.LabelFrame(tab, text="WiFi Settings", padding=10)
        wifi_frame.pack(fill=tk.X, pady=5)
        
        # SSID
        row1 = ttk.Frame(wifi_frame)
        row1.pack(fill=tk.X, pady=3)
        ttk.Label(row1, text="SSID:", width=15).pack(side=tk.LEFT)
        self.wifi_ssid_var = tk.StringVar()
        ttk.Entry(row1, textvariable=self.wifi_ssid_var).pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)
        
        # Password
        row2 = ttk.Frame(wifi_frame)
        row2.pack(fill=tk.X, pady=3)
        ttk.Label(row2, text="Password:", width=15).pack(side=tk.LEFT)
        
        # Pack Checkbutton first (right side)
        self.show_pwd_var = tk.BooleanVar()
        ttk.Checkbutton(row2, text="Show", variable=self.show_pwd_var,
                       command=lambda: self.wifi_pwd_entry.config(show="" if self.show_pwd_var.get() else "*")
                       ).pack(side=tk.RIGHT, padx=5)
        
        # Then Entry fills remaining space
        self.wifi_pwd_var = tk.StringVar()
        self.wifi_pwd_entry = ttk.Entry(row2, textvariable=self.wifi_pwd_var, show="*")
        self.wifi_pwd_entry.pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)
        
        # Auth Mode - only PERSONAL (0) or ENTERPRISE (1)
        row3 = ttk.Frame(wifi_frame)
        row3.pack(fill=tk.X, pady=3)
        ttk.Label(row3, text="Auth Mode:", width=15).pack(side=tk.LEFT)
        self.wifi_auth_var = tk.StringVar(value="PERSONAL")
        auth_combo = ttk.Combobox(row3, textvariable=self.wifi_auth_var, state="readonly",
                                  values=["PERSONAL", "ENTERPRISE"])
        auth_combo.pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)
        auth_combo.bind("<<ComboboxSelected>>", self._on_wifi_auth_change)
        
        # Username (Enterprise only) - Initially hidden
        self.wifi_username_frame = ttk.Frame(wifi_frame)
        # Don't pack initially - hidden when PERSONAL
        ttk.Label(self.wifi_username_frame, text="Username:", width=15).pack(side=tk.LEFT)
        self.wifi_username_var = tk.StringVar()
        ttk.Entry(self.wifi_username_frame, textvariable=self.wifi_username_var).pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)
        
        # Set Button
        btn_frame = ttk.Frame(tab)
        btn_frame.pack(fill=tk.X, pady=10)
        ttk.Button(btn_frame, text="Set WiFi Config", style='Set.TButton',
                  command=self._set_wifi_config).pack(anchor="e", padx=5)
    
    def _on_wifi_auth_change(self, event=None):
        """Handle WiFi auth mode change - show/hide username field"""
        if self.wifi_auth_var.get() == "ENTERPRISE":
            self.wifi_username_frame.pack(fill=tk.X, pady=3)
        else:
            self.wifi_username_frame.pack_forget()
            self.wifi_username_var.set("")
    
    def _create_lte_tab(self):
        """Create LTE configuration tab (hidden when no LTE adapter present)"""
        tab = ttk.Frame(self.notebook, padding=10)
        self._lte_tab_frame = tab

        # Hidden-from-user defaults populated by set_config() from stack_id_map
        self._lte_modem_default  = ""
        self._lte_comm_default   = "USB"
        self._lte_pwr_default    = "WK"
        self._lte_rst_default    = "PE"

        # Adapter info row (read-only)
        info_row = ttk.Frame(tab)
        info_row.pack(fill=tk.X, pady=(0, 4))
        ttk.Label(info_row, text="LTE Module:", width=15).pack(side=tk.LEFT)
        self._lte_modem_info_var = tk.StringVar(value="—")
        ttk.Label(info_row, textvariable=self._lte_modem_info_var,
                  foreground="#1565C0", font=("Segoe UI", 9, "bold")).pack(side=tk.LEFT, padx=4)

        # LTE Settings LabelFrame
        lte_frame = ttk.LabelFrame(tab, text="LTE Settings", padding=10)
        lte_frame.pack(fill=tk.X, pady=5)

        # APN
        row1 = ttk.Frame(lte_frame)
        row1.pack(fill=tk.X, pady=3)
        ttk.Label(row1, text="APN:", width=15).pack(side=tk.LEFT)
        self.lte_apn_var = tk.StringVar(value="internet")
        ttk.Entry(row1, textvariable=self.lte_apn_var).pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)

        # Username
        row2 = ttk.Frame(lte_frame)
        row2.pack(fill=tk.X, pady=3)
        ttk.Label(row2, text="Username:", width=15).pack(side=tk.LEFT)
        self.lte_user_var = tk.StringVar()
        ttk.Entry(row2, textvariable=self.lte_user_var).pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)

        # Password
        row3 = ttk.Frame(lte_frame)
        row3.pack(fill=tk.X, pady=3)
        ttk.Label(row3, text="Password:", width=15).pack(side=tk.LEFT)
        self.lte_pwd_var = tk.StringVar()
        self.lte_pwd_entry = ttk.Entry(row3, textvariable=self.lte_pwd_var, show="*")
        self.lte_pwd_entry.pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)
        self.show_lte_pwd_var = tk.BooleanVar()
        ttk.Checkbutton(row3, text="Show", variable=self.show_lte_pwd_var,
                        command=lambda: self.lte_pwd_entry.config(
                            show="" if self.show_lte_pwd_var.get() else "*")
                        ).pack(side=tk.LEFT, padx=5)

        # Set Button
        btn_frame = ttk.Frame(tab)
        btn_frame.pack(fill=tk.X, pady=10)
        ttk.Button(btn_frame, text="✅ Set LTE Config", style='Set.TButton',
                   command=self._set_lte_config).pack(anchor="e", padx=5)

        # NOTE: tab is NOT added to notebook here.
        # set_config() will add/remove it based on wan_stack_id.
    
    def _create_server_tab(self):
        """Create Server configuration tab"""
        tab = ttk.Frame(self.notebook, padding=10)
        self.notebook.add(tab, text="🌐 Server")

        # ── Server Type ───────────────────────────────────────────────────
        type_frame = ttk.LabelFrame(tab, text="Server Type", padding=8)
        type_frame.pack(fill=tk.X, pady=5)

        row = ttk.Frame(type_frame)
        row.pack(fill=tk.X, pady=3)
        ttk.Label(row, text="Type:", width=15).pack(side=tk.LEFT)
        self.server_type_var = tk.StringVar(value="MQTT")
        _labels = list(SERVER_TYPE_LABELS.values())
        self._server_type_combo = ttk.Combobox(row, textvariable=self.server_type_var,
                                               state="readonly", values=_labels)
        self._server_type_combo.pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)
        self._server_type_combo.bind("<<ComboboxSelected>>", self._on_server_type_change)

        # Container for protocol-specific frames
        self._server_proto_container = tab

        # ── MQTT frame ───────────────────────────────────────────────────
        self._mqtt_settings_frame = ttk.LabelFrame(tab, text="MQTT Settings", padding=10)

        row1 = ttk.Frame(self._mqtt_settings_frame)
        row1.pack(fill=tk.X, pady=3)
        ttk.Label(row1, text="Broker:", width=15).pack(side=tk.LEFT)
        self.mqtt_broker_var = tk.StringVar(value="mqtt.thingsboard.cloud")
        ttk.Entry(row1, textvariable=self.mqtt_broker_var).pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)

        row2 = ttk.Frame(self._mqtt_settings_frame)
        row2.pack(fill=tk.X, pady=3)
        ttk.Label(row2, text="Device Token:", width=15).pack(side=tk.LEFT)
        self.show_token_var = tk.BooleanVar()
        ttk.Checkbutton(row2, text="Show", variable=self.show_token_var,
                       command=lambda: self.mqtt_token_entry.config(
                           show="" if self.show_token_var.get() else "*")
                       ).pack(side=tk.RIGHT, padx=5)
        self.mqtt_token_var = tk.StringVar()
        self.mqtt_token_entry = ttk.Entry(row2, textvariable=self.mqtt_token_var, show="*")
        self.mqtt_token_entry.pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)

        ttk.Label(self._mqtt_settings_frame, text="💡 Get token from ThingsBoard dashboard",
                 font=("Segoe UI", 9), foreground="#757575").pack(anchor="w", pady=(5, 0))

        # ── HTTP frame ───────────────────────────────────────────────────
        self._http_settings_frame = ttk.LabelFrame(tab, text="HTTP / HTTPS Settings", padding=10)

        _r = ttk.Frame(self._http_settings_frame)
        _r.pack(fill=tk.X, pady=3)
        ttk.Label(_r, text="Server URL:", width=15).pack(side=tk.LEFT)
        self.http_url_var = tk.StringVar(value="http://server:8080/api/v1/{token}/telemetry")
        ttk.Entry(_r, textvariable=self.http_url_var).pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)

        _r = ttk.Frame(self._http_settings_frame)
        _r.pack(fill=tk.X, pady=3)
        ttk.Label(_r, text="Auth Token:", width=15).pack(side=tk.LEFT)
        self.http_token_var = tk.StringVar()
        ttk.Entry(_r, textvariable=self.http_token_var).pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)

        _r = ttk.Frame(self._http_settings_frame)
        _r.pack(fill=tk.X, pady=3)
        self.http_tls_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(_r, text="Use TLS (HTTPS)", variable=self.http_tls_var).pack(side=tk.LEFT, padx=5)

        ttk.Label(self._http_settings_frame,
                  text="💡 Use {token} in URL to inject auth token",
                  font=("Segoe UI", 9), foreground="#757575").pack(anchor="w", pady=(5, 0))

        # ── CoAP frame ──────────────────────────────────────────────────
        self._coap_settings_frame = ttk.LabelFrame(tab, text="CoAP Settings", padding=10)

        _r = ttk.Frame(self._coap_settings_frame)
        _r.pack(fill=tk.X, pady=3)
        ttk.Label(_r, text="Host:", width=15).pack(side=tk.LEFT)
        self.coap_host_var = tk.StringVar(value="demo.thingsboard.io")
        ttk.Entry(_r, textvariable=self.coap_host_var).pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)

        _r = ttk.Frame(self._coap_settings_frame)
        _r.pack(fill=tk.X, pady=3)
        ttk.Label(_r, text="Resource Path:", width=15).pack(side=tk.LEFT)
        self.coap_resource_var = tk.StringVar(value="/api/v1/{token}/telemetry")
        ttk.Entry(_r, textvariable=self.coap_resource_var).pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)

        _r = ttk.Frame(self._coap_settings_frame)
        _r.pack(fill=tk.X, pady=3)
        ttk.Label(_r, text="Device Token:", width=15).pack(side=tk.LEFT)
        self.coap_token_var = tk.StringVar()
        ttk.Entry(_r, textvariable=self.coap_token_var).pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)

        ttk.Label(self._coap_settings_frame,
                  text="💡 Use {token} in Resource Path to inject device token",
                  font=("Segoe UI", 9), foreground="#757575").pack(anchor="w", pady=(5, 0))

        # Set Button
        btn_frame = ttk.Frame(tab)
        btn_frame.pack(fill=tk.X, pady=10)
        ttk.Button(btn_frame, text="Set Server Config", style='Set.TButton',
                  command=self._set_server_config).pack(anchor="e", padx=5)

        # Show default frame
        self._on_server_type_change()
    
    def _on_server_type_change(self, event=None):
        """Show/hide server type-specific settings frame"""
        stype = self.server_type_var.get()
        for frame in (self._mqtt_settings_frame,
                      self._http_settings_frame,
                      self._coap_settings_frame):
            frame.pack_forget()
        if stype == "MQTT":
            self._mqtt_settings_frame.pack(fill=tk.X, pady=5)
        elif stype == "HTTP/HTTPS":
            self._http_settings_frame.pack(fill=tk.X, pady=5)
        elif stype == "CoAP":
            self._coap_settings_frame.pack(fill=tk.X, pady=5)

    def _create_interfaces_tab(self):
        """Create a read-only 'Detected Stacks' status tab."""
        tab = ttk.Frame(self.notebook, padding=10)
        self._interfaces_tab_frame = tab
        self.notebook.add(tab, text="🔌 Interfaces")

        info_frame = ttk.LabelFrame(tab, text="Detected LAN Stacks", padding=10)
        info_frame.pack(fill=tk.X, pady=5)

        r1 = ttk.Frame(info_frame); r1.pack(fill=tk.X, pady=3)
        ttk.Label(r1, text="Stack 1:", width=12).pack(side=tk.LEFT)
        self._stack1_info_var = tk.StringVar(value="— (not loaded)")
        ttk.Label(r1, textvariable=self._stack1_info_var,
                  foreground="#1565C0", font=("Segoe UI", 9, "bold")).pack(side=tk.LEFT, padx=4)

        r2 = ttk.Frame(info_frame); r2.pack(fill=tk.X, pady=3)
        ttk.Label(r2, text="Stack 2:", width=12).pack(side=tk.LEFT)
        self._stack2_info_var = tk.StringVar(value="— (not loaded)")
        ttk.Label(r2, textvariable=self._stack2_info_var,
                  foreground="#1565C0", font=("Segoe UI", 9, "bold")).pack(side=tk.LEFT, padx=4)

        ttk.Label(info_frame,
                  text="💡 Module config tabs appear automatically when a module stack is detected.",
                  font=("Segoe UI", 9), foreground="#757575",
                  wraplength=380).pack(anchor="w", pady=(8, 0))
    
    def _check_connection(self) -> bool:
        """Check if serial is connected"""
        if not self.serial_manager or not self.serial_manager.is_connected():
            messagebox.showwarning("Warning", "Not connected to gateway")
            return False
        return True
    
    def _send_command(self, cmd: str, description: str):
        """Send command without waiting for response"""
        self.log(f"Sending: {description}", "INFO")
        if self.serial_manager.send(cmd):
            self.log(f"{description} - Sent", "SUCCESS")
        else:
            self.log(f"{description} - Send failed", "ERROR")
    
    def _set_wifi_config(self):
        """Set WiFi configuration"""
        if not self._check_connection():
            return
        
        ssid = self.wifi_ssid_var.get().strip()
        password = self.wifi_pwd_var.get()
        auth = self.wifi_auth_var.get()
        username = self.wifi_username_var.get().strip()
        
        if not ssid:
            messagebox.showwarning("Warning", "Please enter WiFi SSID")
            return
        
        # Validate username for Enterprise mode
        if auth == "ENTERPRISE" and not username:
            messagebox.showwarning("Warning", "Please enter Username for Enterprise mode")
            return
        
        # Build CFWF command: CFWF:SSID:PASSWORD:AUTH_MODE or CFWF:SSID:PASSWORD:USERNAME:AUTH_MODE
        if auth == "ENTERPRISE":
            cmd = f"CFWF:{ssid}:{password}:{username}:ENTERPRISE"
        else:
            cmd = f"CFWF:{ssid}:{password}:PERSONAL"
        
        # Send CFWF first, then CFIN:WIFI after 1s delay (no response waiting)
        def send_wifi_sequence():
            import time
            self.log(f"Sending: WiFi Config", "INFO")
            self.serial_manager.send(cmd)
            self.log(f"WiFi Config - Sent", "SUCCESS")
            
            # Wait 1s before sending CFIN:WIFI
            time.sleep(1.0)
            
            self.log(f"Sending: Set Internet Type = WIFI", "INFO")
            self.serial_manager.send("CFIN:WIFI")
            self.log(f"Set Internet Type = WIFI - Sent", "SUCCESS")
        
        thread = threading.Thread(target=send_wifi_sequence)
        thread.daemon = True
        thread.start()
    
    def _set_lte_config(self):
        """Set LTE configuration using full CFLT format"""
        if not self._check_connection():
            return

        apn  = self.lte_apn_var.get().strip()
        user = self.lte_user_var.get().strip()
        pwd  = self.lte_pwd_var.get()

        if not apn:
            messagebox.showwarning("Warning", "Please enter APN")
            return

        # CFLT:MODEM:APN:USER:PASS:COMM:AUTO:TIMEOUT_MS:MAX_RETRY:PWR:RST
        cmd = (f"CFLT:{self._lte_modem_default}:{apn}:{user}:{pwd}"
               f":{self._lte_comm_default}:true:30000:0"
               f":{self._lte_pwr_default}:{self._lte_rst_default}")

        def send_lte_sequence():
            self.log(f"→ {cmd}", "DEBUG")
            self.serial_manager.send(cmd)
            self.log("✓ LTE Config sent", "SUCCESS")
            time.sleep(1.0)
            self.log("→ CFIN:LTE", "DEBUG")
            self.serial_manager.send("CFIN:LTE")
            self.log("✓ Internet type = LTE set", "SUCCESS")

        thread = threading.Thread(target=send_lte_sequence, daemon=True)
        thread.start()
    
    def _set_server_config(self):
        """Set Server configuration"""
        if not self._check_connection():
            return

        label = self.server_type_var.get()
        type_code = SERVER_TYPE_FROM_LABEL.get(label, SERVER_TYPE_MQTT)

        # Always send CFSV first
        self._send_command(build_server_type_cmd(type_code),
                           f"Set Server Type = {label}")

        if label == "MQTT":
            broker = self.mqtt_broker_var.get().strip()
            token  = self.mqtt_token_var.get().strip()
            if not broker:
                messagebox.showwarning("Warning", "Please enter MQTT broker")
                return
            # Use default ThingsBoard topics
            sub_topic  = "v1/devices/me/rpc/request/+"
            pub_topic  = "v1/devices/me/telemetry"
            attr_topic = "v1/devices/me/attributes"
            self._send_command(
                build_mqtt_cmd(broker, token, sub_topic, pub_topic, attr_topic),
                "MQTT Config")

        elif label == "HTTP/HTTPS":
            url   = self.http_url_var.get().strip()
            token = self.http_token_var.get().strip()
            if not url:
                messagebox.showwarning("Warning", "Please enter HTTP server URL")
                return
            self._send_command(
                build_http_cmd(url, token, 8080,
                               self.http_tls_var.get(), False, 10000),
                "HTTP Config")

        elif label == "CoAP":
            host     = self.coap_host_var.get().strip()
            resource = self.coap_resource_var.get().strip()
            token    = self.coap_token_var.get().strip()
            if not host:
                messagebox.showwarning("Warning", "Please enter CoAP server host")
                return
            self._send_command(
                build_coap_cmd(host, resource, token),
                "CoAP Config")
    
    def set_config(self, config: GatewayConfig):
        """Set config values from loaded config"""
        # WiFi
        self.wifi_ssid_var.set(config.wan.wifi_ssid or "")
        if config.wan.wifi_password and config.wan.wifi_password != "***HIDDEN***":
            self.wifi_pwd_var.set(config.wan.wifi_password)

        # LTE — show/hide tab based on wan_stack_id
        wan_id  = getattr(config.wan, "stack_wan_id", "100") or "100"
        wan_map = _STACK_MAP.get("wan_stack_map", {})
        lte_entry = wan_map.get(wan_id, {})

        # Determine whether LTE tab should be visible
        lte_visible = lte_entry.get("type", "NONE") != "NONE"
        # Manage tab presence in notebook
        tab_ids = list(self.notebook.tabs())
        lte_frame_id = str(self._lte_tab_frame)
        tab_present = lte_frame_id in tab_ids
        if lte_visible and not tab_present:
            self.notebook.insert(1, self._lte_tab_frame, text="📱 LTE")
        elif not lte_visible and tab_present:
            self.notebook.forget(self._lte_tab_frame)

        if lte_visible:
            # Auto-fill hidden defaults
            self._lte_modem_default = lte_entry.get("modem", getattr(config.wan, "lte_modem_name", "") or "")
            self._lte_comm_default  = lte_entry.get("comm_type", getattr(config.wan, "lte_comm_type", "USB") or "USB")
            self._lte_pwr_default   = lte_entry.get("pwr_pin",  getattr(config.wan, "lte_pwr_pin", "WK") or "WK")
            self._lte_rst_default   = lte_entry.get("rst_pin",  getattr(config.wan, "lte_rst_pin", "PE") or "PE")
            label = lte_entry.get("label", f"Stack {wan_id}")
            self._lte_modem_info_var.set(f"{self._lte_modem_default}  ({label})")
            # Populate user-editable fields
            self.lte_apn_var.set(getattr(config.wan, "lte_apn", "") or "")
            self.lte_user_var.set(getattr(config.wan, "lte_username", "") or "")
            pwd = getattr(config.wan, "lte_password", "") or ""
            if pwd and pwd != "***HIDDEN***":
                self.lte_pwd_var.set(pwd)

        # Server
        # — type
        srv_str = getattr(config.wan, 'server_type', 'MQTT') or 'MQTT'
        srv_label = SERVER_TYPE_LABELS.get(
            SERVER_TYPE_FROM_LABEL.get(srv_str, SERVER_TYPE_MQTT), "MQTT"
        ) if srv_str in SERVER_TYPE_FROM_LABEL else "MQTT"
        self.server_type_var.set(srv_label)
        self._on_server_type_change()
        # — MQTT
        self.mqtt_broker_var.set(config.wan.mqtt_broker or "mqtt.thingsboard.cloud")
        if config.wan.mqtt_device_token and config.wan.mqtt_device_token != "***HIDDEN***":
            self.mqtt_token_var.set(config.wan.mqtt_device_token)
        # — HTTP
        self.http_url_var.set(getattr(config.wan, 'http_url', '') or '')
        http_tok = getattr(config.wan, 'http_auth_token', '') or ''
        if http_tok and http_tok != '***HIDDEN***':
            self.http_token_var.set(http_tok)
        self.http_tls_var.set(bool(getattr(config.wan, 'http_use_tls', False)))
        # — CoAP
        self.coap_host_var.set(getattr(config.wan, 'coap_host', '') or '')
        self.coap_resource_var.set(getattr(config.wan, 'coap_resource_path', '') or '')
        coap_tok = getattr(config.wan, 'coap_device_token', '') or ''
        if coap_tok and coap_tok != '***HIDDEN***':
            self.coap_token_var.set(coap_tok)

        # Interfaces — update stack status labels
        stack_info = config.lan.stack_info
        lan_map = _STACK_MAP.get("lan_stack_map", {})

        def _stack_label(sid: str) -> str:
            entry = lan_map.get(sid, {})
            if not sid or sid == "000":
                return "(no module)"
            label = entry.get("label", entry.get("type", f"ID {sid}"))
            return f"{sid} — {label}"

        self._stack1_info_var.set(_stack_label(stack_info.stack1_id))
        self._stack2_info_var.set(_stack_label(stack_info.stack2_id))

        # —— Dynamic LAN stack tabs ————————————————————————————————————————————
        # Each module stack with a registry entry gets its OWN dedicated notebook
        # tab inserted before the Interfaces tab.  When a slot goes back to 000
        # (or changes type) the old tab is removed.
        stack_pairs = [
            (0, stack_info.stack1_id, stack_info.stack1_json_len),
            (1, stack_info.stack2_id, stack_info.stack2_json_len),
        ]
        interfaces_tab_id = str(self._interfaces_tab_frame)

        # Remove tabs whose slot is now 000 or changed module type
        for slot_idx in list(self._stack_tabs.keys()):
            current_sid = stack_pairs[slot_idx][1]
            existing    = self._stack_tabs[slot_idx]
            reg = _LAN_STACK_REGISTRY.get(current_sid)
            if reg is None or not isinstance(existing, reg["widget_class"]):
                self.notebook.forget(existing)
                existing.destroy()
                del self._stack_tabs[slot_idx]

        # Add / update tabs for active module slots
        for slot_idx, sid, json_len in stack_pairs:
            reg = _LAN_STACK_REGISTRY.get(sid)
            if reg:
                slot_label = f"{reg['label']} (S{slot_idx + 1})"
                if slot_idx not in self._stack_tabs:
                    # Create new dedicated tab
                    widget = reg["widget_class"](
                        self.notebook,
                        stack_idx=slot_idx,
                        stack_id=sid,
                        serial_manager=self.serial_manager,
                        log_callback=self.log,
                        cmd_prefix=reg["cmd_prefix"],
                        cmd_map=reg["default_cmd_map"],
                    )
                    # Insert just before the Interfaces tab
                    insert_pos = self.notebook.index(self._interfaces_tab_frame)
                    self.notebook.insert(insert_pos, widget, text=slot_label)
                    self._stack_tabs[slot_idx] = widget
                else:
                    # Update tab label if needed
                    self.notebook.tab(self._stack_tabs[slot_idx], text=slot_label)
                # Update stack info in the widget
                self._stack_tabs[slot_idx].set_config(slot_idx, sid, json_len)
