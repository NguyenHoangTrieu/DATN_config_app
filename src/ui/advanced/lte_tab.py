"""
LTE Configuration Tab (Advanced Mode)
Command format:
  CFLT:MODEM_NAME:APN:USERNAME:PASSWORD:COMM_TYPE:AUTO_RECONNECT:RECONNECT_TIMEOUT:MAX_RECONNECT:PWR_PIN:RST_PIN
  Example: CFLT:A7600C1:v-internet:user:pass:USB:true:30000:0:WK:PE
Then: CFIN:LTE (after 1 s)
"""

import tkinter as tk
from tkinter import ttk, messagebox
import threading
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

# â”€â”€ Stack-ID map (default values per WAN adapter) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
_STACK_MAP_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)),
                               "config", "stack_id_map.json")
_PIN_OPTIONS = ["04", "05", "06", "07", "11", "12", "13", "14", "15", "16", "17"]

def _load_stack_map() -> dict:
    try:
        with open(_STACK_MAP_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


class LTETab(ttk.Frame):
    """Advanced LTE configuration tab â€” full CFLT command with all parameters."""

    def __init__(self, parent, serial_manager=None, log_callback=None, **kwargs):
        super().__init__(parent, **kwargs)
        self.serial_manager = serial_manager
        self.log = log_callback or (lambda msg, lvl: None)
        self._stack_map = _load_stack_map()
        self._create_widgets()

    def _create_widgets(self):
        container = ttk.Frame(self, padding=10)
        container.pack(fill=tk.X, anchor="nw")

        # â”€â”€ Modem Identity â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        id_frame = ttk.LabelFrame(container, text="Modem Identity", padding=8)
        id_frame.pack(fill=tk.X, pady=5)

        r0 = ttk.Frame(id_frame); r0.pack(fill=tk.X, pady=2)
        ttk.Label(r0, text="WAN Stack ID:", width=18).pack(side=tk.LEFT)
        self._stack_id_var = tk.StringVar(value="100")
        self._stack_id_lbl = ttk.Label(r0, textvariable=self._stack_id_var,
                                       foreground="#1565C0",
                                       font=("Segoe UI", 9, "bold"))
        self._stack_id_lbl.pack(side=tk.LEFT, padx=4)
        self._adapter_lbl = ttk.Label(r0, text="(No adapter)", foreground="#888888")
        self._adapter_lbl.pack(side=tk.LEFT, padx=8)

        r1 = ttk.Frame(id_frame); r1.pack(fill=tk.X, pady=2)
        ttk.Label(r1, text="Modem Name:", width=18).pack(side=tk.LEFT)
        self.modem_name_var = tk.StringVar(value="A7600C1")
        ttk.Entry(r1, textvariable=self.modem_name_var).pack(
            side=tk.LEFT, padx=5, fill=tk.X, expand=True)

        r2 = ttk.Frame(id_frame); r2.pack(fill=tk.X, pady=2)
        ttk.Label(r2, text="Comm Type:", width=18).pack(side=tk.LEFT)
        self.comm_var = tk.StringVar(value="USB")
        ttk.Combobox(r2, textvariable=self.comm_var, state="readonly",
                     values=["USB", "UART"], width=8).pack(side=tk.LEFT, padx=5)

        # â”€â”€ APN / Auth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        apn_frame = ttk.LabelFrame(container, text="APN Settings", padding=8)
        apn_frame.pack(fill=tk.X, pady=5)

        ra = ttk.Frame(apn_frame); ra.pack(fill=tk.X, pady=2)
        ttk.Label(ra, text="APN:", width=18).pack(side=tk.LEFT)
        self.apn_var = tk.StringVar()
        ttk.Entry(ra, textvariable=self.apn_var).pack(
            side=tk.LEFT, padx=5, fill=tk.X, expand=True)

        rb = ttk.Frame(apn_frame); rb.pack(fill=tk.X, pady=2)
        ttk.Label(rb, text="Username:", width=18).pack(side=tk.LEFT)
        self.username_var = tk.StringVar()
        ttk.Entry(rb, textvariable=self.username_var).pack(
            side=tk.LEFT, padx=5, fill=tk.X, expand=True)

        rc = ttk.Frame(apn_frame); rc.pack(fill=tk.X, pady=2)
        ttk.Label(rc, text="Password:", width=18).pack(side=tk.LEFT)
        self.show_pwd = tk.BooleanVar()
        ttk.Checkbutton(rc, text="Show", variable=self.show_pwd,
                        command=lambda: self.password_entry.config(
                            show="" if self.show_pwd.get() else "*")
                        ).pack(side=tk.RIGHT)
        self.password_var = tk.StringVar()
        self.password_entry = ttk.Entry(rc, textvariable=self.password_var, show="*")
        self.password_entry.pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)

        # â”€â”€ Connection Settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        conn_frame = ttk.LabelFrame(container, text="Connection Settings", padding=8)
        conn_frame.pack(fill=tk.X, pady=5)

        rc1 = ttk.Frame(conn_frame); rc1.pack(fill=tk.X, pady=2)
        ttk.Label(rc1, text="Auto Reconnect:", width=18).pack(side=tk.LEFT)
        self.reconnect_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(rc1, variable=self.reconnect_var, text="Enable").pack(
            side=tk.LEFT, padx=5)

        rc2 = ttk.Frame(conn_frame); rc2.pack(fill=tk.X, pady=2)
        ttk.Label(rc2, text="Reconnect Timeout:", width=18).pack(side=tk.LEFT)
        self.timeout_var = tk.StringVar(value="30000")
        ttk.Spinbox(rc2, textvariable=self.timeout_var,
                    from_=5000, to=300000, increment=5000, width=10).pack(
                        side=tk.LEFT, padx=5)
        ttk.Label(rc2, text="ms  (5 000â€“300 000)", foreground="#757575").pack(side=tk.LEFT)

        rc3 = ttk.Frame(conn_frame); rc3.pack(fill=tk.X, pady=2)
        ttk.Label(rc3, text="Max Retry:", width=18).pack(side=tk.LEFT)
        self.retry_var = tk.StringVar(value="0")
        ttk.Spinbox(rc3, textvariable=self.retry_var,
                    from_=0, to=100, width=6).pack(side=tk.LEFT, padx=5)
        ttk.Label(rc3, text="(0 = unlimited)", foreground="#757575").pack(side=tk.LEFT)

        # â”€â”€ GPIO Pins â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        pin_frame = ttk.LabelFrame(container, text="Module GPIO Pins", padding=8)
        pin_frame.pack(fill=tk.X, pady=5)

        rp1 = ttk.Frame(pin_frame); rp1.pack(fill=tk.X, pady=2)
        ttk.Label(rp1, text="PWR Pin:", width=18).pack(side=tk.LEFT)
        self.pwr_pin_var = tk.StringVar(value="05")
        ttk.Combobox(rp1, textvariable=self.pwr_pin_var,
                     values=_PIN_OPTIONS, state="readonly", width=6).pack(
                         side=tk.LEFT, padx=5)
        ttk.Label(rp1, text="P04–P07 / P11–P17 (TCA port-pin)",
                  foreground="#757575", font=("Segoe UI", 8)).pack(side=tk.LEFT, padx=4)

        rp2 = ttk.Frame(pin_frame); rp2.pack(fill=tk.X, pady=2)
        ttk.Label(rp2, text="RST Pin:", width=18).pack(side=tk.LEFT)
        self.rst_pin_var = tk.StringVar(value="06")
        ttk.Combobox(rp2, textvariable=self.rst_pin_var,
                     values=_PIN_OPTIONS, state="readonly", width=6).pack(
                         side=tk.LEFT, padx=5)

        # â”€â”€ Action â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        btn_frame = ttk.Frame(container)
        btn_frame.pack(fill=tk.X, pady=10)
        ttk.Button(btn_frame, text="âœ… Set LTE Config", style='Set.TButton',
                   command=self._set_lte_config).pack(anchor="e", padx=5)

        # â”€â”€ Info â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        info = ttk.Frame(container)
        info.pack(fill=tk.X, anchor="nw")
        ttk.Separator(info, orient="horizontal").pack(fill=tk.X, pady=5)
        ttk.Label(info, foreground="#757575", font=("Consolas", 8),
                  text="Cmd: CFLT:MODEM:APN:USER:PASS:COMM:AUTO:TIMEOUT_MS"
                       ":MAX_RETRY:PWR_PIN:RST_PIN").pack(anchor="w")
        ttk.Label(info, foreground="#757575", font=("Consolas", 8),
                  text="Example: CFLT:A7600C1:v-internet:::USB:true:30000:0:05:06"
                  ).pack(anchor="w")

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    def _check_connection(self) -> bool:
        if not self.serial_manager or not self.serial_manager.is_connected():
            messagebox.showwarning("Warning", "Not connected to gateway")
            return False
        return True

    def _set_lte_config(self):
        if not self._check_connection():
            return
        modem    = self.modem_name_var.get().strip()
        apn      = self.apn_var.get().strip()
        username = self.username_var.get().strip()
        password = self.password_var.get()
        comm     = self.comm_var.get()
        reconnect = "true" if self.reconnect_var.get() else "false"
        timeout  = self.timeout_var.get().strip()
        retry    = self.retry_var.get().strip()
        pwr_pin  = self.pwr_pin_var.get()
        rst_pin  = self.rst_pin_var.get()

        if not apn:
            messagebox.showwarning("Input", "APN cannot be empty.")
            return
        if not modem:
            messagebox.showwarning("Input", "Modem Name cannot be empty.")
            return

        cmd = (f"CFLT:{modem}:{apn}:{username}:{password}"
               f":{comm}:{reconnect}:{timeout}:{retry}:{pwr_pin}:{rst_pin}")

        def _send_seq():
            self.log(f"â†’ {cmd}", "DEBUG")
            self.serial_manager.send(cmd)
            self.log("âœ“ LTE Config sent", "SUCCESS")
            import time
            time.sleep(1.0)
            self.log("â†’ CFIN:LTE", "DEBUG")
            self.serial_manager.send("CFIN:LTE")
            self.log("âœ“ Internet type = LTE set", "SUCCESS")

        t = threading.Thread(target=_send_seq, daemon=True)
        t.start()

    def set_config(self, config):
        """Populate fields from loaded GatewayConfig.wan."""
        wan = config if hasattr(config, "lte_apn") else getattr(config, "wan", config)

        stack_id = getattr(wan, "stack_wan_id", "100")
        self._stack_id_var.set(stack_id)

        # Look up adapter label from stack_id_map
        wan_map  = self._stack_map.get("wan_stack_map", {})
        entry    = wan_map.get(stack_id, {})
        label    = entry.get("label", f"Stack {stack_id}")
        self._adapter_lbl.config(text=f"({label})")

        # Fill modem name from JSON default or from config
        if getattr(wan, "lte_modem_name", ""):
            self.modem_name_var.set(wan.lte_modem_name)
        elif entry.get("modem"):
            self.modem_name_var.set(entry["modem"])

        # Comm type
        if entry.get("comm_type"):
            self.comm_var.set(entry["comm_type"])
        elif getattr(wan, "lte_comm_type", ""):
            self.comm_var.set(wan.lte_comm_type)

        # APN / auth
        self.apn_var.set(getattr(wan, "lte_apn", "") or "")
        self.username_var.set(getattr(wan, "lte_username", "") or "")
        pwd = getattr(wan, "lte_password", "") or ""
        if pwd and pwd != "***HIDDEN***":
            self.password_var.set(pwd)

        # Connection settings
        auto = getattr(wan, "lte_auto_reconnect", "true")
        self.reconnect_var.set(str(auto).lower() in ("true", "1"))
        timeout_ms = getattr(wan, "lte_timeout_ms", 30000)
        self.timeout_var.set(str(timeout_ms))
        self.retry_var.set(str(getattr(wan, "lte_max_retries", 0)))

        # GPIO pins â€” prefer config, fallback to stack_id_map default
        pwr = getattr(wan, "lte_pwr_pin", "") or entry.get("pwr_pin", "WK")
        rst = getattr(wan, "lte_rst_pin", "") or entry.get("rst_pin", "PE")
        if pwr in _PIN_OPTIONS:
            self.pwr_pin_var.set(pwr)
        if rst in _PIN_OPTIONS:
            self.rst_pin_var.set(rst)

    def get_config(self) -> dict:
        return {
            "stack_wan_id":     self._stack_id_var.get(),
            "lte_modem_name":   self.modem_name_var.get(),
            "lte_apn":          self.apn_var.get(),
            "lte_username":     self.username_var.get(),
            "lte_password":     self.password_var.get(),
            "lte_comm_type":    self.comm_var.get(),
            "lte_auto_reconnect": "true" if self.reconnect_var.get() else "false",
            "lte_timeout_ms":   int(self.timeout_var.get()),
            "lte_max_retries":  int(self.retry_var.get()),
            "lte_pwr_pin":      self.pwr_pin_var.get(),
            "lte_rst_pin":      self.rst_pin_var.get(),
        }
