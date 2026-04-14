"""
UART Log Panel Widget for ESP32 Gateway Configuration Tool
Displays raw serial data from the connected COM port
"""

import tkinter as tk
from tkinter import ttk
from typing import Optional, Callable


class UartLogPanel(ttk.Frame):
    """UART Log panel widget - displays raw serial data"""

    # Maximum number of entries kept in command history
    _MAX_HISTORY = 50

    def __init__(self, parent, on_send: Optional[Callable[[str, bool], None]] = None, **kwargs):
        super().__init__(parent, **kwargs)
        self.port_name = "Not Connected"
        # Callback invoked with (command_text, add_crlf) when the user hits Send
        self._on_send = on_send
        # Command history list (newest first when navigating with Up/Down)
        self._history: list[str] = []
        self._history_index: int = -1      # -1 = not browsing history
        self._history_draft: str = ""      # preserves current draft while browsing
        self._create_widgets()

    def _create_widgets(self):
        """Create UART log widgets"""
        header = ttk.Frame(self)
        header.pack(fill=tk.X)

        self.title_label = ttk.Label(header, text="UART Log (Not Connected)",
                                     font=('Segoe UI', 10, 'bold'))
        self.title_label.pack(side=tk.LEFT, padx=5)

        self.clear_btn = ttk.Button(header, text="Clear", width=8, command=self.clear)
        self.clear_btn.pack(side=tk.RIGHT, padx=2)

        self.autoscroll_var = tk.BooleanVar(value=True)
        self.autoscroll_cb = ttk.Checkbutton(header, text="Auto-scroll",
                                             variable=self.autoscroll_var)
        self.autoscroll_cb.pack(side=tk.RIGHT, padx=5)

        text_frame = ttk.Frame(self)
        text_frame.pack(fill=tk.BOTH, expand=True, pady=(2, 0))

        self.scrollbar = ttk.Scrollbar(text_frame)
        self.scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        self.text = tk.Text(text_frame, wrap=tk.WORD,
                            font=("Consolas", 9),
                            yscrollcommand=self.scrollbar.set,
                            state=tk.DISABLED,
                            bg="#FFF5F5", fg="#333333",
                            insertbackground="#000000")
        self.text.pack(fill=tk.BOTH, expand=True)
        self.scrollbar.config(command=self.text.yview)

        self.text.tag_configure('TX',     foreground='#0066CC')
        self.text.tag_configure('RX',     foreground='#006600')
        self.text.tag_configure('MARKER', foreground='#888888')

        # ── Send-command bar ──────────────────────────────────────────────
        self._send_frame = ttk.LabelFrame(self, text="Send Command")
        self._send_frame.pack(fill=tk.X, padx=0, pady=(4, 0))

        send_row = ttk.Frame(self._send_frame)
        send_row.pack(fill=tk.X, padx=4, pady=3)

        # Editable combobox: doubles as history dropdown
        self._cmd_var = tk.StringVar()
        self._cmd_combo = ttk.Combobox(
            send_row,
            textvariable=self._cmd_var,
            font=("Consolas", 9),
            values=[],
        )
        self._cmd_combo.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 4))

        self._send_btn = ttk.Button(
            send_row, text="Send ▶", width=10, command=self._do_send
        )
        self._send_btn.pack(side=tk.LEFT)

        # CRLF option + quick-clear history
        opts_row = ttk.Frame(self._send_frame)
        opts_row.pack(fill=tk.X, padx=4, pady=(0, 3))

        self._crlf_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(opts_row, text="Append \\r\\n", variable=self._crlf_var
                        ).pack(side=tk.LEFT, padx=(0, 8))

        ttk.Button(opts_row, text="Clear history", width=12,
                   command=self._clear_history).pack(side=tk.LEFT)

        ttk.Label(opts_row, text="↑↓ navigate history",
                  foreground="#888888",
                  font=("Segoe UI", 8)).pack(side=tk.RIGHT, padx=4)

        # Key bindings on the combobox entry
        self._cmd_combo.bind("<Return>",    lambda _e: self._do_send())
        self._cmd_combo.bind("<KP_Enter>",  lambda _e: self._do_send())
        self._cmd_combo.bind("<Up>",        self._history_up)
        self._cmd_combo.bind("<Down>",      self._history_down)

    # ── Public API ────────────────────────────────────────────────────────

    def set_send_callback(self, callback: Callable[[str, bool], None]):
        """Set or replace the callback invoked on send."""
        self._on_send = callback

    def set_port(self, port_name: str):
        self.port_name = port_name
        self.title_label.config(text=f"UART Log ({port_name})")

    def set_disconnected(self):
        self.port_name = "Not Connected"
        self.title_label.config(text="UART Log (Not Connected)")

    def log_tx(self, data: str):
        self.text.config(state=tk.NORMAL)
        self.text.insert(tk.END, "-> ", 'MARKER')
        self.text.insert(tk.END, f"{data}\n", 'TX')
        self.text.config(state=tk.DISABLED)
        if self.autoscroll_var.get():
            self.text.see(tk.END)

    def log_rx(self, data: str):
        self.text.config(state=tk.NORMAL)
        for line in data.strip().split('\n'):
            if line.strip():
                self.text.insert(tk.END, f"{line}\n", 'RX')
        self.text.config(state=tk.DISABLED)
        if self.autoscroll_var.get():
            self.text.see(tk.END)

    def log_raw(self, data: str, direction: str = "RX"):
        self.text.config(state=tk.NORMAL)
        tag    = 'TX' if direction == "TX" else 'RX'
        marker = "-> " if direction == "TX" else "<- "
        self.text.insert(tk.END, marker, 'MARKER')
        self.text.insert(tk.END, f"{data}\n", tag)
        self.text.config(state=tk.DISABLED)
        if self.autoscroll_var.get():
            self.text.see(tk.END)

    def clear(self):
        self.text.config(state=tk.NORMAL)
        self.text.delete(1.0, tk.END)
        self.text.config(state=tk.DISABLED)

    # ── Internal helpers ─────────────────────────────────────────────────

    def _do_send(self):
        """Read the entry, call the send callback, update history."""
        add_crlf = self._crlf_var.get()
        # Always strip trailing CRLF from user input — caller decides whether to add it back
        payload = self._cmd_var.get().rstrip("\r\n")

        if not payload:
            return

        if self._on_send:
            self._on_send(payload, add_crlf)

        # Update history (deduplicate, newest first in dropdown)
        if payload in self._history:
            self._history.remove(payload)
        self._history.insert(0, payload)
        if len(self._history) > self._MAX_HISTORY:
            self._history = self._history[: self._MAX_HISTORY]
        self._cmd_combo["values"] = self._history

        # Reset browsing state and clear the entry
        self._history_index = -1
        self._history_draft = ""
        self._cmd_var.set("")

    def _clear_history(self):
        self._history.clear()
        self._cmd_combo["values"] = []
        self._history_index = -1

    def _history_up(self, event):
        """Navigate to older command."""
        if not self._history:
            return "break"
        if self._history_index == -1:
            # Save whatever is currently typed
            self._history_draft = self._cmd_var.get()
        new_idx = self._history_index + 1
        if new_idx < len(self._history):
            self._history_index = new_idx
            self._cmd_var.set(self._history[self._history_index])
            # Move cursor to end
            self._cmd_combo.icursor(tk.END)
        return "break"

    def _history_down(self, event):
        """Navigate back towards newer / draft command."""
        if self._history_index <= 0:
            self._history_index = -1
            self._cmd_var.set(self._history_draft)
        else:
            self._history_index -= 1
            self._cmd_var.set(self._history[self._history_index])
        self._cmd_combo.icursor(tk.END)
        return "break"
