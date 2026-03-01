"""
BLE Basic Mode Widget — fully generic, JSON-driven.

Simpler alternative to ``BLETab`` (advanced mode).

Widget types:
  1. Button  → one-click, sends `command` from JSON (AT command sent verbatim)
  2. Entry + Send  → user types param, sends `command_prefix` + param (NO colon)

Basic mode shows a **subset** of the full function list:
  Buttons — SW Reset, Get Info, Get Status, Broadcast, Scan
  Manuals — Connect, Disconnect (only)
  No Raw Command.  No Config / Discovery / Data groups.

All responses go to the small response area with colour-coded text.
"""

import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import json
import os

from src.config.paths import _resource_path, load_app_commands, STACK_DEFAULT_JSON

_JSON_REQUIRED_KEYS = {"module_id", "module_type", "functions"}

# Button IDs shown in basic mode (explicit whitelist for clarity).
# From groups: system (SW_RESET only), info, scan.
_BASIC_BTN_IDS = {"SW_RESET", "GET_INFO", "GET_STATUS",
                  "SCAN", "STOP_SCAN"}

# Manual-function groups shown in basic mode — only connection (Connect + Disconnect).
_BASIC_MANUAL_GROUPS = ("connection",)


class BLEBasicTab(ttk.Frame):
    """Simplified BLE widget for BasicPanel — fully JSON-driven."""

    def __init__(self, parent, stack_idx: int = 0, stack_id: str = "002",
                 serial_manager=None, log_callback=None,
                 cmd_prefix: str = "CFBL",
                 cmd_map: dict | None = None,
                 **kwargs):
        super().__init__(parent, **kwargs)
        self.serial_manager = serial_manager
        self.log = log_callback or (lambda m, l: None)
        self._stack_idx  = stack_idx
        self._stack_id   = stack_id
        self._cmd_prefix = cmd_prefix
        self._json_content = ""

        self._app_cmds: dict = load_app_commands(stack_id) or {}
        self._btn_list: list[dict] = []
        self._manual_list: list[dict] = []
        self._response_patterns: dict[str, str] = {}
        self._parse_app_commands()

        self._build()

    # ──────────────────────────────────────────────────────────────
    def _parse_app_commands(self):
        """Parse new schema and filter for basic mode."""
        # Buttons: only those in the whitelist
        self._btn_list = [
            btn for btn in self._app_cmds.get("button_functions", [])
            if btn["id"] in _BASIC_BTN_IDS
        ]
        # Manuals: only those in allowed groups
        self._manual_list = [
            mf for mf in self._app_cmds.get("manual_functions", [])
            if mf.get("group", "other") in _BASIC_MANUAL_GROUPS
        ]
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
    def _build(self):
        pad = {"padx": 6, "pady": 4, "fill": tk.X}

        # ── Header ────────────────────────────────────────────────
        hdr = ttk.Frame(self)
        hdr.pack(**pad)
        module_name = self._app_cmds.get("module_name",
                                          f"Stack {self._stack_id}")
        ttk.Label(hdr,
                  text=f"🔷 BLE Stack {self._stack_idx + 1}  ({module_name})",
                  font=("Segoe UI", 10, "bold"),
                  foreground="#1565C0").pack(anchor="w")
        ttk.Separator(self, orient="horizontal").pack(fill=tk.X, padx=4)

        # ── JSON Config ───────────────────────────────────────────
        jf = ttk.LabelFrame(self, text="📤 JSON Config", padding=6)
        jf.pack(**pad)
        self._json_status_var = tk.StringVar(value="No JSON loaded")
        ttk.Label(jf, textvariable=self._json_status_var,
                  foreground="#555555",
                  font=("Segoe UI", 9, "italic")).pack(anchor="w")
        br = ttk.Frame(jf); br.pack(fill=tk.X, pady=(4, 0))
        ttk.Button(br, text="📋 Default",
                   command=self._load_default_json).pack(side=tk.LEFT, padx=2)
        ttk.Button(br, text="📂 Custom",
                   command=self._load_json).pack(side=tk.LEFT, padx=2)
        self._send_btn = ttk.Button(br, text="📤 Send",
                                    command=self._send_json, state="disabled")
        self._send_btn.pack(side=tk.LEFT, padx=2)

        # ── Quick Controls (filtered buttons) ─────────────────────
        if self._btn_list:
            qf = ttk.LabelFrame(self, text="⚡ Quick Controls", padding=6)
            qf.pack(**pad)
            row = None
            for i, btn_cfg in enumerate(self._btn_list):
                if i % 4 == 0:
                    row = ttk.Frame(qf)
                    row.pack(fill=tk.X, pady=2)
                label = btn_cfg.get("label", btn_cfg["id"])
                b = btn_cfg  # capture for lambda
                ttk.Button(row, text=label, width=14,
                           command=lambda bc=b: self._send_button(bc)
                           ).pack(side=tk.LEFT, padx=2)

        # ── Connection entries (filtered manuals) ─────────────────
        if self._manual_list:
            mframe = ttk.LabelFrame(self, text="🔗 Connection", padding=6)
            mframe.pack(**pad)
            for mf in self._manual_list:
                label = mf.get("label", mf["id"])
                hint  = mf.get("param_hint", "value")
                example = mf.get("example", "")

                r = ttk.Frame(mframe); r.pack(fill=tk.X, pady=2)
                ttk.Label(r, text=f"{label}:", width=16).pack(side=tk.LEFT)
                var = tk.StringVar()
                ent = ttk.Entry(r, textvariable=var)
                ent.pack(side=tk.LEFT, padx=4, fill=tk.X, expand=True)
                ent.insert(0, hint)
                ent.config(foreground="grey")
                ent.bind("<FocusIn>", lambda e, en=ent, h=hint:
                         self._entry_focus_in(en, h))
                ent.bind("<FocusOut>", lambda e, en=ent, v=var, h=hint:
                         self._entry_focus_out(en, v, h))
                m = mf  # capture for lambda
                ttk.Button(r, text="Send", width=7,
                           command=lambda mc=m, v=var, h=hint:
                               self._send_manual_entry(mc, v, h)
                           ).pack(side=tk.LEFT, padx=2)

                # Example hint (small, grey)
                if example:
                    ttk.Label(mframe, text=f"  example: {example}",
                              foreground="#888888",
                              font=("Segoe UI", 8)).pack(anchor="w")

        # ── Response area ─────────────────────────────────────────
        rf = ttk.LabelFrame(self, text="📋 Response", padding=4)
        rf.pack(fill=tk.BOTH, expand=True, padx=6, pady=4)
        self._resp = tk.Text(rf, font=("Consolas", 9), state="disabled",
                             bg="#FAFAFA", height=8, wrap="word")
        sb = ttk.Scrollbar(rf, orient="vertical", command=self._resp.yview)
        self._resp.configure(yscrollcommand=sb.set)
        sb.pack(side=tk.RIGHT, fill=tk.Y)
        self._resp.pack(fill=tk.BOTH, expand=True)
        self._resp.tag_config("ok",    foreground="#2E7D32")
        self._resp.tag_config("error", foreground="#C62828")
        self._resp.tag_config("info",  foreground="#1565C0")

        ttk.Button(rf, text="🗑 Clear", width=8,
                   command=self._clear_resp).pack(anchor="e", pady=(2, 0))

    # ──────────────────────────────────────────────────────────────
    # Helpers
    # ──────────────────────────────────────────────────────────────
    def _entry_focus_in(self, entry, hint):
        if entry.get() == hint:
            entry.delete(0, tk.END)
            entry.config(foreground="black")

    def _entry_focus_out(self, entry, var, hint):
        if not var.get().strip():
            entry.insert(0, hint)
            entry.config(foreground="grey")

    def _send(self, cmd: str):
        if not self.serial_manager or not self.serial_manager.is_connected():
            messagebox.showwarning("Not Connected",
                                   "Connect to a gateway first.")
            return
        self.serial_manager.send(cmd)
        self.log(f"→ {cmd}", "DEBUG")
        self._append("→ " + cmd, "info")

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

    def _append(self, text: str, tag: str = ""):
        self._resp.configure(state="normal")
        self._resp.insert("end", text + "\n", tag)
        self._resp.see("end")
        self._resp.configure(state="disabled")

    def _clear_resp(self):
        self._resp.configure(state="normal")
        self._resp.delete("1.0", "end")
        self._resp.configure(state="disabled")

    # ──────────────────────────────────────────────────────────────
    # JSON
    # ──────────────────────────────────────────────────────────────
    def _load_default_json(self):
        rel = STACK_DEFAULT_JSON.get(self._stack_id)
        if not rel:
            messagebox.showerror("No Default",
                                 f"No default JSON for stack {self._stack_id}")
            return
        path = _resource_path(rel)
        if not os.path.exists(path):
            messagebox.showerror("Missing", f"Not found:\n{path}")
            return
        self._do_load(path, f"(default {os.path.basename(path)})")

    def _load_json(self):
        path = filedialog.askopenfilename(
            title="Select JSON Config",
            filetypes=[("JSON", "*.json"), ("All", "*.*")])
        if path:
            self._do_load(path)

    def _do_load(self, path: str, label: str = ""):
        try:
            with open(path, "r", encoding="utf-8") as f:
                raw = f.read()
            data = json.loads(raw)
            missing = _JSON_REQUIRED_KEYS - data.keys()
            if missing:
                messagebox.showerror("Invalid JSON",
                                     f"Missing keys: {missing}")
                return
            self._json_content = json.dumps(data, separators=(",", ":"))
            fname = label or os.path.basename(path)
            n = len(data.get("functions", []))
            self._json_status_var.set(
                f"{fname} — {n} functions · {len(self._json_content)} bytes")
            self._send_btn.config(state="normal")
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
        self._json_status_var.set("Sent — awaiting gateway confirmation…")

    # ──────────────────────────────────────────────────────────────
    # Response handler — generic colour-coded display
    # ──────────────────────────────────────────────────────────────
    def handle_response(self, line: str):
        line = line.strip()
        if not line:
            return
        rp = self._response_patterns

        # JSON parse results (from module_monitor_task)
        if line in (rp.get("json_ok", "PARSE_OK"), "BR:JSON:OK",
                    "CFBL:JSON:OK"):
            self._json_status_var.set("✅ Config loaded by gateway")
            self._append(f"← {line}", "ok")
            return
        json_fail = rp.get("json_fail", "PARSE_FAIL")
        if (line.startswith(json_fail) or line.startswith("BR:JSON:FAIL")
                or line.startswith("CFBL:JSON:FAIL")):
            reason = line.split(":", 1)[-1] if ":" in line else line
            self._json_status_var.set(f"❌ Parse failed: {reason}")
            self._append(f"← {line}", "error")
            return

        # Command response: "CFBL:<stack>:OK:<payload>" or "CFBL:<stack>:FAIL:<payload>"
        # Firmware encodes multi-line AT responses with \x1E (Record Separator)
        if line.startswith("CFBL:"):
            parts = line.split(":", 3)  # ["CFBL", stack, status, payload]
            if len(parts) >= 3:
                status = parts[2]
                payload = parts[3] if len(parts) > 3 else ""
                tag = "ok" if status == "OK" else "error"
                for resp_line in payload.split("\x1e"):
                    resp_line = resp_line.strip()
                    if resp_line:
                        self._append(f"← {resp_line}", tag)
                return

        ok_str  = rp.get("ok", "OK")
        err_str = rp.get("error", "ERROR")
        if line == ok_str:
            self._append(f"← {line}", "ok")
        elif line.startswith(err_str):
            self._append(f"← {line}", "error")
        else:
            self._append(f"← {line}")

    # ──────────────────────────────────────────────────────────────
    # Config update
    # ──────────────────────────────────────────────────────────────
    def set_config(self, stack_idx: int, stack_id: str, json_len: int):
        self._stack_idx = stack_idx
        self._stack_id  = stack_id
        if json_len == 0:
            self._json_status_var.set(
                "⚠️ Gateway has no JSON config — please load & send one.")
