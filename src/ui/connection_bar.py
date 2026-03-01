"""
Connection Bar Widget for ESP32 Gateway Configuration Tool
"""

import tkinter as tk
from tkinter import ttk, messagebox
import threading
from typing import Callable, Optional, List, Tuple


class ConnectionBar(ttk.Frame):
    """Connection bar widget for serial port selection and connection"""
    
    def __init__(self, parent, on_connect: Callable, on_disconnect: Callable,
                 on_refresh: Callable, serial_manager=None,
                 on_scan_complete: Optional[Callable] = None, **kwargs):
        super().__init__(parent, **kwargs)
        
        self.on_connect = on_connect
        self.on_disconnect = on_disconnect
        self.on_refresh = on_refresh
        self.serial_manager = serial_manager
        self.on_scan_complete = on_scan_complete
        self.is_connected = False
        self._scan_thread: Optional[threading.Thread] = None
        
        self._create_widgets()
    
    def _create_widgets(self):
        """Create connection bar widgets"""
        # Port selection
        ttk.Label(self, text="Port:").pack(side=tk.LEFT, padx=(10, 5))
        
        self.port_var = tk.StringVar()
        self.port_combo = ttk.Combobox(self, textvariable=self.port_var, 
                                        width=15, state="readonly")
        self.port_combo.pack(side=tk.LEFT, padx=5)
        
        # Refresh button
        self.refresh_btn = ttk.Button(self, text="Refresh", width=7,
                                       command=self._on_refresh)
        self.refresh_btn.pack(side=tk.LEFT, padx=2)

        # Scan button — only active when serial_manager is available
        self.scan_btn = ttk.Button(self, text="🔍 Scan", width=9,
                                    command=self._on_scan_click)
        self.scan_btn.pack(side=tk.LEFT, padx=(2, 0))
        if self.serial_manager is None:
            self.scan_btn.config(state="disabled")

        # Scan progress label (hidden until a scan is running)
        self.scan_status_var = tk.StringVar(value="")
        self.scan_status_label = ttk.Label(self, textvariable=self.scan_status_var,
                                            foreground="#1565C0", width=18)
        self.scan_status_label.pack(side=tk.LEFT, padx=(4, 0))

        # Baud rate selection
        ttk.Label(self, text="Baud:").pack(side=tk.LEFT, padx=(20, 5))
        
        self.baud_var = tk.StringVar(value="115200")
        self.baud_combo = ttk.Combobox(self, textvariable=self.baud_var,
                                        width=10, state="readonly",
                                        values=["9600", "19200", "38400", 
                                               "57600", "115200", "230400"])
        self.baud_combo.pack(side=tk.LEFT, padx=5)
        
        # Connect button
        self.connect_btn = ttk.Button(self, text="🔌 Connect", width=18,
                                       command=self._on_connect_click)
        self.connect_btn.pack(side=tk.LEFT, padx=(20, 10))
        
        # Status indicator
        self.status_frame = ttk.Frame(self)
        self.status_frame.pack(side=tk.RIGHT, padx=10)
        
        self.status_indicator = tk.Canvas(self.status_frame, width=12, height=12,
                                          highlightthickness=0)
        self.status_indicator.pack(side=tk.LEFT, padx=(0, 5))
        self._draw_status_indicator(False)
        
        self.status_label = ttk.Label(self.status_frame, text="Disconnected")
        self.status_label.pack(side=tk.LEFT)
    
    def _draw_status_indicator(self, connected: bool):
        """Draw status indicator circle"""
        self.status_indicator.delete("all")
        color = "#4CAF50" if connected else "#F44336"
        self.status_indicator.create_oval(2, 2, 10, 10, fill=color, outline=color)
    
    def _on_refresh(self):
        """Handle refresh button click — shows ALL available ports (unfiltered)."""
        ports = self.on_refresh()
        self.port_combo['values'] = [p[0] for p in ports]
        if ports:
            self.port_combo.current(0)

    # ──────────────────────────────────────────────────────────────────────
    # Scan logic
    # ──────────────────────────────────────────────────────────────────────

    def _on_scan_click(self):
        """Start a gateway scan in a background thread."""
        if self.serial_manager is None:
            return
        if self._scan_thread and self._scan_thread.is_alive():
            return   # already scanning

        baudrate = int(self.baud_var.get())
        self._set_scan_ui_busy(True)
        self.scan_status_var.set("Scanning...")

        def _run():
            try:
                gateways = self.serial_manager.scan_for_gateways(
                    baudrate=baudrate,
                    progress_callback=self._on_scan_progress
                )
            except Exception:
                gateways = []
            self.after(0, lambda: self._on_scan_done(gateways))

        self._scan_thread = threading.Thread(target=_run, daemon=True)
        self._scan_thread.start()

    def _on_scan_progress(self, completed: int, total: int, port_name: str):
        """Called from scan worker thread — schedule UI update on main thread."""
        self.after(0, lambda: self.scan_status_var.set(
            f"Scanning {completed}/{total}…"))

    def _on_scan_done(self, gateways: List[Tuple[str, str]]):
        """Called back on the main thread when scan completes."""
        self._set_scan_ui_busy(False)
        self.scan_status_var.set("")

        if not gateways:
            # Update status label, then show a non-blocking warning
            self.scan_status_var.set("No gateway found")
            self.after(3000, lambda: self.scan_status_var.set(""))
            messagebox.showwarning(
                "Scan Complete",
                "No gateway found.\n\n"
                "Make sure the gateway is powered and the USB driver is installed.\n"
                "You can use Refresh to select a port manually."
            )
            return

        # Populate combo with confirmed gateway ports only
        port_names = [g[0] for g in gateways]
        self.port_combo['values'] = port_names
        self.port_combo.current(0)

        # Show result in the inline status label — no popup on success
        label = (f"Found: {port_names[0]}"
                 if len(gateways) == 1
                 else f"Found {len(gateways)} gateways")
        self.scan_status_var.set(label)
        self.after(5000, lambda: self.scan_status_var.set(""))

        if self.on_scan_complete:
            self.on_scan_complete(gateways)

    def _set_scan_ui_busy(self, busy: bool):
        """Disable/enable interactive widgets while scan runs."""
        state = "disabled" if busy else "normal"
        self.scan_btn.config(state=state)
        self.refresh_btn.config(state=state)
        self.connect_btn.config(state=state)
        self.port_combo.config(state="disabled" if busy else "readonly")
        self.baud_combo.config(state="disabled" if busy else "readonly")
    
    def _on_connect_click(self):
        """Handle connect/disconnect button click"""
        if self.is_connected:
            self.on_disconnect()
        else:
            port = self.port_var.get()
            if port:
                baudrate = int(self.baud_var.get())
                self.on_connect(port, baudrate)
    
    def set_connected(self, connected: bool, port: str = ""):
        """Update connection status"""
        self.is_connected = connected
        self._draw_status_indicator(connected)
        
        if connected:
            self.connect_btn.config(text="⏏️ Disconnect")
            self.status_label.config(text=f"Connected to {port}")
            self.port_combo.config(state="disabled")
            self.baud_combo.config(state="disabled")
        else:
            self.connect_btn.config(text="🔌 Connect")
            self.status_label.config(text="Disconnected")
            self.port_combo.config(state="readonly")
            self.baud_combo.config(state="readonly")
    
    def get_selected_port(self) -> Optional[str]:
        """Get selected port name"""
        return self.port_var.get() or None
