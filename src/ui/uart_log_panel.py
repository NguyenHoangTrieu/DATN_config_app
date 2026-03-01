"""
UART Log Panel Widget for ESP32 Gateway Configuration Tool
Displays raw serial data from the connected COM port
"""

import tkinter as tk
from tkinter import ttk
from typing import Optional


class UartLogPanel(ttk.Frame):
    """UART Log panel widget - displays raw serial data"""

    def __init__(self, parent, **kwargs):
        super().__init__(parent, **kwargs)
        self.port_name = "Not Connected"
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
