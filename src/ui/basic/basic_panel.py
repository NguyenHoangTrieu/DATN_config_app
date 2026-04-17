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

        # Notebook — fixed tabs: Internet, Server, Interfaces
        self.notebook = ttk.Notebook(self)
        self.notebook.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)

        # Create fixed tabs
        self._create_internet_tab()
        self._create_server_tab()
        self._create_interfaces_tab()
    
    # ─────────────────────────────────────────────────────────────────────────
    # Internet tab (replaces old separate WiFi / LTE tabs)
    # ─────────────────────────────────────────────────────────────────────────

    def _create_internet_tab(self):
        """Unified Internet tab — WiFi / LTE / Ethernet switcher."""
        tab = ttk.Frame(self.notebook, padding=10)
        self.notebook.add(tab, text="📡 Internet")

        # Hidden LTE defaults (populated by set_config from wan_stack_map)
        self._lte_modem_default = ""
        self._lte_comm_default  = "USB"
        self._lte_pwr_default   = "05"
        self._lte_rst_default   = "06"

        # ── Internet type selector ────────────────────────────────────────
        type_frame = ttk.LabelFrame(tab, text="Internet Type", padding=8)
        type_frame.pack(fill=tk.X, pady=5)
        row = ttk.Frame(type_frame); row.pack(fill=tk.X, pady=3)
        ttk.Label(row, text="Connection:", width=15).pack(side=tk.LEFT)
        self.internet_type_var = tk.StringVar(value="WiFi")
        type_combo = ttk.Combobox(row, textvariable=self.internet_type_var,
                                  state="readonly",
                                  values=["WiFi", "LTE", "Ethernet"],
                                  width=12)
        type_combo.pack(side=tk.LEFT, padx=5)
        type_combo.bind("<<ComboboxSelected>>", self._on_internet_type_change)

        # Fallback row
        row_fb = ttk.Frame(type_frame); row_fb.pack(fill=tk.X, pady=3)
        self.internet_fallback_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(row_fb, text="Enable fallback when primary fails",
                        variable=self.internet_fallback_var).pack(side=tk.LEFT, padx=5)

        # ── WiFi settings ─────────────────────────────────────────────────
        self._wifi_settings_frame = ttk.LabelFrame(tab, text="WiFi Settings", padding=10)

        row1 = ttk.Frame(self._wifi_settings_frame); row1.pack(fill=tk.X, pady=3)
        ttk.Label(row1, text="SSID:", width=15).pack(side=tk.LEFT)
        self.wifi_ssid_var = tk.StringVar()
        ttk.Entry(row1, textvariable=self.wifi_ssid_var).pack(
            side=tk.LEFT, padx=5, fill=tk.X, expand=True)

        row2 = ttk.Frame(self._wifi_settings_frame); row2.pack(fill=tk.X, pady=3)
        ttk.Label(row2, text="Password:", width=15).pack(side=tk.LEFT)
        self.show_pwd_var = tk.BooleanVar()
        ttk.Checkbutton(row2, text="Show", variable=self.show_pwd_var,
                        command=lambda: self.wifi_pwd_entry.config(
                            show="" if self.show_pwd_var.get() else "*")
                        ).pack(side=tk.RIGHT, padx=5)
        self.wifi_pwd_var = tk.StringVar()
        self.wifi_pwd_entry = ttk.Entry(row2, textvariable=self.wifi_pwd_var, show="*")
        self.wifi_pwd_entry.pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)

        row3 = ttk.Frame(self._wifi_settings_frame); row3.pack(fill=tk.X, pady=3)
        ttk.Label(row3, text="Auth Mode:", width=15).pack(side=tk.LEFT)
        self.wifi_auth_var = tk.StringVar(value="PERSONAL")
        auth_combo = ttk.Combobox(row3, textvariable=self.wifi_auth_var, state="readonly",
                                  values=["PERSONAL", "ENTERPRISE"])
        auth_combo.pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)
        auth_combo.bind("<<ComboboxSelected>>", self._on_wifi_auth_change)

        self.wifi_username_frame = ttk.Frame(self._wifi_settings_frame)
        ttk.Label(self.wifi_username_frame, text="Username:", width=15).pack(side=tk.LEFT)
        self.wifi_username_var = tk.StringVar()
        ttk.Entry(self.wifi_username_frame, textvariable=self.wifi_username_var).pack(
            side=tk.LEFT, padx=5, fill=tk.X, expand=True)

        # ── LTE settings ──────────────────────────────────────────────────
        self._lte_settings_frame = ttk.LabelFrame(tab, text="LTE Settings", padding=10)

        info_row = ttk.Frame(self._lte_settings_frame); info_row.pack(fill=tk.X, pady=(0, 4))
        ttk.Label(info_row, text="LTE Module:", width=15).pack(side=tk.LEFT)
        self._lte_modem_info_var = tk.StringVar(value="—")
        ttk.Label(info_row, textvariable=self._lte_modem_info_var,
                  foreground="#1565C0", font=("Segoe UI", 9, "bold")).pack(side=tk.LEFT, padx=4)

        la = ttk.Frame(self._lte_settings_frame); la.pack(fill=tk.X, pady=3)
        ttk.Label(la, text="APN:", width=15).pack(side=tk.LEFT)
        self.lte_apn_var = tk.StringVar(value="m-wap")
        ttk.Entry(la, textvariable=self.lte_apn_var).pack(
            side=tk.LEFT, padx=5, fill=tk.X, expand=True)

        lb = ttk.Frame(self._lte_settings_frame); lb.pack(fill=tk.X, pady=3)
        ttk.Label(lb, text="Username:", width=15).pack(side=tk.LEFT)
        self.lte_user_var = tk.StringVar()
        ttk.Entry(lb, textvariable=self.lte_user_var).pack(
            side=tk.LEFT, padx=5, fill=tk.X, expand=True)

        lc = ttk.Frame(self._lte_settings_frame); lc.pack(fill=tk.X, pady=3)
        ttk.Label(lc, text="Password:", width=15).pack(side=tk.LEFT)
        self.lte_pwd_var = tk.StringVar()
        self.lte_pwd_entry = ttk.Entry(lc, textvariable=self.lte_pwd_var, show="*")
        self.lte_pwd_entry.pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)
        self.show_lte_pwd_var = tk.BooleanVar()
        ttk.Checkbutton(lc, text="Show", variable=self.show_lte_pwd_var,
                        command=lambda: self.lte_pwd_entry.config(
                            show="" if self.show_lte_pwd_var.get() else "*")
                        ).pack(side=tk.LEFT, padx=5)

        # ── Ethernet info ─────────────────────────────────────────────────
        self._eth_settings_frame = ttk.LabelFrame(tab, text="Ethernet", padding=10)
        ttk.Label(self._eth_settings_frame,
                  text="Ethernet is hardware-configured (DHCP).\n"
                       "No additional settings required.\n"
                       "Click 'Set Internet Config' to activate Ethernet mode.",
                  foreground="#555555", font=("Segoe UI", 9),
                  wraplength=380, justify=tk.LEFT).pack(anchor="w", pady=5)

        # ── Set button ────────────────────────────────────────────────────
        btn_frame = ttk.Frame(tab)
        btn_frame.pack(fill=tk.X, pady=10)
        ttk.Button(btn_frame, text="✅ Set Internet Config", style='Set.TButton',
                   command=self._set_internet_config).pack(anchor="e", padx=5)

        # Show initial sub-frame
        self._on_internet_type_change()

    def _on_internet_type_change(self, event=None):
        """Show/hide sub-frame for the selected internet type."""
        itype = self.internet_type_var.get()
        for frame in (self._wifi_settings_frame,
                      self._lte_settings_frame,
                      self._eth_settings_frame):
            frame.pack_forget()
        if itype == "WiFi":
            self._wifi_settings_frame.pack(fill=tk.X, pady=5)
        elif itype == "LTE":
            self._lte_settings_frame.pack(fill=tk.X, pady=5)
        elif itype == "Ethernet":
            self._eth_settings_frame.pack(fill=tk.X, pady=5)

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

        # ── WAN Adapter info ───────────────────────────────────────────────────
        wan_frame = ttk.LabelFrame(tab, text="Detected WAN Adapter", padding=10)
        wan_frame.pack(fill=tk.X, pady=5)

        r_wan_id = ttk.Frame(wan_frame); r_wan_id.pack(fill=tk.X, pady=3)
        ttk.Label(r_wan_id, text="WAN Stack ID:", width=12).pack(side=tk.LEFT)
        self._wan_stack_id_var = tk.StringVar(value="—")
        ttk.Label(r_wan_id, textvariable=self._wan_stack_id_var,
                  foreground="#1565C0", font=("Segoe UI", 9, "bold")).pack(side=tk.LEFT, padx=4)

        r_wan_adapter = ttk.Frame(wan_frame); r_wan_adapter.pack(fill=tk.X, pady=3)
        ttk.Label(r_wan_adapter, text="Adapter:", width=12).pack(side=tk.LEFT)
        self._wan_adapter_info_var = tk.StringVar(value="—")
        ttk.Label(r_wan_adapter, textvariable=self._wan_adapter_info_var,
                  foreground="#1565C0", font=("Segoe UI", 9, "bold")).pack(side=tk.LEFT, padx=4)

        # ── LAN Stacks info ───────────────────────────────────────────────────
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
                  text="💡 Stack IDs are reported by the gateway when you read the config.",
                  font=("Segoe UI", 9), foreground="#757575",
                  wraplength=380).pack(anchor="w", pady=(8, 0))
    
    def _on_wifi_auth_change(self, event=None):
        """Show/hide username field for Enterprise WiFi."""
        if self.wifi_auth_var.get() == "ENTERPRISE":
            self.wifi_username_frame.pack(fill=tk.X, pady=3)
        else:
            self.wifi_username_frame.pack_forget()
            self.wifi_username_var.set("")

    def _check_connection(self) -> bool:
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
    
    def _set_internet_config(self):
        """Send internet config command for the selected connection type."""
        if not self._check_connection():
            return

        itype = self.internet_type_var.get()
        itype_upper = itype.upper()
        fb = "1" if self.internet_fallback_var.get() else "0"

        # Auto-compute fallback type (mirrors firmware logic) for explicit CFIN cmd
        if fb == "1":
            if itype_upper in ("LTE", "ETHERNET"):
                fb_type = "WIFI"
            else:  # WIFI primary
                apn_check = self.lte_apn_var.get().strip()
                fb_type = "LTE" if apn_check else "ETHERNET"
        else:
            fb_type = None

        def _build_cfin(primary):
            if fb == "1" and fb_type:
                return f"CFIN:{primary}:1:{fb_type}"
            return f"CFIN:{primary}:{fb}"

        if itype == "WiFi":
            ssid     = self.wifi_ssid_var.get().strip()
            password = self.wifi_pwd_var.get()
            auth     = self.wifi_auth_var.get()
            username = self.wifi_username_var.get().strip()
            if not ssid:
                messagebox.showwarning("Warning", "Please enter WiFi SSID")
                return
            if auth == "ENTERPRISE" and not username:
                messagebox.showwarning("Warning",
                                       "Please enter Username for Enterprise mode")
                return
            if auth == "ENTERPRISE":
                cmd = f"CFWF:{ssid}:{password}:{username}:ENTERPRISE"
            else:
                cmd = f"CFWF:{ssid}:{password}:PERSONAL"
            cfin = _build_cfin("WIFI")

            def _send():
                self.log(f"→ {cmd}", "DEBUG")
                self.serial_manager.send(cmd)
                self.log("✓ WiFi Config sent", "SUCCESS")
                time.sleep(1.0)
                self.log(f"→ {cfin}", "DEBUG")
                self.serial_manager.send(cfin)
                fb_msg = f" (fallback → {fb_type})" if fb == "1" else " (fallback disabled)"
                self.log(f"✓ Internet type = WiFi set{fb_msg}", "SUCCESS")
            threading.Thread(target=_send, daemon=True).start()

        elif itype == "LTE":
            apn  = self.lte_apn_var.get().strip()
            user = self.lte_user_var.get().strip()
            pwd  = self.lte_pwd_var.get()
            
            # Use default if empty
            if not apn:
                apn = "m-wap"
                self.lte_apn_var.set(apn)
                self.log(f"Using default APN: {apn}", "INFO")
            
            cmd = (f"CFLT:{self._lte_modem_default}:{apn}:{user}:{pwd}"
                   f":{self._lte_comm_default}:true:30000:0"
                   f":{self._lte_pwr_default}:{self._lte_rst_default}")
            cfin = _build_cfin("LTE")

            def _send():
                self.log(f"→ {cmd}", "DEBUG")
                self.serial_manager.send(cmd)
                self.log("✓ LTE Config sent (CFLT)", "SUCCESS")
                time.sleep(1.0)
                self.log(f"→ {cfin}", "DEBUG")
                self.serial_manager.send(cfin)
                fb_msg = f" (fallback → {fb_type})" if fb == "1" else " (fallback disabled)"
                self.log(f"✓ Internet type = LTE set{fb_msg}", "SUCCESS")
            threading.Thread(target=_send, daemon=True).start()

        elif itype == "Ethernet":
            cfin = _build_cfin("ETHERNET")

            def _send():
                self.log(f"→ {cfin}", "DEBUG")
                self.serial_manager.send(cfin)
                fb_msg = f" (fallback → {fb_type})" if fb == "1" else " (fallback disabled)"
                self.log(f"✓ Internet type = Ethernet set{fb_msg}", "SUCCESS")
            threading.Thread(target=_send, daemon=True).start()

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
        # ── Internet type ────────────────────────────────────────────────
        _inet_map = {'WIFI': 'WiFi', 'LTE': 'LTE', 'ETHERNET': 'Ethernet'}
        inet_raw = (getattr(config.wan, 'internet_type', 'WIFI') or 'WIFI').upper()
        self.internet_type_var.set(_inet_map.get(inet_raw, 'WiFi'))
        self.internet_fallback_var.set(getattr(config.wan, 'internet_fallback', False))

        # WiFi fields
        self.wifi_ssid_var.set(config.wan.wifi_ssid or "")
        if config.wan.wifi_password and config.wan.wifi_password != "***HIDDEN***":
            self.wifi_pwd_var.set(config.wan.wifi_password)

        # LTE defaults from wan_stack_map
        wan_id    = getattr(config.wan, "stack_wan_id", "100") or "100"
        wan_map   = _STACK_MAP.get("wan_stack_map", {})
        lte_entry = wan_map.get(wan_id, {})
        lte_visible = lte_entry.get("type", "NONE") != "NONE"

        if lte_visible:
            self._lte_modem_default = lte_entry.get(
                "modem", getattr(config.wan, "lte_modem_name", "") or "")
            self._lte_comm_default  = lte_entry.get(
                "comm_type", getattr(config.wan, "lte_comm_type", "USB") or "USB")
            self._lte_pwr_default   = lte_entry.get(
                "pwr_pin", getattr(config.wan, "lte_pwr_pin", "05") or "05")
            self._lte_rst_default   = lte_entry.get(
                "rst_pin", getattr(config.wan, "lte_rst_pin", "06") or "06")
            label = lte_entry.get("label", f"Stack {wan_id}")
            self._lte_modem_info_var.set(f"{self._lte_modem_default}  ({label})")
        else:
            self._lte_modem_info_var.set("— (no LTE adapter)")

        # LTE user-editable fields
        self.lte_apn_var.set(getattr(config.wan, "lte_apn", "") or "")
        self.lte_user_var.set(getattr(config.wan, "lte_username", "") or "")
        lte_pwd = getattr(config.wan, "lte_password", "") or ""
        if lte_pwd and lte_pwd != "***HIDDEN***":
            self.lte_pwd_var.set(lte_pwd)

        # Refresh sub-frame visibility
        self._on_internet_type_change()

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

        # Interfaces — update WAN adapter info
        wan_id = getattr(config.wan, "stack_wan_id", "100") or "100"
        wan_map = _STACK_MAP.get("wan_stack_map", {})
        wan_entry = wan_map.get(wan_id, {})
        wan_label = wan_entry.get("label", f"ID {wan_id}")
        
        self._wan_stack_id_var.set(wan_id)
        self._wan_adapter_info_var.set(wan_label)

        # Interfaces — update stack status labels
        stack_info = config.lan.stack_info
        lan_map = _STACK_MAP.get("lan_stack_map", {})

        def _stack_label(sid: str) -> str:
            entry = lan_map.get(sid, {})
            if not sid or sid == "none":
                return "(no module)"
            label = entry.get("label", entry.get("type", f"ID {sid}"))
            return f"{sid} — {label}"

        self._stack1_info_var.set(_stack_label(stack_info.stack1_id))
        self._stack2_info_var.set(_stack_label(stack_info.stack2_id))
