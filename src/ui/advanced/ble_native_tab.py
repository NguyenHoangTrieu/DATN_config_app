"""
BLE Native Tab — GATT Central (CFBG:) + BLE Mesh Provisioner (CFBN:)

Native ESP32 BLE handlers built into the LAN MCU.
  - No slot number (single radio instance)
  - No AT-module stack config
  - No JSON preview — form fields only; JSON is built and sent on click

Commands sent over serial:
  CFML:CFBG:JSON:<json>\r\n
  CFML:CFBN:JSON:<json>\r\n
"""

import json
import tkinter as tk
from tkinter import ttk, messagebox


# ─── Row helper widgets ───────────────────────────────────────────────────────

def _spinrow(parent, label, var, lo, hi):
    r = ttk.Frame(parent)
    r.pack(fill=tk.X, pady=2)
    ttk.Label(r, text=label, width=30, anchor="w").pack(side=tk.LEFT)
    ttk.Spinbox(r, textvariable=var, from_=lo, to=hi, width=9).pack(side=tk.LEFT, padx=4)


def _entryrow(parent, label, var, entry_width=32):
    r = ttk.Frame(parent)
    r.pack(fill=tk.X, pady=2)
    ttk.Label(r, text=label, width=24, anchor="w").pack(side=tk.LEFT)
    ttk.Entry(r, textvariable=var, width=entry_width).pack(side=tk.LEFT, padx=4)


# ─── BLE Native Tab ───────────────────────────────────────────────────────────

class BleNativeTab(ttk.Frame):
    """Native GATT Central + BLE Mesh Provisioner configuration tab."""

    def __init__(self, parent, serial_manager=None, log_callback=None, **kwargs):
        for k in ("stack_idx", "stack_id", "cmd_prefix", "cmd_map"):
            kwargs.pop(k, None)
        super().__init__(parent, **kwargs)

        self.serial_manager = serial_manager
        self.log = log_callback or (lambda m, l="INFO": None)

        self._cmd_rows: list[dict | None] = []
        self._build()

    # ── Top-level layout ───────────────────────────────────────────────────────

    def _build(self):
        nb = ttk.Notebook(self)
        nb.pack(fill=tk.BOTH, expand=True)

        gatt_frame = ttk.Frame(nb)
        mesh_frame = ttk.Frame(nb)
        nb.add(gatt_frame, text="🔷 GATT Central (CFBG:)")
        nb.add(mesh_frame, text="🔶 BLE Mesh (CFBN:) [Chưa hỗ trợ]", state="disabled")

        self._build_gatt(gatt_frame)
        self._build_mesh(mesh_frame)

    # ── GATT Central ──────────────────────────────────────────────────────────

    def _build_gatt(self, parent):
        outer = ttk.Frame(parent, padding=10)
        outer.pack(fill=tk.BOTH, expand=True)

        ttk.Label(
            outer,
            text="Native ESP32 GATT Central — no slot  |  CFML:CFBG:JSON:<json>",
            foreground="#1565C0",
        ).pack(anchor="w", pady=(0, 8))

        # Scan params
        sf = ttk.LabelFrame(outer, text="Scan Parameters", padding=8)
        sf.pack(fill=tk.X, pady=(0, 6))

        self._g_interval = tk.IntVar(value=160)
        self._g_window   = tk.IntVar(value=80)
        self._g_active   = tk.BooleanVar(value=True)

        _spinrow(sf, "Interval  (×0.625 ms)",  self._g_interval, 4, 16384)
        _spinrow(sf, "Window     (×0.625 ms)", self._g_window,   4, 16384)
        rc = ttk.Frame(sf)
        rc.pack(fill=tk.X, pady=2)
        ttk.Checkbutton(rc, text="Active Scan (request scan responses)",
                        variable=self._g_active).pack(side=tk.LEFT)

        # Connection params
        cf = ttk.LabelFrame(outer, text="Connection Parameters", padding=8)
        cf.pack(fill=tk.X, pady=(0, 6))

        self._g_imin    = tk.IntVar(value=16)
        self._g_imax    = tk.IntVar(value=32)
        self._g_latency = tk.IntVar(value=0)
        self._g_timeout = tk.IntVar(value=500)

        _spinrow(cf, "Interval Min  (×1.25 ms)",       self._g_imin,    6,  3200)
        _spinrow(cf, "Interval Max  (×1.25 ms)",       self._g_imax,    6,  3200)
        _spinrow(cf, "Slave Latency",                  self._g_latency, 0,   500)
        _spinrow(cf, "Supervision Timeout  (×10 ms)",  self._g_timeout, 10, 3200)

        # Actions
        bf = ttk.Frame(outer)
        bf.pack(fill=tk.X, pady=10)
        ttk.Button(bf, text="📤  Send GATT Config",
                   command=self._send_gatt).pack(side=tk.LEFT, padx=4)

    def _gatt_payload(self) -> dict:
        return {
            "ble_gatt": {
                "scan": {
                    "interval": self._g_interval.get(),
                    "window":   self._g_window.get(),
                    "active":   bool(self._g_active.get()),
                },
                "connection": {
                    "interval_min":        self._g_imin.get(),
                    "interval_max":        self._g_imax.get(),
                    "latency":             self._g_latency.get(),
                    "supervision_timeout": self._g_timeout.get(),
                },
            }
        }

    def _send_gatt(self):
        if not self._check_connected():
            return
        payload = json.dumps(self._gatt_payload(), separators=(",", ":"))
        cmd = f"CFML:CFBG:JSON:{payload}\r\n"
        self.serial_manager.send(cmd)
        self.log(f"→ CFBG:JSON sent ({len(payload)} bytes)", "DEBUG")
        messagebox.showinfo("Sent", "GATT Central config sent to gateway.")

    # ── BLE Mesh ──────────────────────────────────────────────────────────────

    def _build_mesh(self, parent):
        outer = ttk.Frame(parent, padding=10)
        outer.pack(fill=tk.BOTH, expand=True)

        ttk.Label(
            outer,
            text="Native ESP32 BLE Mesh Provisioner — no slot  |  CFML:CFBN:JSON:<json>",
            foreground="#1B5E20",
        ).pack(anchor="w", pady=(0, 8))

        # Keys & settings
        kf = ttk.LabelFrame(outer, text="Mesh Keys & Settings", padding=8)
        kf.pack(fill=tk.X, pady=(0, 6))

        self._m_prov_name = tk.StringVar(value="DA2_GW")
        self._m_net_key   = tk.StringVar(value="A1B2C3D4E5F6A7B8C9DAEBFCAD1E2F30")
        self._m_app_key   = tk.StringVar(value="0102030405060708090A0B0C0D0E0F10")
        self._m_unicast   = tk.IntVar(value=1)
        self._m_ttl       = tk.IntVar(value=7)

        _entryrow(kf, "Provisioner Name",    self._m_prov_name, 20)
        _entryrow(kf, "Network Key (32 hex)", self._m_net_key,  36)
        _entryrow(kf, "App Key (32 hex)",     self._m_app_key,  36)

        rr = ttk.Frame(kf)
        rr.pack(fill=tk.X, pady=2)
        ttk.Label(rr, text="Primary Unicast Addr", width=24, anchor="w").pack(side=tk.LEFT)
        ttk.Spinbox(rr, textvariable=self._m_unicast, from_=1, to=32767, width=8).pack(side=tk.LEFT, padx=4)
        ttk.Label(rr, text="TTL", anchor="w").pack(side=tk.LEFT, padx=(12, 0))
        ttk.Spinbox(rr, textvariable=self._m_ttl, from_=1, to=127, width=5).pack(side=tk.LEFT, padx=4)

        # Command table
        tf = ttk.LabelFrame(outer, text="Control Commands", padding=8)
        tf.pack(fill=tk.X, pady=(0, 6))

        hdr = ttk.Frame(tf)
        hdr.pack(fill=tk.X, pady=(0, 2))
        for txt, w in [("Name", 14), ("Model ID", 10), ("Opcode", 10), ("Param Schema", 22)]:
            ttk.Label(hdr, text=txt, width=w, anchor="w",
                      font=("TkDefaultFont", 9, "bold")).pack(side=tk.LEFT)

        self._cmd_list_frame = ttk.Frame(tf)
        self._cmd_list_frame.pack(fill=tk.X)

        for d in [
            {"name": "ONOFF",        "model_id": "0x1000", "opcode": "0x8202", "param_schema": "value:uint8"},
            {"name": "LIGHTNESS",    "model_id": "0x1300", "opcode": "0x824C", "param_schema": "lightness:uint16"},
            {"name": "GET_ONOFF",    "model_id": "0x1000", "opcode": "0x8201", "param_schema": ""},
            {"name": "GET_LIGHTNESS","model_id": "0x1300", "opcode": "0x824B", "param_schema": ""},
            {"name": "CTL",          "model_id": "0x1303", "opcode": "0x825E", "param_schema": "lightness:uint16,temperature:uint16,delta_uv:int16"},
            {"name": "SCENE_STORE",  "model_id": "0x1203", "opcode": "0x8044", "param_schema": "scene_num:uint16"},
            {"name": "SCENE_RECALL", "model_id": "0x1203", "opcode": "0x8042", "param_schema": "scene_num:uint16"},
        ]:
            self._add_cmd_row(d)

        ttk.Button(tf, text="+ Add Row",
                   command=self._add_cmd_row).pack(anchor="w", pady=(6, 0))

        # Actions
        bf = ttk.Frame(outer)
        bf.pack(fill=tk.X, pady=10)
        ttk.Button(bf, text="📤  Send Mesh Config",
                   command=self._send_mesh).pack(side=tk.LEFT, padx=4)

    def _add_cmd_row(self, defaults=None):
        d = defaults or {}
        row_vars = {
            "name":         tk.StringVar(value=d.get("name",         "")),
            "model_id":     tk.StringVar(value=d.get("model_id",     "0x1000")),
            "opcode":       tk.StringVar(value=d.get("opcode",       "0x8202")),
            "param_schema": tk.StringVar(value=d.get("param_schema", "")),
        }
        self._cmd_rows.append(row_vars)
        idx = len(self._cmd_rows) - 1

        frame = ttk.Frame(self._cmd_list_frame)
        frame.pack(fill=tk.X, pady=1)

        ttk.Entry(frame, textvariable=row_vars["name"],         width=14).pack(side=tk.LEFT, padx=1)
        ttk.Entry(frame, textvariable=row_vars["model_id"],     width=10).pack(side=tk.LEFT, padx=1)
        ttk.Entry(frame, textvariable=row_vars["opcode"],       width=10).pack(side=tk.LEFT, padx=1)
        ttk.Entry(frame, textvariable=row_vars["param_schema"], width=22).pack(side=tk.LEFT, padx=1)

        def _del(f=frame, i=idx):
            f.destroy()
            if i < len(self._cmd_rows):
                self._cmd_rows[i] = None

        ttk.Button(frame, text="✕", width=3, command=_del).pack(side=tk.LEFT, padx=1)

    def _mesh_payload(self) -> dict:
        commands = [
            {k: v.get().strip() for k, v in row.items()}
            for row in self._cmd_rows
            if row is not None and row["name"].get().strip()
        ]
        return {
            "ble_native": {
                "mesh": {
                    "provisioner_name":     self._m_prov_name.get().strip(),
                    "net_key":              self._m_net_key.get().strip(),
                    "app_key":              self._m_app_key.get().strip(),
                    "primary_unicast_addr": self._m_unicast.get(),
                    "ttl":                  self._m_ttl.get(),
                },
                "commands": commands,
            }
        }

    def _send_mesh(self):
        if not self._check_connected():
            return
        payload = json.dumps(self._mesh_payload(), separators=(",", ":"))
        cmd = f"CFML:CFBN:JSON:{payload}\r\n"
        self.serial_manager.send(cmd)
        self.log(f"→ CFBN:JSON sent ({len(payload)} bytes)", "DEBUG")
        messagebox.showinfo("Sent", "BLE Mesh config sent to gateway.")

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _check_connected(self) -> bool:
        if not self.serial_manager or not self.serial_manager.is_connected():
            messagebox.showwarning("Not Connected", "Connect to a gateway first.")
            return False
        return True
