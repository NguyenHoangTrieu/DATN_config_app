"""
Server Configuration Tab (Advanced)
MQTT / CoAP / HTTP-HTTPS server settings
"""

import tkinter as tk
from tkinter import ttk, messagebox
import threading

from src.config.protocol import (
    SERVER_TYPE_LABELS, SERVER_TYPE_FROM_LABEL,
    SERVER_TYPE_MQTT, SERVER_TYPE_COAP, SERVER_TYPE_HTTP,
    build_server_type_cmd, build_mqtt_cmd, build_http_cmd, build_coap_cmd,
)


class ServerTab(ttk.Frame):
    """Advanced Server configuration tab"""
    
    def __init__(self, parent, serial_manager=None, log_callback=None, **kwargs):
        super().__init__(parent, **kwargs)
        self.serial_manager = serial_manager
        self.log = log_callback or (lambda msg, lvl: None)
        self._create_widgets()
    
    def _create_widgets(self):
        """Create Server tab widgets"""
        # Container with padding
        container = ttk.Frame(self, padding=10)
        container.pack(fill=tk.X, anchor="nw")
        
        # ═══════════════════════════════════════════════════════════════════
        # Server Type Section
        # ═══════════════════════════════════════════════════════════════════
        type_frame = ttk.LabelFrame(container, text="Server Type", padding=8)
        type_frame.pack(fill=tk.X, pady=5)
        
        row1 = ttk.Frame(type_frame)
        row1.pack(fill=tk.X, pady=2)
        ttk.Label(row1, text="Type:", width=15).pack(side=tk.LEFT)
        self.type_var = tk.StringVar(value="MQTT")
        self.type_combo = ttk.Combobox(row1, textvariable=self.type_var, state="readonly",
                                       values=list(SERVER_TYPE_LABELS.values()))  # ["MQTT", "CoAP", "HTTP/HTTPS"]
        self.type_combo.pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)
        self.type_combo.bind("<<ComboboxSelected>>", self._on_type_change)
        
        # ═══════════════════════════════════════════════════════════════════
        # MQTT Settings Section
        # ═══════════════════════════════════════════════════════════════════
        self.mqtt_frame = ttk.LabelFrame(container, text="MQTT Settings", padding=8)
        self.mqtt_frame.pack(fill=tk.X, pady=5)
        
        # Broker URI
        row2 = ttk.Frame(self.mqtt_frame)
        row2.pack(fill=tk.X, pady=2)
        ttk.Label(row2, text="Broker URI:", width=15).pack(side=tk.LEFT)
        self.broker_var = tk.StringVar()
        ttk.Entry(row2, textvariable=self.broker_var).pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)
        
        # Device Token
        row3 = ttk.Frame(self.mqtt_frame)
        row3.pack(fill=tk.X, pady=2)
        ttk.Label(row3, text="Device Token:", width=15).pack(side=tk.LEFT)
        self.token_var = tk.StringVar()
        ttk.Entry(row3, textvariable=self.token_var).pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)
        
        # Info
        row_info = ttk.Frame(self.mqtt_frame)
        row_info.pack(fill=tk.X, pady=2)
        ttk.Label(row_info, text="", width=15).pack(side=tk.LEFT)
        ttk.Label(row_info, text="ℹ️ Format: mqtt[s]://host:port (e.g., mqtt://broker.example.com:1883)",
                  foreground="#757575").pack(side=tk.LEFT)
        
        # ═══════════════════════════════════════════════════════════════════
        # MQTT Topics Section
        # ═══════════════════════════════════════════════════════════════════
        self.topics_frame = ttk.LabelFrame(container, text="MQTT Topics", padding=8)
        self.topics_frame.pack(fill=tk.X, pady=5)
        
        # Subscribe Topic
        row4 = ttk.Frame(self.topics_frame)
        row4.pack(fill=tk.X, pady=2)
        ttk.Label(row4, text="Subscribe Topic:", width=15).pack(side=tk.LEFT)
        self.sub_topic_var = tk.StringVar()
        ttk.Entry(row4, textvariable=self.sub_topic_var).pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)
        
        # Publish Topic
        row5 = ttk.Frame(self.topics_frame)
        row5.pack(fill=tk.X, pady=2)
        ttk.Label(row5, text="Publish Topic:", width=15).pack(side=tk.LEFT)
        self.pub_topic_var = tk.StringVar()
        ttk.Entry(row5, textvariable=self.pub_topic_var).pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)
        
        # Attribute Topic
        row6 = ttk.Frame(self.topics_frame)
        row6.pack(fill=tk.X, pady=2)
        ttk.Label(row6, text="Attribute Topic:", width=15).pack(side=tk.LEFT)
        self.attr_topic_var = tk.StringVar()
        ttk.Entry(row6, textvariable=self.attr_topic_var).pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)
        
        # ═══════════════════════════════════════════════════════════════════
        # HTTP/HTTPS Settings Section
        # ═══════════════════════════════════════════════════════════════════
        self.http_frame = ttk.LabelFrame(container, text="HTTP / HTTPS Settings", padding=8)

        for label_text, attr, default in [
            ("Server URL:",  "http_url_var",   "http://server:8080/api/v1/{token}/telemetry"),
            ("Auth Token:",  "http_token_var", ""),
        ]:
            _row = ttk.Frame(self.http_frame)
            _row.pack(fill=tk.X, pady=2)
            ttk.Label(_row, text=label_text, width=18).pack(side=tk.LEFT)
            _var = tk.StringVar(value=default)
            setattr(self, attr, _var)
            ttk.Entry(_row, textvariable=_var).pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)

        _row = ttk.Frame(self.http_frame)
        _row.pack(fill=tk.X, pady=2)
        ttk.Label(_row, text="Port:", width=18).pack(side=tk.LEFT)
        self.http_port_var = tk.StringVar(value="8080")
        ttk.Entry(_row, textvariable=self.http_port_var, width=8).pack(side=tk.LEFT, padx=5)
        ttk.Label(_row, text="  Timeout (ms):").pack(side=tk.LEFT)
        self.http_timeout_var = tk.StringVar(value="10000")
        ttk.Entry(_row, textvariable=self.http_timeout_var, width=10).pack(side=tk.LEFT, padx=5)

        _row = ttk.Frame(self.http_frame)
        _row.pack(fill=tk.X, pady=2)
        self.http_tls_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(_row, text="Use TLS (HTTPS)", variable=self.http_tls_var).pack(side=tk.LEFT, padx=5)
        self.http_verify_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(_row, text="Verify Server Cert", variable=self.http_verify_var).pack(side=tk.LEFT, padx=5)

        ttk.Label(self.http_frame,
                  text="ℹ️ Use {token} in URL to inject the auth token automatically",
                  foreground="#757575").pack(anchor="w", pady=(2, 0))

        # ═══════════════════════════════════════════════════════════════════
        # CoAP Settings Section
        # ═══════════════════════════════════════════════════════════════════
        self.coap_frame = ttk.LabelFrame(container, text="CoAP Settings", padding=8)

        for label_text, attr, default in [
            ("Host:",          "coap_host_var",     "demo.thingsboard.io"),
            ("Resource Path:", "coap_resource_var", "/api/v1/{token}/telemetry"),
            ("Device Token:",  "coap_token_var",    ""),
        ]:
            _row = ttk.Frame(self.coap_frame)
            _row.pack(fill=tk.X, pady=2)
            ttk.Label(_row, text=label_text, width=18).pack(side=tk.LEFT)
            _var = tk.StringVar(value=default)
            setattr(self, attr, _var)
            ttk.Entry(_row, textvariable=_var).pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)

        _row = ttk.Frame(self.coap_frame)
        _row.pack(fill=tk.X, pady=2)
        ttk.Label(_row, text="Port:", width=18).pack(side=tk.LEFT)
        self.coap_port_var = tk.StringVar(value="5683")
        ttk.Entry(_row, textvariable=self.coap_port_var, width=8).pack(side=tk.LEFT, padx=5)
        ttk.Label(_row, text="  ACK Timeout (ms):").pack(side=tk.LEFT)
        self.coap_ack_var = tk.StringVar(value="2000")
        ttk.Entry(_row, textvariable=self.coap_ack_var, width=8).pack(side=tk.LEFT, padx=5)
        ttk.Label(_row, text="  Max Retx:").pack(side=tk.LEFT)
        self.coap_maxrtx_var = tk.StringVar(value="4")
        ttk.Entry(_row, textvariable=self.coap_maxrtx_var, width=4).pack(side=tk.LEFT, padx=5)

        _row = ttk.Frame(self.coap_frame)
        _row.pack(fill=tk.X, pady=2)
        self.coap_dtls_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(_row, text="Use DTLS (CoAPS — port 5684)", variable=self.coap_dtls_var).pack(side=tk.LEFT, padx=5)

        ttk.Label(self.coap_frame,
                  text="ℹ️ Use {token} in Resource Path to inject the device token",
                  foreground="#757575").pack(anchor="w", pady=(2, 0))

        # ═══════════════════════════════════════════════════════════════════
        # Set Button
        # ═══════════════════════════════════════════════════════════════════
        btn_frame = ttk.Frame(container)
        btn_frame.pack(fill=tk.X, pady=15, anchor="nw")
        ttk.Button(btn_frame, text="✅ Set Server Config", style='Set.TButton',
                  command=self._set_server_config).pack(anchor="e", padx=5)
        
        # ═══════════════════════════════════════════════════════════════════
        # Command Info
        # ═══════════════════════════════════════════════════════════════════
        info_frame = ttk.Frame(container)
        info_frame.pack(fill=tk.X, anchor="nw")
        ttk.Separator(info_frame, orient='horizontal').pack(fill=tk.X, pady=5)
        ttk.Label(info_frame,
                  text="Server Type Commands (Code → Protocol)\n"
                       "  0 = MQTT   → CFSV:0 + CFMQ:BROKER|TOKEN|SUB|PUB|ATTR\n"
                       "  1 = CoAP   → CFSV:1 + CFCP:HOST|PATH|TOKEN|PORT|DTLS|ACK_TO|MAX_RTX\n"
                       "  2 = HTTP   → CFSV:2 + CFHP:URL|TOKEN|PORT|TLS|VERIFY|TIMEOUT",
                  foreground="#757575", font=('Consolas', 9), justify=tk.LEFT).pack(anchor="w")
        # Show correct frame on startup
        self._on_type_change()
    
    def _on_type_change(self, event=None):
        """Show the settings frame matching the selected server type"""
        server_type = self.type_var.get()
        for frame in (self.mqtt_frame, self.topics_frame,
                      self.http_frame, self.coap_frame):
            frame.pack_forget()
        if server_type == "MQTT":
            self.mqtt_frame.pack(fill=tk.X, pady=5)
            self.topics_frame.pack(fill=tk.X, pady=5)
        elif server_type == "HTTP/HTTPS":
            self.http_frame.pack(fill=tk.X, pady=5)
        elif server_type == "CoAP":
            self.coap_frame.pack(fill=tk.X, pady=5)
    
    def _check_connection(self) -> bool:
        """Check if serial is connected"""
        if not self.serial_manager or not self.serial_manager.is_connected():
            messagebox.showwarning("Warning", "Not connected to gateway")
            return False
        return True
    
    def _send_command(self, cmd: str, description: str):
        """Send command without waiting for response"""
        self.log(f"→ {cmd}", "DEBUG")
        if self.serial_manager.send(cmd):
            self.log(f"✓ {description} - Sent", "SUCCESS")
        else:
            self.log(f"✗ {description} - Send failed", "ERROR")
    
    def _set_server_config(self):
        """Set Server configuration — sends CFSV + type-specific command"""
        if not self._check_connection():
            return

        label = self.type_var.get()
        type_code = SERVER_TYPE_FROM_LABEL.get(label, SERVER_TYPE_MQTT)

        # DEBUG: Verify CFSV command value
        cfsv_cmd = build_server_type_cmd(type_code)
        self.log(f"[DEBUG] Selected: '{label}' → Code: {type_code} → Command: {cfsv_cmd}", "DEBUG")

        # Always send server type first
        self._send_command(cfsv_cmd,
                           f"Set Server Type = {label}")

        if label == "MQTT":
            broker    = self.broker_var.get().strip()
            token     = self.token_var.get().strip()
            sub_topic = self.sub_topic_var.get().strip()
            pub_topic = self.pub_topic_var.get().strip()
            attr      = self.attr_topic_var.get().strip()
            self._send_command(build_mqtt_cmd(broker, token, sub_topic, pub_topic, attr),
                               "MQTT Config")

        elif label == "HTTP/HTTPS":
            url     = self.http_url_var.get().strip()
            token   = self.http_token_var.get().strip()
            try:
                port = int(self.http_port_var.get().strip())
            except ValueError:
                port = 8080
            try:
                timeout = int(self.http_timeout_var.get().strip())
            except ValueError:
                timeout = 10000
            self._send_command(
                build_http_cmd(url, token, port,
                               self.http_tls_var.get(), self.http_verify_var.get(),
                               timeout),
                "HTTP Config")

        elif label == "CoAP":
            host     = self.coap_host_var.get().strip()
            resource = self.coap_resource_var.get().strip()
            token    = self.coap_token_var.get().strip()
            try:
                port = int(self.coap_port_var.get().strip())
            except ValueError:
                port = 5683
            try:
                ack_to = int(self.coap_ack_var.get().strip())
            except ValueError:
                ack_to = 2000
            try:
                max_rtx = int(self.coap_maxrtx_var.get().strip())
            except ValueError:
                max_rtx = 4
            self._send_command(
                build_coap_cmd(host, resource, token, port,
                               self.coap_dtls_var.get(), ack_to, max_rtx),
                "CoAP Config")
    
    def set_config(self, config):
        """Set config from data (accepts GatewayConfig or WanConfig)"""
        wan = getattr(config, 'wan', config)

        # Server type
        srv = getattr(wan, 'server_type', 'MQTT') or 'MQTT'
        label = SERVER_TYPE_LABELS.get(
            SERVER_TYPE_FROM_LABEL.get(srv, SERVER_TYPE_MQTT),
            "MQTT"
        ) if srv in SERVER_TYPE_FROM_LABEL else "MQTT"
        self.type_var.set(label)
        self._on_type_change()

        # MQTT
        self.broker_var.set(getattr(wan, 'mqtt_broker', '') or '')
        tok = getattr(wan, 'mqtt_device_token', '') or ''
        if tok and tok != '***HIDDEN***':
            self.token_var.set(tok)
        self.sub_topic_var.set(getattr(wan, 'mqtt_sub_topic', '') or '')
        self.pub_topic_var.set(getattr(wan, 'mqtt_pub_topic', '') or '')
        self.attr_topic_var.set(getattr(wan, 'mqtt_attribute_topic', '') or '')

        # HTTP
        self.http_url_var.set(getattr(wan, 'http_url', '') or '')
        http_tok = getattr(wan, 'http_auth_token', '') or ''
        if http_tok and http_tok != '***HIDDEN***':
            self.http_token_var.set(http_tok)
        self.http_port_var.set(str(getattr(wan, 'http_port', 8080) or 8080))
        self.http_tls_var.set(bool(getattr(wan, 'http_use_tls', False)))
        self.http_verify_var.set(bool(getattr(wan, 'http_verify_server', False)))
        self.http_timeout_var.set(str(getattr(wan, 'http_timeout_ms', 10000) or 10000))

        # CoAP
        self.coap_host_var.set(getattr(wan, 'coap_host', '') or '')
        self.coap_resource_var.set(getattr(wan, 'coap_resource_path', '') or '')
        coap_tok = getattr(wan, 'coap_device_token', '') or ''
        if coap_tok and coap_tok != '***HIDDEN***':
            self.coap_token_var.set(coap_tok)
        self.coap_port_var.set(str(getattr(wan, 'coap_port', 5683) or 5683))
        self.coap_dtls_var.set(bool(getattr(wan, 'coap_use_dtls', False)))
        self.coap_ack_var.set(str(getattr(wan, 'coap_ack_timeout_ms', 2000) or 2000))
        self.coap_maxrtx_var.set(str(getattr(wan, 'coap_max_retransmit', 4) or 4))
    
    def get_config(self) -> dict:
        """Get current config as dict"""
        label     = self.type_var.get()
        type_code = SERVER_TYPE_FROM_LABEL.get(label, SERVER_TYPE_MQTT)
        return {
            'server_type':          label,
            'server_type_code':     type_code,
            'mqtt_broker':          self.broker_var.get(),
            'mqtt_device_token':    self.token_var.get(),
            'mqtt_sub_topic':       self.sub_topic_var.get(),
            'mqtt_pub_topic':       self.pub_topic_var.get(),
            'mqtt_attribute_topic': self.attr_topic_var.get(),
            'http_url':             self.http_url_var.get(),
            'http_auth_token':      self.http_token_var.get(),
            'http_port':            self._safe_int(self.http_port_var.get(), 8080),
            'http_use_tls':         self.http_tls_var.get(),
            'http_verify_server':   self.http_verify_var.get(),
            'http_timeout_ms':      self._safe_int(self.http_timeout_var.get(), 10000),
            'coap_host':            self.coap_host_var.get(),
            'coap_resource_path':   self.coap_resource_var.get(),
            'coap_device_token':    self.coap_token_var.get(),
            'coap_port':            self._safe_int(self.coap_port_var.get(), 5683),
            'coap_use_dtls':        self.coap_dtls_var.get(),
            'coap_ack_timeout_ms':  self._safe_int(self.coap_ack_var.get(), 2000),
            'coap_max_retransmit':  self._safe_int(self.coap_maxrtx_var.get(), 4),
        }

    @staticmethod
    def _safe_int(s, default):
        try:
            return int(s)
        except (ValueError, TypeError):
            return default
