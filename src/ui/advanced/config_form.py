"""
Shared JSON Config Builder widget for Advanced Mode tabs.

Provides:
  - Communication section (port_type → conditional fields)
  - Functions accordion (grouped, per-function fields)
  - JSON Preview (realtime, editable)
  - Action buttons (Generate / Save / Load / Send)
  - Status panel

Used by BLE, LoRa, and Zigbee tabs.
"""

import tkinter as tk
from tkinter import ttk, messagebox, filedialog
import json
import os
from typing import Optional, Callable

from src.config.paths import get_pin_options

# ── Function group definitions per module type ──────────────────────────────
# Each entry: {"emoji": str, "title": str, "functions": [function_name, ...]}
FUNCTION_GROUPS: dict[str, list[dict]] = {
    "BLE": [
        {"emoji": "🔄", "title": "System", "functions": [
            "MODULE_HW_RESET", "MODULE_SW_RESET", "MODULE_FACTORY_RESET",
            "MODULE_ENTER_CMD_MODE", "MODULE_ENTER_SLEEP", "MODULE_WAKEUP",
            "MODULE_START_BROADCAST"]},
        {"emoji": "ℹ️", "title": "Info", "functions": [
            "MODULE_GET_INFO", "MODULE_GET_CONNECTION_STATUS",
            "MODULE_GET_DIAGNOSTICS"]},
        {"emoji": "⚙️", "title": "Config", "functions": [
            "MODULE_SET_NAME", "MODULE_SET_COMM_CONFIG", "MODULE_SET_RF_PARAMS"]},
        {"emoji": "🔍", "title": "Discovery", "functions": [
            "MODULE_START_DISCOVERY", "MODULE_DISCOVER_SERVICES",
            "MODULE_DISCOVER_CHARACTERISTICS"]},
        {"emoji": "🔗", "title": "Connection", "functions": [
            "MODULE_CONNECT", "MODULE_DISCONNECT", "MODULE_ENTER_DATA_MODE"]},
        {"emoji": "📨", "title": "Data", "functions": [
            "MODULE_SEND_DATA"]},
    ],
    "LORA": [
        {"emoji": "🔄", "title": "System", "functions": [
            "MODULE_HW_RESET", "MODULE_SW_RESET", "MODULE_GET_INFO",
            "MODULE_FACTORY_RESET"]},
        {"emoji": "🌍", "title": "Region & Class", "functions": [
            "MODULE_SET_REGION", "MODULE_SET_CLASS"]},
        {"emoji": "🔑", "title": "OTAA Provisioning", "functions": [
            "MODULE_SET_JOIN_MODE", "MODULE_SET_DEVEUI", "MODULE_GET_DEVEUI",
            "MODULE_SET_APPEUI", "MODULE_SET_APPKEY", "MODULE_JOIN",
            "MODULE_GET_JOIN_STATUS"]},
        {"emoji": "🔒", "title": "ABP Provisioning", "functions": [
            "MODULE_SET_DEVADDR", "MODULE_SET_NWKSKEY", "MODULE_SET_APPSKEY"]},
        {"emoji": "📶", "title": "MAC & RF Settings", "functions": [
            "MODULE_SET_DR", "MODULE_SET_ADR", "MODULE_SET_TXP",
            "MODULE_SET_CHANNEL", "MODULE_SET_CONFIRM", "MODULE_SET_PUBLIC_NET"]},
        {"emoji": "📨", "title": "Data", "functions": [
            "MODULE_SEND_UNCONFIRMED", "MODULE_SEND_CONFIRMED",
            "MODULE_READ_RECV"]},
    ],
    "ZIGBEE": [
        {"emoji": "🔄", "title": "Lifecycle", "functions": [
            "MODULE_HW_RESET", "MODULE_SW_RESET", "MODULE_FACTORY_RESET",
            "MODULE_GET_INFO", "MODULE_ENTER_HEX_MODE", "MODULE_ENTER_AT_MODE",
            "MODULE_ENTER_BOOTLOADER", "MODULE_SET_COMM_CONFIG"]},
        {"emoji": "🌐", "title": "Network Management", "functions": [
            "MODULE_START_NETWORK", "MODULE_STOP_NETWORK", "MODULE_LEAVE_NETWORK",
            "MODULE_GET_NET_STATUS", "MODULE_SET_CHANNEL", "MODULE_SET_PANID",
            "MODULE_SET_TX_POWER", "MODULE_SET_PERMIT_JOIN", "MODULE_SET_DEVICE_TYPE"]},
        {"emoji": "🔍", "title": "Node Discovery", "functions": [
            "MODULE_NODE_JOIN_NOTIFY", "MODULE_NODE_LEAVE_NOTIFY",
            "MODULE_NODE_ANNOUNCE_NOTIFY", "MODULE_QUERY_SHORT_ADDR",
            "MODULE_QUERY_NODE_PORT_INFO", "MODULE_QUERY_IEEE_ADDR",
            "MODULE_DELETE_NODE", "MODULE_AUTO_FIND_TARGET"]},
        {"emoji": "⚡", "title": "ZCL Control", "functions": [
            "MODULE_ZCL_READ_ATTR", "MODULE_ZCL_WRITE_ATTR",
            "MODULE_ZCL_SEND_CONTROL_CMD", "MODULE_ZCL_RECV_CONTROL_CMD",
            "MODULE_ZCL_RECV_ATTR_REPORT", "MODULE_ZCL_SET_REPORT_RULE",
            "MODULE_ZCL_DISCOVER_ATTR", "MODULE_ZCL_IDENTIFY",
            "MODULE_ZCL_BIND", "MODULE_ZCL_UNBIND", "MODULE_ZCL_GET_BIND_TABLE"]},
        {"emoji": "📨", "title": "Data Transfer", "functions": [
            "MODULE_SEND_UNICAST", "MODULE_SEND_BROADCAST", "MODULE_SEND_MULTICAST",
            "MODULE_ENTER_TRANSPARENT_MODE", "MODULE_SET_DEST_ADDR",
            "MODULE_SET_DEST_EP"]},
        {"emoji": "💤", "title": "Power Management", "functions": [
            "MODULE_SET_LP_LEVEL", "MODULE_ENTER_SLEEP", "MODULE_WAKEUP"]},
    ],
}

PIN_OPTIONS = []  # Populated at first use


def _get_pins() -> list[str]:
    global PIN_OPTIONS
    if not PIN_OPTIONS:
        PIN_OPTIONS = get_pin_options()
    return PIN_OPTIONS


class GpioRow(ttk.Frame):
    """A single GPIO pin+state row with a remove button."""

    def __init__(self, parent, pin: str = "01", state: str = "LOW",
                 on_change=None, on_remove=None, **kw):
        super().__init__(parent, **kw)
        self._on_change = on_change

        self.pin_var = tk.StringVar(value=pin)
        self.state_var = tk.StringVar(value=state)

        ttk.Label(self, text="Pin:").pack(side=tk.LEFT, padx=(0, 2))
        pin_cb = ttk.Combobox(self, textvariable=self.pin_var,
                              values=_get_pins(), state="readonly", width=5)
        pin_cb.pack(side=tk.LEFT, padx=2)
        pin_cb.bind("<<ComboboxSelected>>", lambda e: self._changed())

        ttk.Label(self, text="State:").pack(side=tk.LEFT, padx=(6, 2))
        state_cb = ttk.Combobox(self, textvariable=self.state_var,
                                values=["LOW", "HIGH"], state="readonly", width=5)
        state_cb.pack(side=tk.LEFT, padx=2)
        state_cb.bind("<<ComboboxSelected>>", lambda e: self._changed())

        ttk.Button(self, text="✕", width=2,
                   command=on_remove).pack(side=tk.LEFT, padx=4)

    def _changed(self):
        if self._on_change:
            self._on_change()

    def get_data(self) -> dict:
        return {"pin": self.pin_var.get(), "state": self.state_var.get()}


class GpioListWidget(ttk.Frame):
    """Dynamic list of GPIO rows with an Add button."""

    def __init__(self, parent, label: str, initial: list[dict] | None = None,
                 on_change=None, **kw):
        super().__init__(parent, **kw)
        self._on_change = on_change
        self._rows: list[GpioRow] = []

        ttk.Label(self, text=f"{label}:").pack(anchor="w")
        self._rows_frame = ttk.Frame(self)
        self._rows_frame.pack(fill=tk.X)
        ttk.Button(self, text="+ Add GPIO", width=12,
                   command=self._add_row).pack(anchor="w", pady=(2, 0))

        if initial:
            for gpio in initial:
                self._add_row(gpio.get("pin", "01"), gpio.get("state", "LOW"))

    def _add_row(self, pin: str = "01", state: str = "LOW"):
        row = GpioRow(self._rows_frame, pin=pin, state=state,
                      on_change=self._on_change,
                      on_remove=lambda r=None: self._remove_row(r))
        # Fix the remove lambda to know which row
        row.children[list(row.children.keys())[-1]].configure(
            command=lambda: self._remove_row(row))
        row.pack(fill=tk.X, pady=1)
        self._rows.append(row)
        if self._on_change:
            self._on_change()

    def _remove_row(self, row: GpioRow):
        if row in self._rows:
            self._rows.remove(row)
            row.destroy()
            if self._on_change:
                self._on_change()

    def get_data(self) -> list[dict]:
        return [r.get_data() for r in self._rows]

    def set_data(self, gpio_list: list[dict]):
        for r in self._rows[:]:
            r.destroy()
        self._rows.clear()
        for gpio in gpio_list:
            self._add_row(gpio.get("pin", "01"), gpio.get("state", "LOW"))


class FunctionItem(ttk.Frame):
    """A single function accordion item with expand/collapse."""

    def __init__(self, parent, func_data: dict, module_type: str,
                 on_change=None, **kw):
        super().__init__(parent, **kw)
        self._func_data = func_data
        self._module_type = module_type
        self._on_change = on_change
        self._expanded = False
        self._widgets: dict = {}

        self._build_header()
        self._body_frame = ttk.Frame(self)
        self._build_body()

    def _notify_change(self, *_args):
        if self._on_change:
            self._on_change()

    def _build_header(self):
        hdr = ttk.Frame(self)
        hdr.pack(fill=tk.X)

        self._arrow_var = tk.StringVar(value="▸")
        arrow_btn = ttk.Label(hdr, textvariable=self._arrow_var,
                              cursor="hand2", width=2)
        arrow_btn.pack(side=tk.LEFT)
        arrow_btn.bind("<Button-1>", self._toggle)

        name = self._func_data.get("function_name", "UNKNOWN")
        name_lbl = tk.Label(hdr, text=name, font=("Segoe UI", 9, "bold"),
                            fg="#003399", cursor="hand2")
        name_lbl.pack(side=tk.LEFT, padx=4)
        name_lbl.bind("<Button-1>", self._toggle)

        # Async badge for Zigbee
        if self._func_data.get("is_async_event"):
            badge = tk.Label(hdr, text="⚡ async", fg="#FF8C00", bg="#FFEEDD",
                             font=("Segoe UI", 7, "bold"), padx=3, pady=1)
            badge.pack(side=tk.LEFT, padx=4)

        self._enabled_var = tk.BooleanVar(value=True)
        cb = ttk.Checkbutton(hdr, text="Enabled", variable=self._enabled_var,
                             command=self._notify_change)
        cb.pack(side=tk.RIGHT, padx=4)

    def _toggle(self, _event=None):
        self._expanded = not self._expanded
        if self._expanded:
            self._arrow_var.set("▾")
            self._body_frame.pack(fill=tk.X, padx=(20, 4), pady=(0, 4))
        else:
            self._arrow_var.set("▸")
            self._body_frame.pack_forget()

    def _add_field(self, parent, label: str, var, widget_type="entry",
                   options=None, width=20, row=None):
        """Helper to add a labeled field."""
        fr = ttk.Frame(parent)
        fr.pack(fill=tk.X, pady=1)
        ttk.Label(fr, text=f"{label}:", width=14).pack(side=tk.LEFT)
        if widget_type == "entry":
            w = ttk.Entry(fr, textvariable=var, width=width)
            w.pack(side=tk.LEFT, padx=4, fill=tk.X, expand=True)
            var.trace_add("write", self._notify_change)
        elif widget_type == "combo":
            w = ttk.Combobox(fr, textvariable=var, values=options or [],
                             state="readonly", width=width)
            w.pack(side=tk.LEFT, padx=4)
            w.bind("<<ComboboxSelected>>", self._notify_change)
        elif widget_type == "spin":
            w = ttk.Spinbox(fr, textvariable=var, from_=0, to=60000,
                            increment=options or 100, width=width)
            w.pack(side=tk.LEFT, padx=4)
            var.trace_add("write", self._notify_change)
            ttk.Label(fr, text="ms").pack(side=tk.LEFT)
        elif widget_type == "check":
            w = ttk.Checkbutton(fr, variable=var, command=self._notify_change)
            w.pack(side=tk.LEFT, padx=4)
        self._widgets[label] = w
        return fr, w

    def _build_body(self):
        body = self._body_frame
        fd = self._func_data

        # Command
        self._cmd_var = tk.StringVar(value=fd.get("command", ""))
        self._add_field(body, "Command", self._cmd_var, width=35)

        # Is prefix
        self._prefix_var = tk.BooleanVar(value=fd.get("is_prefix", False))
        self._add_field(body, "Is Prefix", self._prefix_var, "check")

        # Is hex (all module types: false=ASCII/AT, true=binary HEX frame)
        self._is_hex_var = tk.BooleanVar(value=fd.get("is_hex", False))
        self._add_field(body, "Is Hex", self._is_hex_var, "check")

        # Zigbee async event flag (read-only indicator from JSON data)
        if self._module_type == "ZIGBEE":
            self._is_async = fd.get("is_async_event", False)

        # GPIO start
        self._gpio_start = GpioListWidget(
            body, "GPIO Start",
            initial=fd.get("gpio_start_control", []),
            on_change=self._notify_change)
        self._gpio_start.pack(fill=tk.X, pady=2)

        # Delay start
        self._delay_start_var = tk.StringVar(
            value=str(fd.get("delay_start", 0)))
        self._add_field(body, "Delay Start", self._delay_start_var, "spin",
                        options=50, width=8)

        # GPIO end
        self._gpio_end = GpioListWidget(
            body, "GPIO End",
            initial=fd.get("gpio_end_control", []),
            on_change=self._notify_change)
        self._gpio_end.pack(fill=tk.X, pady=2)

        # Delay end
        self._delay_end_var = tk.StringVar(value=str(fd.get("delay_end", 0)))
        self._add_field(body, "Delay End", self._delay_end_var, "spin",
                        options=50, width=8)

        # Expect response
        self._expect_var = tk.StringVar(
            value=fd.get("expect_response", ""))
        self._add_field(body, "Expect Resp", self._expect_var, width=30)

        # Timeout
        self._timeout_var = tk.StringVar(value=str(fd.get("timeout", 0)))
        _, timeout_w = self._add_field(body, "Timeout", self._timeout_var,
                                       "spin", options=100, width=8)

        # Zigbee async → disable timeout
        if self._module_type == "ZIGBEE" and getattr(self, "_is_async", False):
            timeout_w.configure(state="disabled")

    def get_data(self) -> dict:
        """Build function dict from widget state."""
        d: dict = {
            "function_name": self._func_data.get("function_name", ""),
            "command": self._cmd_var.get(),
            "is_prefix": self._prefix_var.get(),
            "is_hex": self._is_hex_var.get(),
        }

        # Zigbee async event flag
        if self._module_type == "ZIGBEE" and getattr(self, "_is_async", False):
            d["is_async_event"] = True

        d["gpio_start_control"] = self._gpio_start.get_data()
        d["delay_start"] = self._safe_int(self._delay_start_var.get())
        d["expect_response"] = self._expect_var.get()
        d["timeout"] = self._safe_int(self._timeout_var.get())
        d["gpio_end_control"] = self._gpio_end.get_data()
        d["delay_end"] = self._safe_int(self._delay_end_var.get())

        if not self._enabled_var.get():
            d["enabled"] = False

        return d

    def load_data(self, func_data: dict):
        """Load function data into widgets."""
        self._func_data = func_data
        self._cmd_var.set(func_data.get("command", ""))
        self._prefix_var.set(func_data.get("is_prefix", False))
        self._is_hex_var.set(func_data.get("is_hex", False))
        self._enabled_var.set(func_data.get("enabled", True))
        self._gpio_start.set_data(func_data.get("gpio_start_control", []))
        self._delay_start_var.set(str(func_data.get("delay_start", 0)))
        self._gpio_end.set_data(func_data.get("gpio_end_control", []))
        self._delay_end_var.set(str(func_data.get("delay_end", 0)))
        self._expect_var.set(func_data.get("expect_response", ""))
        self._timeout_var.set(str(func_data.get("timeout", 0)))

    @staticmethod
    def _parse_hex_val(text: str) -> int:
        text = text.strip()
        if text.upper() == "N/A" or text == "":
            return -1
        try:
            if text.lower().startswith("0x"):
                return int(text, 16)
            return int(text)
        except ValueError:
            return -1

    @staticmethod
    def _safe_int(text: str) -> int:
        try:
            return int(text)
        except (ValueError, TypeError):
            return 0


class ConfigForm(ttk.Frame):
    """The main JSON Config Builder form widget.

    Parameters
    ----------
    module_type : str  — "BLE", "LORA", or "ZIGBEE"
    cmd_prefix  : str  — "CFBL", "CFLR", or "CFZB"
    """

    def __init__(self, parent, module_type: str, cmd_prefix: str,
                 serial_manager=None,
                 log_callback: Optional[Callable] = None,
                 module_config: Optional[dict] = None,
                 **kw):
        super().__init__(parent, **kw)
        self._module_type = module_type
        self._cmd_prefix = cmd_prefix
        self.serial_manager = serial_manager
        self.log = log_callback or (lambda msg, lvl="INFO": None)

        self._module_config = module_config or {}
        self._function_items: list[FunctionItem] = []
        self._loaded_file: str = ""  # Path to currently loaded/generated file
        self._suppress_preview = False
        self._stack_slot_var = tk.StringVar(value="S1")

        self._build_ui()
        if self._module_config:
            self._populate_from_config(self._module_config)
        self._update_preview()

    # ──────────────────────────────────────────────────────────────
    # UI Build
    # ──────────────────────────────────────────────────────────────
    def _build_ui(self):
        paned = ttk.PanedWindow(self, orient=tk.HORIZONTAL)
        paned.pack(fill=tk.BOTH, expand=True)

        # ── Left panel (scrollable) ──────────────────────────────
        left_canvas = tk.Canvas(paned, highlightthickness=0)
        left_sb = ttk.Scrollbar(left_canvas, orient="vertical",
                                command=left_canvas.yview)
        left_sb.pack(side=tk.RIGHT, fill=tk.Y)
        left_canvas.configure(yscrollcommand=left_sb.set)

        self._left_frame = ttk.Frame(left_canvas)
        _lwin = left_canvas.create_window((0, 0), window=self._left_frame,
                                          anchor="nw")

        def _on_left_cfg(e):
            left_canvas.configure(scrollregion=left_canvas.bbox("all"))

        def _on_canvas_cfg(e):
            w = e.width - left_sb.winfo_reqwidth()
            left_canvas.itemconfig(_lwin, width=max(w, 1))

        self._left_frame.bind("<Configure>", _on_left_cfg)
        left_canvas.bind("<Configure>", _on_canvas_cfg)

        # Mouse wheel scrolling
        def _bind_wheel(e):
            left_canvas.bind_all(
                "<MouseWheel>",
                lambda ev: left_canvas.yview_scroll(-1 * (ev.delta // 120), "units"))

        def _unbind_wheel(e):
            left_canvas.unbind_all("<MouseWheel>")

        left_canvas.bind("<Enter>", _bind_wheel)
        left_canvas.bind("<Leave>", _unbind_wheel)

        # ── Right panel ──────────────────────────────────────────
        right_frame = ttk.Frame(paned)

        paned.add(left_canvas, weight=3)
        paned.add(right_frame, weight=2)

        # Build sections
        self._build_comm_section(self._left_frame)
        self._build_functions_section(self._left_frame)
        self._build_actions(right_frame)
        self._build_preview(right_frame)

    # ── Communication Section ─────────────────────────────────────
    def _build_comm_section(self, parent):
        comm = ttk.LabelFrame(parent, text="🔌 Communication", padding=6)
        comm.pack(fill=tk.X, padx=6, pady=4)

        # Port type
        fr_pt = ttk.Frame(comm)
        fr_pt.pack(fill=tk.X, pady=1)
        ttk.Label(fr_pt, text="Port type:", width=12).pack(side=tk.LEFT)
        self._port_type_var = tk.StringVar(value="uart")
        pt_cb = ttk.Combobox(fr_pt, textvariable=self._port_type_var,
                             values=["uart", "usb", "spi", "i2c"],
                             state="readonly", width=10)
        pt_cb.pack(side=tk.LEFT, padx=4)
        pt_cb.bind("<<ComboboxSelected>>", self._on_port_type_change)

        # UART/USB fields
        self._uart_frame = ttk.Frame(comm)
        self._uart_frame.pack(fill=tk.X)

        fr_baud = ttk.Frame(self._uart_frame)
        fr_baud.pack(fill=tk.X, pady=1)
        ttk.Label(fr_baud, text="Baudrate:", width=12).pack(side=tk.LEFT)
        self._baud_var = tk.StringVar(value="115200")
        ttk.Combobox(fr_baud, textvariable=self._baud_var,
                     values=["9600", "38400", "57600", "115200", "230400"],
                     state="readonly", width=10).pack(side=tk.LEFT, padx=4)
        self._baud_var.trace_add("write", lambda *_: self._update_preview())

        self._uart_only_frame = ttk.Frame(self._uart_frame)
        self._uart_only_frame.pack(fill=tk.X)

        fr_par = ttk.Frame(self._uart_only_frame)
        fr_par.pack(fill=tk.X, pady=1)
        ttk.Label(fr_par, text="Parity:", width=12).pack(side=tk.LEFT)
        self._parity_var = tk.StringVar(value="none")
        ttk.Combobox(fr_par, textvariable=self._parity_var,
                     values=["none", "odd", "even"],
                     state="readonly", width=10).pack(side=tk.LEFT, padx=4)
        self._parity_var.trace_add("write", lambda *_: self._update_preview())

        fr_stop = ttk.Frame(self._uart_only_frame)
        fr_stop.pack(fill=tk.X, pady=1)
        ttk.Label(fr_stop, text="Stop bit:", width=12).pack(side=tk.LEFT)
        self._stop_var = tk.StringVar(value="1")
        ttk.Combobox(fr_stop, textvariable=self._stop_var,
                     values=["1", "2"], state="readonly",
                     width=10).pack(side=tk.LEFT, padx=4)
        self._stop_var.trace_add("write", lambda *_: self._update_preview())

        # SPI fields
        self._spi_frame = ttk.Frame(comm)
        fr_smode = ttk.Frame(self._spi_frame)
        fr_smode.pack(fill=tk.X, pady=1)
        ttk.Label(fr_smode, text="SPI mode:", width=12).pack(side=tk.LEFT)
        self._spi_mode_var = tk.StringVar(value="0")
        ttk.Combobox(fr_smode, textvariable=self._spi_mode_var,
                     values=["0", "1", "2", "3"],
                     state="readonly", width=10).pack(side=tk.LEFT, padx=4)

        fr_sclk = ttk.Frame(self._spi_frame)
        fr_sclk.pack(fill=tk.X, pady=1)
        ttk.Label(fr_sclk, text="Clock Hz:", width=12).pack(side=tk.LEFT)
        self._spi_clk_var = tk.StringVar(value="1000000")
        ttk.Spinbox(fr_sclk, textvariable=self._spi_clk_var,
                    from_=100000, to=40000000, increment=100000,
                    width=12).pack(side=tk.LEFT, padx=4)

        fr_scs = ttk.Frame(self._spi_frame)
        fr_scs.pack(fill=tk.X, pady=1)
        ttk.Label(fr_scs, text="CS pin:", width=12).pack(side=tk.LEFT)
        self._spi_cs_var = tk.StringVar(value="05")
        ttk.Entry(fr_scs, textvariable=self._spi_cs_var,
                  width=8).pack(side=tk.LEFT, padx=4)

        for v in (self._spi_mode_var, self._spi_clk_var, self._spi_cs_var):
            v.trace_add("write", lambda *_: self._update_preview())

        # I2C fields
        self._i2c_frame = ttk.Frame(comm)
        fr_iaddr = ttk.Frame(self._i2c_frame)
        fr_iaddr.pack(fill=tk.X, pady=1)
        ttk.Label(fr_iaddr, text="I2C addr:", width=12).pack(side=tk.LEFT)
        self._i2c_addr_var = tk.StringVar(value="0x60")
        ttk.Entry(fr_iaddr, textvariable=self._i2c_addr_var,
                  width=8).pack(side=tk.LEFT, padx=4)

        fr_iclk = ttk.Frame(self._i2c_frame)
        fr_iclk.pack(fill=tk.X, pady=1)
        ttk.Label(fr_iclk, text="Clock Hz:", width=12).pack(side=tk.LEFT)
        self._i2c_clk_var = tk.StringVar(value="400000")
        ttk.Spinbox(fr_iclk, textvariable=self._i2c_clk_var,
                    from_=10000, to=1000000, increment=10000,
                    width=12).pack(side=tk.LEFT, padx=4)

        for v in (self._i2c_addr_var, self._i2c_clk_var):
            v.trace_add("write", lambda *_: self._update_preview())

        # Initial visibility
        self._on_port_type_change()

    def _on_port_type_change(self, _event=None):
        pt = self._port_type_var.get()
        # Hide all
        self._uart_frame.pack_forget()
        self._uart_only_frame.pack_forget()
        self._spi_frame.pack_forget()
        self._i2c_frame.pack_forget()

        if pt in ("uart", "usb"):
            self._uart_frame.pack(fill=tk.X)
            if pt == "uart":
                self._uart_only_frame.pack(fill=tk.X)
        elif pt == "spi":
            self._spi_frame.pack(fill=tk.X)
        elif pt == "i2c":
            self._i2c_frame.pack(fill=tk.X)

        self._update_preview()

    # ── Functions Section ─────────────────────────────────────────
    def _build_functions_section(self, parent):
        func_lf = ttk.LabelFrame(parent, text="⚙️ Functions", padding=6)
        func_lf.pack(fill=tk.X, padx=6, pady=4)
        self._func_container = func_lf

    def _populate_functions(self, functions: list[dict]):
        """Clear and re-populate function items from data."""
        # Clear old
        for fi in self._function_items:
            fi.destroy()
        self._function_items.clear()

        # Clear container children
        for w in self._func_container.winfo_children():
            w.destroy()

        # Index functions by name for fast lookup
        func_map = {f["function_name"]: f for f in functions}

        groups = FUNCTION_GROUPS.get(self._module_type, [])
        ungrouped = list(func_map.keys())

        for grp in groups:
            grp_functions = [func_map[fn] for fn in grp["functions"]
                            if fn in func_map]
            if not grp_functions:
                continue

            # Remove from ungrouped
            for fn in grp["functions"]:
                if fn in ungrouped:
                    ungrouped.remove(fn)

            # Group frame
            grp_frame = ttk.LabelFrame(
                self._func_container,
                text=f"{grp['emoji']} {grp['title']} ({len(grp_functions)})",
                padding=4)
            grp_frame.pack(fill=tk.X, pady=2)

            for fd in grp_functions:
                item = FunctionItem(grp_frame, fd, self._module_type,
                                    on_change=self._update_preview)
                item.pack(fill=tk.X, pady=1)
                self._function_items.append(item)

        # Any remaining ungrouped functions
        if ungrouped:
            other_frame = ttk.LabelFrame(
                self._func_container, text="📦 Other", padding=4)
            other_frame.pack(fill=tk.X, pady=2)
            for fn in ungrouped:
                fd = func_map[fn]
                item = FunctionItem(other_frame, fd, self._module_type,
                                    on_change=self._update_preview)
                item.pack(fill=tk.X, pady=1)
                self._function_items.append(item)

    # ── JSON Preview ──────────────────────────────────────────────
    def _build_preview(self, parent):
        pv = ttk.LabelFrame(parent, text="📄 Generated JSON", padding=6)
        pv.pack(fill=tk.BOTH, expand=True, padx=4, pady=4)

        self._preview_text = tk.Text(pv, font=("Consolas", 8), bg="#FAFAFA",
                                     wrap="none", height=15)
        sb = ttk.Scrollbar(pv, orient="vertical",
                           command=self._preview_text.yview)
        self._preview_text.configure(yscrollcommand=sb.set)
        sb.pack(side=tk.RIGHT, fill=tk.Y)
        self._preview_text.pack(fill=tk.BOTH, expand=True)

    # ── Actions ───────────────────────────────────────────────────
    def _build_actions(self, parent):
        # File label at top (moved from bottom for visibility)
        self._file_var = tk.StringVar(value="File: (none)")
        file_frame = ttk.Frame(parent)
        file_frame.pack(fill=tk.X, padx=4, pady=(4, 2))
        ttk.Label(file_frame, text="📁 Loaded File:", font=("Segoe UI", 9, "bold")).pack(anchor="w")
        file_lbl = ttk.Label(file_frame, textvariable=self._file_var,
                             foreground="#0066CC", font=("Courier", 9),
                             wraplength=330, justify="left")
        file_lbl.pack(anchor="w", fill=tk.X)

        act = ttk.LabelFrame(parent, text="🚀 Actions", padding=6)
        act.pack(fill=tk.X, padx=4, pady=4)

        row1 = ttk.Frame(act)
        row1.pack(fill=tk.X, pady=2)
        ttk.Button(row1, text="⚙️ Generate", width=14,
                   command=self._generate_json).pack(side=tk.LEFT, padx=2)
        self._save_btn = ttk.Button(row1, text="💾 Save", width=14,
                                    command=self._save_json, state="disabled")
        self._save_btn.pack(side=tk.LEFT, padx=2)

        row2 = ttk.Frame(act)
        row2.pack(fill=tk.X, pady=2)
        ttk.Button(row2, text="📂 Load JSON", width=14,
                   command=self._load_json).pack(side=tk.LEFT, padx=2)
        ttk.Button(row2, text="📤 Send to Gateway", width=18,
                   command=self._send_json).pack(side=tk.LEFT, padx=2)

    # ──────────────────────────────────────────────────────────────
    # Data helpers
    # ──────────────────────────────────────────────────────────────
    def _get_comm_data(self) -> dict:
        pt = self._port_type_var.get()
        params: dict = {}
        if pt in ("uart", "usb"):
            params["baudrate"] = int(self._baud_var.get())
            if pt == "uart":
                params["parity"] = self._parity_var.get()
                params["stopbit"] = int(self._stop_var.get())
        elif pt == "spi":
            params["spi_mode"] = int(self._spi_mode_var.get())
            params["clock_hz"] = int(self._spi_clk_var.get())
            params["cs_pin"] = self._spi_cs_var.get()
        elif pt == "i2c":
            addr_str = self._i2c_addr_var.get().strip()
            try:
                params["i2c_addr"] = (int(addr_str, 16) if
                                      addr_str.lower().startswith("0x")
                                      else int(addr_str))
            except ValueError:
                params["i2c_addr"] = 0x60
            params["clock_hz"] = int(self._i2c_clk_var.get())

        return {"port_type": pt, "parameters": params}

    def _set_comm_data(self, comm: dict):
        pt = comm.get("port_type", "uart")
        self._port_type_var.set(pt)
        params = comm.get("parameters", {})
        if pt in ("uart", "usb"):
            self._baud_var.set(str(params.get("baudrate", 115200)))
            if pt == "uart":
                self._parity_var.set(params.get("parity", "none"))
                self._stop_var.set(str(params.get("stopbit", 1)))
        elif pt == "spi":
            self._spi_mode_var.set(str(params.get("spi_mode", 0)))
            self._spi_clk_var.set(str(params.get("clock_hz", 1000000)))
            self._spi_cs_var.set(params.get("cs_pin", "05"))
        elif pt == "i2c":
            addr = params.get("i2c_addr", 0x60)
            self._i2c_addr_var.set(f"0x{addr:02X}" if isinstance(addr, int)
                                   else str(addr))
            self._i2c_clk_var.set(str(params.get("clock_hz", 400000)))
        self._on_port_type_change()

    def build_json(self) -> dict:
        """Build the full JSON config dict from form state."""
        data: dict = {
            "module_id": self._module_id_var.get(),
            "module_type": self._module_type,
            "module_name": self._module_name_var.get(),
            "module_communication": self._get_comm_data(),
            "functions": [fi.get_data() for fi in self._function_items],
        }
        return data

    def _update_preview(self, *_args):
        if self._suppress_preview:
            return
        try:
            data = self.build_json()
            text = json.dumps(data, indent=2, ensure_ascii=False)
        except Exception:
            return
        self._preview_text.delete("1.0", "end")
        self._preview_text.insert("1.0", text)

    def _populate_from_config(self, config: dict):
        """Fill form from a full module config dict."""
        self._suppress_preview = True
        try:
            self._module_id_var.set(config.get("module_id", ""))
            self._module_name_var.set(config.get("module_name", ""))
            self._set_comm_data(config.get("module_communication", {}))
            self._populate_functions(config.get("functions", []))
        finally:
            self._suppress_preview = False
        self._update_preview()

    # ── Public methods for tab header binding ─────────────────────
    def set_stack_slot_var(self, var: tk.StringVar):
        self._stack_slot_var = var

    def set_module_id_var(self, var: tk.StringVar):
        self._module_id_var = var
        var.trace_add("write", self._update_preview)

    def set_module_name_var(self, var: tk.StringVar):
        self._module_name_var = var
        var.trace_add("write", self._update_preview)

    def load_config(self, config: dict):
        """Public entry point to load a new config."""
        self._module_config = config
        self._populate_from_config(config)

    # ── Actions ───────────────────────────────────────────────────
    def _generate_json(self):
        """Save As → create new file → becomes loaded file."""
        module_id = self._module_id_var.get().strip() or "000"
        suggested_name = f"stack_{module_id}_config.json"
        
        path = filedialog.asksaveasfilename(
            title="Generate JSON Config",
            defaultextension=".json",
            initialfile=suggested_name,
            filetypes=[("JSON", "*.json"), ("All", "*.*")])
        if not path:
            return
        try:
            data = self.build_json()
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            self._loaded_file = path
            self._file_var.set(f"File: {path}")
            self._save_btn.configure(state="normal")
            self.log(f"Generated: {os.path.basename(path)}", "INFO")
        except Exception as e:
            messagebox.showerror("Generate Error", f"Failed to generate:\n{str(e)}")

    def _save_json(self):
        """Overwrite the loaded file."""
        if not self._loaded_file:
            messagebox.showwarning("No File",
                                   "Load or Generate a file first.")
            return
        try:
            data = self.build_json()
            with open(self._loaded_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            self.log(f"Saved: {os.path.basename(self._loaded_file)}", "INFO")
        except Exception as e:
            messagebox.showerror("Save Error", f"Failed to save:\n{str(e)}")

    def _load_json(self):
        """Open file → fill form → set as loaded file."""
        path = filedialog.askopenfilename(
            title="Load JSON Config",
            filetypes=[("JSON", "*.json"), ("All", "*.*")])
        if not path:
            return
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data.get("functions"), list):
                messagebox.showerror("Invalid", "'functions' must be a list.")
                return
            self._populate_from_config(data)
            self._loaded_file = path
            self._file_var.set(f"File: {path}")
            self._save_btn.configure(state="normal")
            self.log(f"Loaded: {os.path.basename(path)}", "INFO")
        except json.JSONDecodeError as e:
            messagebox.showerror("Invalid JSON", str(e))
        except Exception as e:
            messagebox.showerror("Load Error", f"Failed to load:\n{str(e)}")

    def _send_json(self):
        """Send JSON to gateway."""
        if not self.serial_manager or not self.serial_manager.is_connected():
            messagebox.showwarning("Not Connected",
                                   "Connect to a gateway first.")
            return
        slot = 0 if self._stack_slot_var.get() == "S1" else 1
        data = self.build_json()
        minified = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
        cmd = f"CFML:{self._cmd_prefix}:JSON:{slot}:{minified}\r\n"
        self.serial_manager.send(cmd)
        self.log(f"→ CFML:{self._cmd_prefix}:JSON:{slot}:... ({len(minified)} bytes)", "DEBUG")

    # ── Response handler ──────────────────────────────────────────
    def handle_response(self, line: str):
        """Called by serial_manager on response."""
        pass  # Status panel removed
