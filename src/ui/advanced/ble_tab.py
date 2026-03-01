"""
BLE Advanced Configuration Tab — fully generic, JSON-driven.

Layout:
  Left  — Button-function groups  +  Manual-function entries
          +  JSON Config  +  Raw Command
  Right — Response Log  (full height, shows ALL raw UART responses)

The UI has exactly TWO widget types:
  1. Button  → one-click, sends `command` from JSON (AT command sent verbatim)
  2. Entry + Send  → user types param, sends `command_prefix` + param (NO colon)

No module-specific widgets (scan tables, handle spinners, discovery
tables, data-transfer sections) exist here.  Different modules return
responses in different formats — the Response Log shows raw text so
the user sees whatever the module sends, regardless of format.
"""

import tkinter as tk
from tkinter import ttk, messagebox, filedialog
import json
import os

from src.config.paths import _resource_path, load_app_commands, STACK_DEFAULT_JSON

_JSON_REQUIRED_KEYS = {"module_id", "module_type", "functions"}

# Group display metadata — order matters (dict preserves insertion order)
_GROUP_META: dict[str, dict] = {
    "system":     {"emoji": "🔄", "title": "System"},
    "info":       {"emoji": "ℹ️",  "title": "Info & Status"},
    "broadcast":  {"emoji": "📡", "title": "Broadcast"},
    "scan":       {"emoji": "🔍", "title": "Scan"},
    "config":     {"emoji": "⚙️", "title": "Module Configuration"},
    "connection": {"emoji": "🔗", "title": "Connection"},
    "discovery":  {"emoji": "🔎", "title": "Discovery"},
    "data":       {"emoji": "📨", "title": "Data Transfer"},
}


class BLETab(ttk.Frame):
    """Advanced BLE tab — fully JSON-driven, generic UI."""

    def __init__(self, parent, serial_manager=None, log_callback=None,
                 stack_idx: int = 0, stack_id: str = "002",
                 cmd_prefix: str = "CFBL",
                 cmd_map: dict | None = None,
                 **kwargs):
        super().__init__(parent, **kwargs)
        self.serial_manager = serial_manager
        self.log = log_callback or (lambda msg, lvl: None)

        self._stack_idx = stack_idx
        self._stack_id  = stack_id
        self._cmd_prefix = cmd_prefix

        # Load from JSON
        self._app_cmds: dict = load_app_commands(stack_id) or {}
        self._btn_list: list[dict] = []       # flat list of button configs
        self._manual_list: list[dict] = []    # flat list of manual configs
        self._btn_groups: dict[str, list] = {}     # group → [btn_cfg]
        self._manual_groups: dict[str, list] = {}  # group → [mf_cfg]
        self._response_patterns: dict[str, str] = {}
        self._parse_app_commands()

        self._json_path: str = ""
        self._json_content: str = ""

        self._build_ui()

    # ──────────────────────────────────────────────────────────────
    def _parse_app_commands(self):
        """Parse new schema: button has `command`, manual has `command_prefix`."""
        self._btn_list = self._app_cmds.get("button_functions", [])
        self._manual_list = self._app_cmds.get("manual_functions", [])
        self._btn_groups.clear()
        self._manual_groups.clear()
        for btn in self._btn_list:
            grp = btn.get("group", "other")
            self._btn_groups.setdefault(grp, []).append(btn)
        for mf in self._manual_list:
            grp = mf.get("group", "other")
            self._manual_groups.setdefault(grp, []).append(mf)
        self._response_patterns = self._app_cmds.get("response_patterns", {})

    # ──────────────────────────────────────────────────────────────
    # Command builders
    # ──────────────────────────────────────────────────────────────
    def _build_button_cmd(self, btn_cfg: dict) -> str:
        """Button: CFML:{cmd_prefix}:{stack_idx}:{command}"""
        command = btn_cfg["command"]
        return f"CFML:{self._cmd_prefix}:{self._stack_idx}:{command}"

    def _build_manual_cmd(self, mf_cfg: dict, user_input: str) -> str:
        """Manual: CFML:{cmd_prefix}:{stack_idx}:{command_prefix}{user_input}
        NO colon between command_prefix and user_input."""
        prefix = mf_cfg["command_prefix"]
        return f"CFML:{self._cmd_prefix}:{self._stack_idx}:{prefix}{user_input}"

    # ──────────────────────────────────────────────────────────────
    # UI
    # ──────────────────────────────────────────────────────────────
    def _build_ui(self):
        # ── Stack selector bar ────────────────────────────────────
        top = ttk.Frame(self, padding=(8, 4))
        top.pack(fill=tk.X)
        ttk.Label(top, text="Stack:").pack(side=tk.LEFT)
        self._stack_var = tk.StringVar(value=f"Stack {self._stack_idx + 1}")
        self._stack_combo = ttk.Combobox(top, textvariable=self._stack_var,
                                         values=["Stack 1", "Stack 2"],
                                         state="readonly", width=10)
        self._stack_combo.pack(side=tk.LEFT, padx=4)
        self._stack_combo.bind("<<ComboboxSelected>>", self._on_stack_change)

        module_name = self._app_cmds.get("module_name", self._stack_id)
        self._stack_id_lbl = ttk.Label(
            top, text=f"ID: {self._stack_id}  ({module_name})",
            foreground="#1565C0")
        self._stack_id_lbl.pack(side=tk.LEFT, padx=8)

        ttk.Separator(self, orient="horizontal").pack(fill=tk.X, padx=4)

        # ── Two-column PanedWindow ────────────────────────────────
        paned = ttk.PanedWindow(self, orient=tk.HORIZONTAL)
        paned.pack(fill=tk.BOTH, expand=True, padx=4, pady=4)

        left_canvas  = tk.Canvas(paned, highlightthickness=0)
        right_frame  = ttk.Frame(paned)
        paned.add(left_canvas, weight=1)
        paned.add(right_frame, weight=1)

        # ── Scrollable left column ────────────────────────────────
        left_sb = ttk.Scrollbar(left_canvas, orient="vertical",
                                command=left_canvas.yview)
        left_sb.pack(side=tk.RIGHT, fill=tk.Y)
        left_canvas.configure(yscrollcommand=left_sb.set)
        self._left_frame = ttk.Frame(left_canvas)
        _lwin = left_canvas.create_window((0, 0), window=self._left_frame,
                                          anchor="nw")

        def _left_cfg(e):
            left_canvas.configure(scrollregion=left_canvas.bbox("all"))
        def _left_canvas_cfg(e):
            w = e.width - left_sb.winfo_reqwidth()
            left_canvas.itemconfig(_lwin, width=max(w, 1))
        self._left_frame.bind("<Configure>", _left_cfg)
        left_canvas.bind("<Configure>", _left_canvas_cfg)
        left_canvas.bind("<Enter>",
                         lambda e: left_canvas.bind_all(
                             "<MouseWheel>",
                             lambda ev: left_canvas.yview_scroll(
                                 -1 * (ev.delta // 120), "units")))
        left_canvas.bind("<Leave>",
                         lambda e: left_canvas.unbind_all("<MouseWheel>"))

        self._build_left()
        self._build_right(right_frame)

    # ── Left column ───────────────────────────────────────────────
    def _build_left(self):
        lf = self._left_frame
        pad = {"padx": 6, "pady": 4, "fill": tk.X}

        # Iterate groups in display order
        for grp_key, meta in _GROUP_META.items():
            btns = self._btn_groups.get(grp_key, [])
            manuals = self._manual_groups.get(grp_key, [])
            if not btns and not manuals:
                continue

            frame = ttk.LabelFrame(
                lf, text=f"{meta['emoji']} {meta['title']}", padding=6)
            frame.pack(**pad)

            # ── Buttons (one-click, no param) ─────────────────────
            if btns:
                row = ttk.Frame(frame)
                row.pack(fill=tk.X, pady=2)
                for btn_cfg in btns:
                    label = btn_cfg.get("label", btn_cfg["id"])
                    b = btn_cfg  # capture for lambda
                    ttk.Button(row, text=label,
                               command=lambda bc=b: self._send_button(bc)
                               ).pack(side=tk.LEFT, padx=2)

            # ── Manual entries (Entry + Send + example hint) ──────
            for mf in manuals:
                label = mf.get("label", mf["id"])
                hint = mf.get("param_hint", "value")
                example = mf.get("example", "")

                r = ttk.Frame(frame)
                r.pack(fill=tk.X, pady=2)
                ttk.Label(r, text=f"{label}:", width=16).pack(side=tk.LEFT)
                var = tk.StringVar()
                ent = ttk.Entry(r, textvariable=var)
                ent.pack(side=tk.LEFT, padx=4, fill=tk.X, expand=True)
                # Show placeholder hint in grey
                ent.insert(0, hint)
                ent.config(foreground="grey")
                ent.bind("<FocusIn>", lambda e, en=ent, h=hint:
                         self._on_entry_focus_in(en, h))
                ent.bind("<FocusOut>", lambda e, en=ent, v=var, h=hint:
                         self._on_entry_focus_out(en, v, h))
                m = mf  # capture for lambda
                ttk.Button(r, text="Send", width=7,
                           command=lambda mc=m, v=var, h=hint:
                               self._send_manual_entry(mc, v, h)
                           ).pack(side=tk.LEFT, padx=2)

                # Example label (small, grey)
                if example:
                    ttk.Label(frame, text=f"  example: {example}",
                              foreground="#888888",
                              font=("Segoe UI", 8)).pack(anchor="w")

        # ── JSON Config ───────────────────────────────────────────
        jsn = ttk.LabelFrame(lf, text="📤 JSON Config", padding=6)
        jsn.pack(**pad)
        frow = ttk.Frame(jsn); frow.pack(fill=tk.X, pady=2)
        ttk.Label(frow, text="File:", width=5).pack(side=tk.LEFT)
        self._json_file_var = tk.StringVar(value="(not loaded)")
        ttk.Label(frow, textvariable=self._json_file_var,
                  foreground="#555555",
                  font=("Segoe UI", 9)).pack(side=tk.LEFT, padx=4,
                                             fill=tk.X, expand=True)
        brow = ttk.Frame(jsn); brow.pack(fill=tk.X, pady=2)
        ttk.Button(brow, text="📋 Load Default", width=15,
                   command=self._load_default_json).pack(side=tk.LEFT, padx=2)
        ttk.Button(brow, text="📂 Custom JSON", width=16,
                   command=self._load_json).pack(side=tk.LEFT, padx=2)
        self._send_json_btn = ttk.Button(
            brow, text="📤 Send JSON", width=14,
            command=self._send_json, state="disabled")
        self._send_json_btn.pack(side=tk.LEFT, padx=2)
        self._json_status_var = tk.StringVar(value="—")
        ttk.Label(jsn, textvariable=self._json_status_var,
                  foreground="#1565C0",
                  font=("Segoe UI", 9, "italic")).pack(anchor="w", pady=(2, 0))

        # ── Raw Command ───────────────────────────────────────────
        raw = ttk.LabelFrame(lf, text="🖥️ Raw Command", padding=6)
        raw.pack(**pad)
        rr = ttk.Frame(raw); rr.pack(fill=tk.X)
        self._raw_cmd_var = tk.StringVar()
        ttk.Entry(rr, textvariable=self._raw_cmd_var).pack(
            side=tk.LEFT, padx=2, fill=tk.X, expand=True)
        ttk.Button(rr, text="Send", width=8,
                   command=self._send_raw_cmd).pack(side=tk.LEFT, padx=2)

    # ── Right column: Response Log only ───────────────────────────
    def _build_right(self, parent):
        log_frame = ttk.LabelFrame(parent, text="📋 Response Log", padding=6)
        log_frame.pack(fill=tk.BOTH, expand=True, padx=4, pady=4)

        self._log_text = tk.Text(log_frame, font=("Consolas", 9),
                                 state="disabled", bg="#FAFAFA", wrap="word")
        log_sb = ttk.Scrollbar(log_frame, orient="vertical",
                               command=self._log_text.yview)
        self._log_text.configure(yscrollcommand=log_sb.set)
        log_sb.pack(side=tk.RIGHT, fill=tk.Y)
        self._log_text.pack(fill=tk.BOTH, expand=True)
        self._log_text.tag_config("ok",    foreground="#2E7D32")
        self._log_text.tag_config("error", foreground="#C62828")
        self._log_text.tag_config("info",  foreground="#1565C0")
        self._log_text.tag_config("warn",  foreground="#E65100")

        ttk.Button(log_frame, text="🗑 Clear", width=8,
                   command=self._clear_log).pack(anchor="e", pady=(4, 0))

    # ──────────────────────────────────────────────────────────────
    # Helpers
    # ──────────────────────────────────────────────────────────────
    def _on_entry_focus_in(self, entry, hint):
        if entry.get() == hint:
            entry.delete(0, tk.END)
            entry.config(foreground="black")

    def _on_entry_focus_out(self, entry, var, hint):
        if not var.get().strip():
            entry.insert(0, hint)
            entry.config(foreground="grey")

    def _send(self, cmd: str):
        if not self.serial_manager or not self.serial_manager.is_connected():
            messagebox.showwarning("Not Connected",
                                   "Connect to a gateway first.")
            return
        self.log(f"→ {cmd}", "DEBUG")
        self.serial_manager.send(cmd)
        self._append_log(f"→ {cmd}", "info")

    def _send_button(self, btn_cfg: dict):
        """Send a button command (full AT command from JSON)."""
        cmd = self._build_button_cmd(btn_cfg)
        self._send(cmd)

    def _send_manual_entry(self, mf_cfg: dict, var: tk.StringVar, hint: str):
        """Send a manual command (command_prefix + user input, no colon)."""
        val = var.get().strip()
        if not val or val == hint:
            messagebox.showwarning("Input", "Enter a value first.")
            return
        cmd = self._build_manual_cmd(mf_cfg, val)
        self._send(cmd)

    def _append_log(self, text: str, tag: str = ""):
        self._log_text.configure(state="normal")
        self._log_text.insert("end", text + "\n", tag)
        self._log_text.see("end")
        self._log_text.configure(state="disabled")

    def _clear_log(self):
        self._log_text.configure(state="normal")
        self._log_text.delete("1.0", "end")
        self._log_text.configure(state="disabled")

    def _on_stack_change(self, _event=None):
        sel = self._stack_var.get()
        self._stack_idx = 0 if sel == "Stack 1" else 1
        self._stack_id_lbl.config(text=f"Stack idx: {self._stack_idx}")

    # ── JSON actions ──────────────────────────────────────────────
    def _load_default_json(self):
        rel = STACK_DEFAULT_JSON.get(self._stack_id)
        if not rel:
            messagebox.showerror("No Default",
                                 f"No default JSON for stack {self._stack_id}")
            return
        path = _resource_path(rel)
        if not os.path.exists(path):
            messagebox.showerror("Missing",
                                 f"Not found:\n{path}")
            return
        self._do_load_json(path, f"(default {os.path.basename(path)})")

    def _load_json(self):
        path = filedialog.askopenfilename(
            title="Select JSON Config",
            filetypes=[("JSON", "*.json"), ("All", "*.*")])
        if path:
            self._do_load_json(path)

    def _do_load_json(self, path: str, label: str = ""):
        try:
            with open(path, "r", encoding="utf-8") as f:
                raw = f.read()
            data = json.loads(raw)
            missing = _JSON_REQUIRED_KEYS - data.keys()
            if missing:
                messagebox.showerror("Invalid JSON",
                                     f"Missing keys: {missing}")
                return
            if not isinstance(data.get("functions"), list):
                messagebox.showerror("Invalid JSON",
                                     "'functions' must be an array.")
                return
            self._json_path    = path
            self._json_content = json.dumps(data, separators=(",", ":"))
            fname = label or os.path.basename(path)
            self._json_file_var.set(fname)
            n = len(data["functions"])
            self._json_status_var.set(
                f"{n} functions · {len(self._json_content)} bytes")
            self._send_json_btn.config(state="normal")
            self._append_log(f"JSON loaded: {fname} ({n} functions)", "info")
        except json.JSONDecodeError as e:
            messagebox.showerror("JSON Error", f"Invalid JSON: {e}")
        except Exception as e:
            messagebox.showerror("Error", str(e))

    def _send_json(self):
        if not self._json_content:
            messagebox.showwarning("No JSON", "Load a JSON config first.")
            return
        cmd = (f"CFML:{self._cmd_prefix}:JSON:"
               f"{self._stack_idx}:{self._json_content}")
        self._send(cmd)
        self._json_status_var.set("Sent — waiting for gateway response…")

    def _send_raw_cmd(self):
        cmd = self._raw_cmd_var.get().strip()
        if cmd:
            self._send(cmd)
            self._raw_cmd_var.set("")

    # ──────────────────────────────────────────────────────────────
    # Response handler — generic, pattern-based coloring only
    # ──────────────────────────────────────────────────────────────
    def handle_response(self, line: str):
        """Show raw UART line in the Response Log with color-coding.

        Uses ``response_patterns`` from the JSON purely for coloring:
        OK → green, ERROR → red, JSON parse results → green/red.
        Everything else is displayed as-is — no module-specific parsing.
        """
        line = line.strip()
        if not line:
            return

        rp = self._response_patterns

        # JSON parse results (from module_monitor_task)
        if line in (rp.get("json_ok", "PARSE_OK"), "BR:JSON:OK",
                    "CFBL:JSON:OK"):
            self._json_status_var.set("✅ Config loaded by gateway")
            self._append_log(f"← {line}", "ok")
            return
        json_fail = rp.get("json_fail", "PARSE_FAIL")
        if (line.startswith(json_fail) or line.startswith("BR:JSON:FAIL")
                or line.startswith("CFBL:JSON:FAIL")):
            reason = line.split(":", 1)[-1] if ":" in line else line
            self._json_status_var.set(f"❌ Parse failed: {reason}")
            self._append_log(f"← {line}", "error")
            return

        # Command response: "CFBL:<stack>:OK:<payload>" or "CFBL:<stack>:FAIL:<payload>"
        # Firmware encodes multi-line AT responses with \x1E (Record Separator)
        # instead of \r\n so the entire packet stays on one line over USB.
        if line.startswith("CFBL:"):
            parts = line.split(":", 3)  # ["CFBL", stack, status, payload]
            if len(parts) >= 3:
                status = parts[2]
                payload = parts[3] if len(parts) > 3 else ""
                tag = "ok" if status == "OK" else "error"
                # Split on Record Separator (\x1E) for multi-line responses
                for resp_line in payload.split("\x1e"):
                    resp_line = resp_line.strip()
                    if resp_line:
                        self._append_log(f"← {resp_line}", tag)
                return

        # OK / ERROR
        ok_str = rp.get("ok", "OK")
        err_str = rp.get("error", "ERROR")
        if line == ok_str:
            self._append_log(f"← {line}", "ok")
            return
        if line.startswith(err_str):
            self._append_log(f"← {line}", "error")
            return

        # Everything else — raw display
        self._append_log(f"← {line}")

    # ──────────────────────────────────────────────────────────────
    # Stack switching
    # ──────────────────────────────────────────────────────────────
    def set_stack(self, stack_idx: int, stack_id: str,
                  cmd_map: dict | None = None,
                  cmd_prefix: str | None = None):
        self._stack_idx = stack_idx
        self._stack_id  = stack_id
        if cmd_prefix is not None:
            self._cmd_prefix = cmd_prefix
        self._app_cmds = load_app_commands(stack_id) or {}
        self._btn_groups.clear()
        self._manual_groups.clear()
        self._parse_app_commands()
        module_name = self._app_cmds.get("module_name", stack_id)
        self._stack_var.set(f"Stack {stack_idx + 1}")
        self._stack_id_lbl.config(
            text=f"ID: {stack_id}  ({module_name})")
