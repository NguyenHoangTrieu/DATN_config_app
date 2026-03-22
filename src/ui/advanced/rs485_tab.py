"""
RS485 Configuration Tab

Handles:
  - Baud rate configuration (CFRS:BR:<baud>)
  - GPIO mode configuration JSON (CFRS:JSON:0:{...})
    Defines which GPIO pins toggle for SEND_MODE and RECEIVE_MODE (DE/RE lines).
"""

import json
import tkinter as tk
from tkinter import ttk, messagebox
import threading

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))))

from src.config.protocol import Rs485Config


# Default pin options (stack 0 = port '0', pins 1-9)
_PIN_OPTIONS_S0 = ["01", "02", "03", "04", "05", "06", "07", "08", "09"]
_PIN_OPTIONS_S1 = ["11", "12", "13", "14", "15", "16", "17", "18", "19"]

# Default GPIO config: DE=pin03 HIGH, RE=pin02 HIGH for SEND; both LOW for RECV
_DEFAULT_SEND_GPIO = [{"pin": "03", "state": "HIGH"}, {"pin": "02", "state": "HIGH"}]
_DEFAULT_RECV_GPIO = [{"pin": "03", "state": "LOW"},  {"pin": "02", "state": "LOW"}]


class _GpioPinRow(ttk.Frame):
    """Single GPIO pin action row: [Pin ▼] [State ▼] [X]"""

    def __init__(self, parent, pin_var, state_var, remove_cb, **kwargs):
        super().__init__(parent, **kwargs)
        self.pin_var   = pin_var
        self.state_var = state_var

        pins = _PIN_OPTIONS_S0 + _PIN_OPTIONS_S1
        ttk.Combobox(self, textvariable=pin_var, values=pins,
                     state="readonly", width=6).pack(side=tk.LEFT, padx=2)
        ttk.Combobox(self, textvariable=state_var, values=["HIGH", "LOW"],
                     state="readonly", width=7).pack(side=tk.LEFT, padx=2)
        ttk.Button(self, text="✕", width=2, command=remove_cb).pack(side=tk.LEFT)


class _GpioPinList(ttk.LabelFrame):
    """Editable list of GPIO pin actions for one RS485 mode."""

    def __init__(self, parent, label, defaults, **kwargs):
        super().__init__(parent, text=label, padding=4, **kwargs)
        self._rows: list[tuple[tk.StringVar, tk.StringVar, _GpioPinRow]] = []
        self._container = ttk.Frame(self)
        self._container.pack(fill=tk.X)
        ttk.Button(self, text="+ Add Pin", command=self._add_empty).pack(anchor="w", pady=2)

        self._delay_var = tk.StringVar(value="1")
        df = ttk.Frame(self)
        df.pack(fill=tk.X)
        ttk.Label(df, text="Delay after (ms):").pack(side=tk.LEFT)
        ttk.Entry(df, textvariable=self._delay_var, width=8).pack(side=tk.LEFT, padx=4)

        for item in defaults:
            self._add_row(item["pin"], item["state"])

    def _add_empty(self):
        self._add_row("03", "HIGH")

    def _add_row(self, pin: str, state: str):
        pv = tk.StringVar(value=pin)
        sv = tk.StringVar(value=state)
        row = _GpioPinRow(self._container, pv, sv,
                          remove_cb=lambda r=(pv, sv, None): self._remove(pv))
        row.pack(fill=tk.X, pady=1)
        self._rows.append((pv, sv, row))

    def _remove(self, pin_var):
        self._rows = [(p, s, r) for (p, s, r) in self._rows if p is not pin_var]
        for widget in self._container.winfo_children():
            widget.destroy()
        tmp = list(self._rows)
        self._rows = []
        for (pv, sv, _) in tmp:
            self._add_row(pv.get(), sv.get())

    def get_gpio_list(self) -> list:
        return [{"pin": p.get(), "state": s.get()} for (p, s, _) in self._rows]

    def get_delay(self) -> int:
        try:
            return int(self._delay_var.get())
        except ValueError:
            return 0


class Rs485Tab(ttk.Frame):
    """RS485 configuration tab — baud rate + GPIO mode config"""

    def __init__(self, parent, serial_manager=None, log_callback=None, **kwargs):
        super().__init__(parent, **kwargs)
        self.serial_manager = serial_manager
        self.log = log_callback or (lambda msg, lvl="INFO": None)
        self._create_widgets()

    def _create_widgets(self):
        container = ttk.Frame(self, padding=10)
        container.pack(fill=tk.BOTH, expand=True, anchor="nw")

        # ── Baud Rate Section ──────────────────────────────────────────────
        baud_section = ttk.LabelFrame(container, text="RS485 Communication", padding=8)
        baud_section.pack(fill=tk.X, pady=5)

        baud_frame = ttk.Frame(baud_section)
        baud_frame.pack(pady=2, anchor="w")
        ttk.Label(baud_frame, text="Baud Rate:", width=12).pack(side=tk.LEFT)
        self.baud_var = tk.StringVar(value="115200")
        ttk.Combobox(baud_frame, textvariable=self.baud_var,
                     values=["9600", "19200", "38400", "57600", "115200"],
                     state="readonly", width=15).pack(side=tk.LEFT, padx=5)

        ttk.Label(baud_section, text="Data format: 8N1",
                  font=("Segoe UI", 9), foreground="#757575").pack(anchor="w", pady=3)

        ttk.Button(baud_section, text="Set Baud Rate",
                   command=self._set_baud).pack(anchor="e", padx=5, pady=4)

        # ── GPIO Mode Config Section ───────────────────────────────────────
        gpio_section = ttk.LabelFrame(container, text="GPIO Mode Config (JSON)", padding=8)
        gpio_section.pack(fill=tk.X, pady=5)

        ttk.Label(gpio_section,
                  text="Configure DE/RE pin toggling for SEND and RECEIVE modes.\n"
                       "Pin format: XY — X=stack port (0/1), Y=pin number (1-9).\n"
                       "Default: pin 03 = DE (STACK_GPIO_2), pin 02 = RE (STACK_GPIO_1)",
                  font=("Segoe UI", 9), foreground="#757575",
                  justify=tk.LEFT).pack(anchor="w", pady=(0, 6))

        stack_frame = ttk.Frame(gpio_section)
        stack_frame.pack(anchor="w", pady=(0, 4))
        ttk.Label(stack_frame, text="Stack ID:").pack(side=tk.LEFT)
        self._stack_var = tk.StringVar(value="0")
        ttk.Combobox(stack_frame, textvariable=self._stack_var,
                     values=["0", "1"], state="readonly",
                     width=4).pack(side=tk.LEFT, padx=4)

        # Send mode pin list
        self._send_list = _GpioPinList(gpio_section, "SEND Mode (TX / DE+RE = HIGH)",
                                        _DEFAULT_SEND_GPIO)
        self._send_list.pack(fill=tk.X, pady=2)

        # Receive mode pin list
        self._recv_list = _GpioPinList(gpio_section, "RECEIVE Mode (RX / DE+RE = LOW)",
                                        _DEFAULT_RECV_GPIO)
        self._recv_list.pack(fill=tk.X, pady=2)

        btn_frame = ttk.Frame(gpio_section)
        btn_frame.pack(fill=tk.X, pady=(8, 0))
        ttk.Button(btn_frame, text="Preview JSON",
                   command=self._preview_json).pack(side=tk.LEFT, padx=4)
        ttk.Button(btn_frame, text="Send GPIO Config to Gateway", style="Set.TButton",
                   command=self._send_gpio_config).pack(side=tk.RIGHT, padx=4)

    # ── Connection check ────────────────────────────────────────────────────

    def _check_connection(self) -> bool:
        if not self.serial_manager or not self.serial_manager.is_connected():
            messagebox.showwarning("Warning", "Not connected to gateway")
            return False
        return True

    # ── Baud rate ───────────────────────────────────────────────────────────

    def _set_baud(self):
        if not self._check_connection():
            return
        baud = self.baud_var.get()
        cmd = f"CFRS:BR:{baud}\r\n"
        self.log(f"→ {cmd.strip()}", "DEBUG")
        if self.serial_manager.send(cmd):
            self.log(f"✓ RS485 Baud = {baud} — Sent", "SUCCESS")
        else:
            self.log("✗ RS485 Baud — Send failed", "ERROR")

    # ── GPIO JSON ───────────────────────────────────────────────────────────

    def _build_json(self) -> str:
        stack_id = int(self._stack_var.get())
        send_gpio = self._send_list.get_gpio_list()
        send_delay = self._send_list.get_delay()
        recv_gpio = self._recv_list.get_gpio_list()
        recv_delay = self._recv_list.get_delay()

        config = {
            "module_id": "RS485",
            "module_type": "RS485",
            "stack_id": stack_id,
            "functions": [
                {
                    "function_name": "RS485_SEND_MODE",
                    "gpio_start_control": send_gpio,
                    "delay_start": send_delay,
                    "gpio_end_control": [],
                    "delay_end": 0
                },
                {
                    "function_name": "RS485_RECEIVE_MODE",
                    "gpio_start_control": recv_gpio,
                    "delay_start": recv_delay,
                    "gpio_end_control": [],
                    "delay_end": 0
                }
            ]
        }
        return json.dumps(config, separators=(",", ":"))

    def _preview_json(self):
        try:
            js = self._build_json()
            parsed = json.loads(js)
            pretty = json.dumps(parsed, indent=2)
            win = tk.Toplevel(self)
            win.title("RS485 GPIO Config JSON Preview")
            win.geometry("500x380")
            txt = tk.Text(win, wrap=tk.WORD, font=("Courier New", 10))
            txt.insert("1.0", pretty)
            txt.config(state=tk.DISABLED)
            txt.pack(fill=tk.BOTH, expand=True, padx=8, pady=8)
        except Exception as e:
            messagebox.showerror("Error", f"Failed to build JSON: {e}")

    def _send_gpio_config(self):
        if not self._check_connection():
            return
        try:
            stack_id = self._stack_var.get()
            js = self._build_json()
            cmd = f"CFRS:JSON:{stack_id}:{js}\r\n"
            self.log(f"→ CFRS:JSON:{stack_id}:... ({len(js)} bytes)", "DEBUG")
            if self.serial_manager.send(cmd):
                self.log("✓ RS485 GPIO config sent", "SUCCESS")
            else:
                self.log("✗ RS485 GPIO config — Send failed", "ERROR")
        except Exception as e:
            self.log(f"✗ Error building RS485 JSON: {e}", "ERROR")

    # ── get/set config ──────────────────────────────────────────────────────

    def get_config(self) -> Rs485Config:
        config = Rs485Config()
        try:
            config.baud_rate = int(self.baud_var.get())
        except Exception:
            config.baud_rate = 115200
        return config

    def set_config(self, config: Rs485Config):
        self.baud_var.set(str(config.baud_rate))

