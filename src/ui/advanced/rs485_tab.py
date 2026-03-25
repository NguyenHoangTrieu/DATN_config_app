"""
RS485 Configuration Tab — v5.0 JSON Config Builder

Handles:
  - Baud rate configuration  : CFML:CFRS:BR:<baud>
  - GPIO mode config JSON     : CFML:CFRS:JSON:<stack_idx>:<json>

Works like BLE/LoRa/Zigbee tabs:
  - Preset selector loads default config from stack_007_config.json
  - Stack Slot (S1/S2) determines the physical RS485 port index
  - JSON builder lets users customise DE/RE GPIO toggling per mode
"""

import json
import tkinter as tk
from tkinter import ttk, messagebox, filedialog
import os

from src.config.paths import load_module_config, get_presets_for_type, get_pin_options
from src.config.protocol import Rs485Config

_MODULE_TYPE = "RS485"
_CMD_PREFIX  = "CFRS"


class _GpioPinRow(ttk.Frame):
    """Single GPIO pin action row: [Pin ▼] [State ▼] [X]"""

    def __init__(self, parent, pin: str = "03", state: str = "HIGH",
                 on_change=None, on_remove=None, **kwargs):
        super().__init__(parent, **kwargs)
        self._on_change = on_change
        self.pin_var   = tk.StringVar(value=pin)
        self.state_var = tk.StringVar(value=state)

        pin_cb = ttk.Combobox(self, textvariable=self.pin_var,
                              values=get_pin_options(), state="readonly", width=5)
        pin_cb.pack(side=tk.LEFT, padx=2)
        pin_cb.bind("<<ComboboxSelected>>", lambda e: self._changed())

        state_cb = ttk.Combobox(self, textvariable=self.state_var,
                                values=["HIGH", "LOW"], state="readonly", width=6)
        state_cb.pack(side=tk.LEFT, padx=2)
        state_cb.bind("<<ComboboxSelected>>", lambda e: self._changed())

        ttk.Button(self, text="✕", width=2,
                   command=on_remove).pack(side=tk.LEFT, padx=2)

    def _changed(self):
        if self._on_change:
            self._on_change()

    def get_data(self) -> dict:
        return {"pin": self.pin_var.get(), "state": self.state_var.get()}


class _GpioPinList(ttk.Frame):
    """Editable list of GPIO pin actions."""

    def __init__(self, parent, label: str, initial: list[dict] | None = None,
                 on_change=None, **kwargs):
        super().__init__(parent, **kwargs)
        self._on_change = on_change
        self._rows: list[_GpioPinRow] = []

        ttk.Label(self, text=f"{label}:").pack(anchor="w")
        self._rows_frame = ttk.Frame(self)
        self._rows_frame.pack(fill=tk.X)
        ttk.Button(self, text="+ Add GPIO", width=12,
                   command=self._add_row).pack(anchor="w", pady=(2, 0))

        for gpio in (initial or []):
            self._add_row(gpio.get("pin", "04"), gpio.get("state", "HIGH"))

    def _add_row(self, pin: str = "03", state: str = "HIGH"):
        row = _GpioPinRow(self._rows_frame, pin=pin, state=state,
                          on_change=self._on_change,
                          on_remove=None)
        row.children[list(row.children.keys())[-1]].configure(
            command=lambda r=row: self._remove_row(r))
        row.pack(fill=tk.X, pady=1)
        self._rows.append(row)
        if self._on_change:
            self._on_change()

    def _remove_row(self, row: _GpioPinRow):
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
            self._add_row(gpio.get("pin", "04"), gpio.get("state", "HIGH"))


class Rs485Tab(ttk.Frame):
    """RS485 advanced configuration tab — GPIO mode JSON builder."""

    def __init__(self, parent, serial_manager=None, log_callback=None, **kwargs):
        kwargs.pop("stack_idx", None)
        kwargs.pop("stack_id", None)
        super().__init__(parent, **kwargs)
        self.serial_manager = serial_manager
        self.log = log_callback or (lambda msg, lvl="INFO": None)

        self._presets = get_presets_for_type(_MODULE_TYPE)
        self._current_stack_id = (self._presets[0]["stack_id"]
                                  if self._presets else "007")
        self._function_data: list[dict] = []
        self._loaded_file: str = ""

        self._build_ui()
        self._on_preset_change()

    # ── UI construction ──────────────────────────────────────────────────────

    def _build_ui(self):
        # ── Header ─────────────────────────────────────────────────────────
        hdr = ttk.Frame(self, padding=(8, 4))
        hdr.pack(fill=tk.X)

        row1 = ttk.Frame(hdr)
        row1.pack(fill=tk.X, pady=2)

        ttk.Label(row1, text="Stack Slot:").pack(side=tk.LEFT)
        self._slot_var = tk.StringVar(value="S1")
        ttk.Combobox(row1, textvariable=self._slot_var,
                     values=["S1", "S2"], state="readonly",
                     width=4).pack(side=tk.LEFT, padx=4)

        ttk.Label(row1, text="Preset:").pack(side=tk.LEFT, padx=(12, 0))
        preset_labels = [p["label"] for p in self._presets] or ["RS485 Module"]
        self._preset_var = tk.StringVar(value=preset_labels[0])
        ttk.Combobox(row1, textvariable=self._preset_var,
                     values=preset_labels, width=24).pack(side=tk.LEFT, padx=4)
        ttk.Button(row1, text="Reload", width=10,
                   command=self._on_preset_change).pack(side=tk.LEFT, padx=8)

        row2 = ttk.Frame(hdr)
        row2.pack(fill=tk.X, pady=2)
        ttk.Label(row2, text="Module ID:").pack(side=tk.LEFT)
        self._module_id_var = tk.StringVar(value=self._current_stack_id)
        ttk.Entry(row2, textvariable=self._module_id_var,
                  width=10).pack(side=tk.LEFT, padx=4)

        ttk.Separator(self, orient="horizontal").pack(fill=tk.X, padx=4)

        # ── Paned layout ────────────────────────────────────────────────────
        paned = ttk.PanedWindow(self, orient=tk.HORIZONTAL)
        paned.pack(fill=tk.BOTH, expand=True)

        # Left: scrollable form
        left_canvas = tk.Canvas(paned, highlightthickness=0)
        left_sb = ttk.Scrollbar(left_canvas, orient="vertical",
                                command=left_canvas.yview)
        left_sb.pack(side=tk.RIGHT, fill=tk.Y)
        left_canvas.configure(yscrollcommand=left_sb.set)
        self._left_frame = ttk.Frame(left_canvas)
        lwin = left_canvas.create_window((0, 0), window=self._left_frame, anchor="nw")

        def _on_lcfg(e):
            left_canvas.configure(scrollregion=left_canvas.bbox("all"))

        def _on_ccfg(e):
            left_canvas.itemconfig(lwin, width=max(e.width - left_sb.winfo_reqwidth(), 1))

        self._left_frame.bind("<Configure>", _on_lcfg)
        left_canvas.bind("<Configure>", _on_ccfg)

        def _bind_whl(e):
            left_canvas.bind_all("<MouseWheel>",
                lambda ev: left_canvas.yview_scroll(-1 * (ev.delta // 120), "units"))

        left_canvas.bind("<Enter>", _bind_whl)
        left_canvas.bind("<Leave>", lambda e: left_canvas.unbind_all("<MouseWheel>"))

        # Right: preview + actions
        right_frame = ttk.Frame(paned)
        paned.add(left_canvas, weight=3)
        paned.add(right_frame, weight=2)

        self._build_baud_section(self._left_frame)
        self._build_gpio_section(self._left_frame)
        self._build_actions(right_frame)
        self._build_preview(right_frame)

    def _build_baud_section(self, parent):
        sect = ttk.LabelFrame(parent, text="⚡ Baud Rate", padding=6)
        sect.pack(fill=tk.X, padx=6, pady=4)

        fr = ttk.Frame(sect)
        fr.pack(anchor="w", pady=2)
        ttk.Label(fr, text="Baud Rate:", width=10).pack(side=tk.LEFT)
        self._baud_var = tk.StringVar(value="115200")
        ttk.Combobox(fr, textvariable=self._baud_var,
                     values=["9600", "19200", "38400", "57600", "115200"],
                     state="readonly", width=12).pack(side=tk.LEFT, padx=4)
        ttk.Button(sect, text="Set Baud Rate",
                   command=self._set_baud).pack(anchor="e", pady=4)

    def _build_gpio_section(self, parent):
        sect = ttk.LabelFrame(parent, text="🔌 GPIO Mode Functions", padding=6)
        sect.pack(fill=tk.X, padx=6, pady=4)

        ttk.Label(sect,
                  text="Pin format: XY — X=stack port (0/1), Y=pin 1-9.\n"
                       "Default: pin 03=DE (STACK_GPIO_2), pin 02=RE (STACK_GPIO_1)",
                  font=("Segoe UI", 8), foreground="#555555",
                  justify=tk.LEFT).pack(anchor="w", pady=(0, 4))

        self._func_container = sect

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

    def _build_actions(self, parent):
        self._file_var = tk.StringVar(value="File: (none)")
        file_frame = ttk.Frame(parent)
        file_frame.pack(fill=tk.X, padx=4, pady=(4, 2))
        ttk.Label(file_frame, text="📁 Loaded File:",
                  font=("Segoe UI", 9, "bold")).pack(anchor="w")
        ttk.Label(file_frame, textvariable=self._file_var,
                  foreground="#0066CC", font=("Courier", 9),
                  wraplength=330, justify="left").pack(anchor="w", fill=tk.X)

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

    # ── Preset / config loading ──────────────────────────────────────────────

    def _on_preset_change(self, _event=None):
        label = self._preset_var.get().strip()
        for p in self._presets:
            if p["label"] == label:
                self._current_stack_id = p["stack_id"]
                break

        config = load_module_config(self._current_stack_id)
        if config:
            self._module_id_var.set(config.get("module_id", self._current_stack_id))
            self.load_config(config)

    def load_config(self, config: dict):
        """Load a full RS485 config dict into the form."""
        self._rebuild_functions(config.get("functions", []))
        self._update_preview()

    def _rebuild_functions(self, functions: list[dict]):
        """Clear and rebuild the GPIO function widgets."""
        for w in self._func_container.winfo_children():
            if isinstance(w, (ttk.LabelFrame, ttk.Frame)) and w != self._func_container:
                w.destroy()

        # Remove only function frames (not the hint label)
        for w in list(self._func_container.winfo_children()):
            if isinstance(w, ttk.LabelFrame):
                w.destroy()

        self._function_data = []
        self._func_widgets: list[tuple[str, tk.StringVar, _GpioPinList, _GpioPinList]] = []

        for fd in functions:
            name = fd.get("function_name", "FUNCTION")
            self._add_function_widget(fd)

        self._update_preview()

    def _add_function_widget(self, fd: dict):
        name = fd.get("function_name", "FUNCTION")
        frame = ttk.LabelFrame(self._func_container, text=f"⚙️ {name}", padding=4)
        frame.pack(fill=tk.X, pady=3, padx=2)

        # Delay start
        delay_s_var = tk.StringVar(value=str(fd.get("delay_start", 1)))
        df_s = ttk.Frame(frame)
        df_s.pack(fill=tk.X, pady=1)
        ttk.Label(df_s, text="GPIO Start:", width=14).pack(side=tk.LEFT)

        gpio_start = _GpioPinList(frame, "GPIO Start Control",
                                  initial=fd.get("gpio_start_control", []),
                                  on_change=self._update_preview)
        gpio_start.pack(fill=tk.X, pady=2)

        delay_row = ttk.Frame(frame)
        delay_row.pack(fill=tk.X, pady=1)
        ttk.Label(delay_row, text="Delay Start (ms):", width=18).pack(side=tk.LEFT)
        ttk.Spinbox(delay_row, textvariable=delay_s_var,
                    from_=0, to=10000, increment=1, width=8).pack(side=tk.LEFT)
        delay_s_var.trace_add("write", lambda *_: self._update_preview())

        gpio_end = _GpioPinList(frame, "GPIO End Control",
                                initial=fd.get("gpio_end_control", []),
                                on_change=self._update_preview)
        gpio_end.pack(fill=tk.X, pady=2)

        delay_e_var = tk.StringVar(value=str(fd.get("delay_end", 0)))
        delay_row2 = ttk.Frame(frame)
        delay_row2.pack(fill=tk.X, pady=1)
        ttk.Label(delay_row2, text="Delay End (ms):", width=18).pack(side=tk.LEFT)
        ttk.Spinbox(delay_row2, textvariable=delay_e_var,
                    from_=0, to=10000, increment=1, width=8).pack(side=tk.LEFT)
        delay_e_var.trace_add("write", lambda *_: self._update_preview())

        self._func_widgets.append((name, delay_s_var, gpio_start, gpio_end, delay_e_var))

    # ── JSON build / preview ─────────────────────────────────────────────────

    def _build_json(self) -> dict:
        slot = 0 if self._slot_var.get() == "S1" else 1
        functions = []
        for (name, ds_var, gpio_s, gpio_e, de_var) in self._func_widgets:
            functions.append({
                "function_name": name,
                "gpio_start_control": gpio_s.get_data(),
                "delay_start": self._safe_int(ds_var.get()),
                "gpio_end_control": gpio_e.get_data(),
                "delay_end": self._safe_int(de_var.get()),
            })
        return {
            "module_id": self._module_id_var.get(),
            "module_type": _MODULE_TYPE,
            "stack_id": slot,
            "functions": functions,
        }

    def _update_preview(self, *_args):
        try:
            data = self._build_json()
            text = json.dumps(data, indent=2, ensure_ascii=False)
        except Exception:
            return
        self._preview_text.delete("1.0", "end")
        self._preview_text.insert("1.0", text)

    @staticmethod
    def _safe_int(v: str) -> int:
        try:
            return int(v)
        except (ValueError, TypeError):
            return 0

    # ── Connection check ─────────────────────────────────────────────────────

    def _check_connection(self) -> bool:
        if not self.serial_manager or not self.serial_manager.is_connected():
            messagebox.showwarning("Warning", "Not connected to gateway")
            return False
        return True

    # ── Baud rate ────────────────────────────────────────────────────────────

    def _set_baud(self):
        if not self._check_connection():
            return
        baud = self._baud_var.get()
        cmd = f"CFML:CFRS:BR:{baud}\r\n"
        if self.serial_manager.send(cmd):
            self.log(f"✓ RS485 Baud = {baud}", "SUCCESS")
        else:
            self.log("✗ RS485 Baud — send failed", "ERROR")

    # ── JSON actions ─────────────────────────────────────────────────────────

    def _generate_json(self):
        mid = self._module_id_var.get().strip() or "007"
        path = filedialog.asksaveasfilename(
            title="Generate RS485 JSON Config",
            defaultextension=".json",
            initialfile=f"stack_{mid}_config.json",
            filetypes=[("JSON", "*.json"), ("All", "*.*")])
        if not path:
            return
        try:
            data = self._build_json()
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(data, fh, indent=2, ensure_ascii=False)
            self._loaded_file = path
            self._file_var.set(f"File: {path}")
            self._save_btn.configure(state="normal")
            self.log(f"Generated: {os.path.basename(path)}", "INFO")
        except Exception as e:
            messagebox.showerror("Generate Error", str(e))

    def _save_json(self):
        if not self._loaded_file:
            messagebox.showwarning("No File", "Load or Generate a file first.")
            return
        try:
            data = self._build_json()
            with open(self._loaded_file, "w", encoding="utf-8") as fh:
                json.dump(data, fh, indent=2, ensure_ascii=False)
            self.log(f"Saved: {os.path.basename(self._loaded_file)}", "INFO")
        except Exception as e:
            messagebox.showerror("Save Error", str(e))

    def _load_json(self):
        path = filedialog.askopenfilename(
            title="Load RS485 JSON Config",
            filetypes=[("JSON", "*.json"), ("All", "*.*")])
        if not path:
            return
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            if not isinstance(data.get("functions"), list):
                messagebox.showerror("Invalid", "'functions' must be a list.")
                return
            self.load_config(data)
            self._loaded_file = path
            self._file_var.set(f"File: {path}")
            self._save_btn.configure(state="normal")
            self.log(f"Loaded: {os.path.basename(path)}", "INFO")
        except json.JSONDecodeError as e:
            messagebox.showerror("Invalid JSON", str(e))
        except Exception as e:
            messagebox.showerror("Load Error", str(e))

    def _send_json(self):
        if not self._check_connection():
            return
        data = self._build_json()
        stack_idx = data["stack_id"]
        minified = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
        cmd = f"CFML:{_CMD_PREFIX}:JSON:{stack_idx}:{minified}\r\n"
        self.serial_manager.send(cmd)
        self.log(f"→ CFML:{_CMD_PREFIX}:JSON:{stack_idx}:... ({len(minified)} bytes)", "DEBUG")

    # ── Compatibility ────────────────────────────────────────────────────────

    def get_config(self) -> Rs485Config:
        config = Rs485Config()
        try:
            config.baud_rate = int(self._baud_var.get())
        except Exception:
            config.baud_rate = 115200
        return config

    def set_config(self, config: Rs485Config):
        self._baud_var.set(str(config.baud_rate))

    def set_stack(self, stack_idx: int, stack_id: str, **kwargs):
        pass



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
        cmd = f"CFML:CFRS:BR:{baud}\r\n"
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
            cmd = f"CFML:CFRS:JSON:{stack_id}:{js}\r\n"
            self.log(f"→ CFML:CFRS:JSON:{stack_id}:... ({len(js)} bytes)", "DEBUG")
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

