"""
Firmware Update Tab for ESP32 Gateway Configuration Tool
"""

import tkinter as tk
from tkinter import ttk, messagebox
import subprocess
import threading
from pathlib import Path
from typing import Callable, Optional, List, Tuple


class FirmwareTab(ttk.Frame):
    """Firmware update tab"""
    
    def __init__(self, parent, log_callback: Optional[Callable] = None,
                 serial_manager=None, **kwargs):
        super().__init__(parent, **kwargs)
        
        self.log_callback = log_callback
        self.serial_manager = serial_manager
        self.flashing = False
        self._create_widgets()
    
    def _create_widgets(self):
        """Create firmware tab widgets"""
        # Container for firmware update options
        container = ttk.Frame(self, padding=10)
        container.pack(fill=tk.BOTH, expand=True)
        
        # ── OTA over WiFi ─────────────────────────────────────────────────────
        ota_section = ttk.LabelFrame(container, text="LAN MCU OTA Update (via WiFi AP)", padding=8)
        ota_section.pack(fill=tk.X, pady=5)

        ttk.Label(ota_section,
                  text="Configure the firmware download URL and trigger a wireless OTA update.\n"
                       "The WAN MCU will create a Wi-Fi AP (DA2-FOTA) and forward the URL to the LAN MCU.",
                  font=("Segoe UI", 9)).pack(anchor="w", pady=(0, 6))

        url_frame = ttk.Frame(ota_section)
        url_frame.pack(fill=tk.X, pady=2)
        ttk.Label(url_frame, text="Firmware URL:", width=14).pack(side=tk.LEFT)
        self.url_var = tk.StringVar(value=(
            "http://192.168.1.100:8080/api/v1/TOKEN/firmware"
            "?title=DA2_esp_LAN&version=1.1.2"
        ))
        url_entry = ttk.Entry(url_frame, textvariable=self.url_var, width=60)
        url_entry.pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)

        ttk.Label(ota_section,
                  text="Format: http://<host>:<port>/api/v1/<token>/firmware"
                       "?title=<title>&version=<ver>",
                  font=("Segoe UI", 8), foreground="#888888").pack(anchor="w")

        ota_btn_frame = ttk.Frame(ota_section)
        ota_btn_frame.pack(fill=tk.X, pady=(8, 2))
        self.ota_btn = ttk.Button(ota_btn_frame, text="� Save LAN URL",
                                   style='Set.TButton',
                                   command=self._on_lan_url_save)
        self.ota_btn.pack(anchor="e", padx=5)

        # ── WAN MCU OTA (direct self-update) ──────────────────────────────────
        wan_section = ttk.LabelFrame(container, text="WAN MCU OTA Update (Self-Update)", padding=8)
        wan_section.pack(fill=tk.X, pady=5)

        ttk.Label(wan_section,
                  text="Configure the WAN MCU firmware URL and trigger a direct self-update.\n"
                       "The WAN MCU will download and flash its own firmware.",
                  font=("Segoe UI", 9)).pack(anchor="w", pady=(0, 6))

        wan_url_frame = ttk.Frame(wan_section)
        wan_url_frame.pack(fill=tk.X, pady=2)
        ttk.Label(wan_url_frame, text="Firmware URL:", width=14).pack(side=tk.LEFT)
        self.wan_url_var = tk.StringVar(value=(
            "http://192.168.1.100:8080/api/v1/TOKEN/firmware"
            "?title=DA2_esp&version=1.1.2"
        ))
        wan_url_entry = ttk.Entry(wan_url_frame, textvariable=self.wan_url_var, width=60)
        wan_url_entry.pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)

        ttk.Label(wan_section,
                  text="Format: http://<host>:<port>/api/v1/<token>/firmware"
                       "?title=<title>&version=<ver>",
                  font=("Segoe UI", 8), foreground="#888888").pack(anchor="w")

        wan_btn_frame = ttk.Frame(wan_section)
        wan_btn_frame.pack(fill=tk.X, pady=(8, 2))
        self.wan_ota_btn = ttk.Button(wan_btn_frame, text="� Save WAN URL",
                                      style='Set.TButton',
                                      command=self._on_wan_url_save)
        self.wan_ota_btn.pack(anchor="e", padx=5)

        ttk.Separator(container, orient="horizontal").pack(fill=tk.X, pady=8)

        # ── Local flash via esptool ───────────────────────────────────────────
        
        # COM Port selection - compact
        port_section = ttk.LabelFrame(container, text="COM Port", padding=8)
        port_section.pack(fill=tk.X, pady=5)
        
        port_frame = ttk.Frame(port_section)
        port_frame.pack(fill=tk.X, pady=2)
        
        ttk.Label(port_frame, text="Port:", width=8).pack(side=tk.LEFT)
        
        self.port_var = tk.StringVar()
        self.port_combo = ttk.Combobox(port_frame, textvariable=self.port_var,
                                        width=12, state="readonly")
        self.port_combo.pack(side=tk.LEFT, padx=5)
        
        self.refresh_btn = ttk.Button(port_frame, text="Refresh", width=8,
                                       command=self._refresh_ports)
        self.refresh_btn.pack(side=tk.LEFT, padx=5)
        
        # Update button
        btn_frame = ttk.Frame(container)
        btn_frame.pack(fill=tk.X, pady=10)
        
        self.update_btn = ttk.Button(btn_frame, text="Update Firmware", style='Set.TButton',
                                      command=self._on_update_click)
        self.update_btn.pack(anchor="e", padx=5)
    
    def _on_lan_url_save(self):
        """Send CFML:CFFU:<url> to save LAN firmware URL to NVS (no OTA trigger)."""
        url = self.url_var.get().strip()
        if not url:
            messagebox.showerror("Error", "Please enter the LAN firmware download URL")
            return
        if not self.serial_manager or not self.serial_manager.is_connected():
            messagebox.showwarning("Not Connected",
                                   "Connect to the gateway via UART first.")
            return
        cmd = f"CFML:CFFU:{url}\r\n"
        try:
            self.serial_manager.send(cmd)
            self._log(f"→ LAN URL saved: CFML:CFFU:{url}", "SUCCESS")
        except Exception as e:
            self._log(f"Send error: {e}", "ERROR")
            messagebox.showerror("Error", str(e))

    def _on_wan_url_save(self):
        """Send CFFU:<url> to save WAN firmware URL to NVS (no OTA trigger)."""
        url = self.wan_url_var.get().strip()
        if not url:
            messagebox.showerror("Error", "Please enter the WAN MCU firmware download URL")
            return
        if not self.serial_manager or not self.serial_manager.is_connected():
            messagebox.showwarning("Not Connected",
                                   "Connect to the gateway via UART first.")
            return
        cmd = f"CFFU:{url}\r\n"
        try:
            self.serial_manager.send(cmd)
            self._log(f"→ WAN URL saved: CFFU:{url}", "SUCCESS")
        except Exception as e:
            self._log(f"Send error: {e}", "ERROR")
            messagebox.showerror("Error", str(e))

    def _refresh_ports(self):
        """Refresh port list"""
        import serial.tools.list_ports
        ports = []
        for port in serial.tools.list_ports.comports():
            ports.append(f"{port.device} - {port.description}")
        
        self.port_combo['values'] = ports
        if ports:
            self.port_combo.current(0)
    
    def refresh_ports(self, ports: List[Tuple[str, str]]):
        """Refresh port list from external source - show only COM name"""
        port_list = [p[0] for p in ports]
        self.port_combo['values'] = port_list
        if port_list:
            self.port_combo.current(0)
    
    def _on_update_click(self):
        """Handle update button click"""
        if self.flashing:
            return
        
        port = self.port_var.get()
        if not port:
            messagebox.showerror("Error", "Please select a COM port")
            return
        
        # Confirm
        result = messagebox.askyesno("Confirm", 
            f"Update firmware on {port}?\n\n"
            "This will flash both WAN and LAN MCU.")
        
        if result:
            self._run_flash(port)
    
    def _run_flash(self, port: str):
        """Run flash process"""
        # Extract COM port name only (e.g., "COM47" from "COM47 - USB-Enhanced-SERIAL CH343 (COM47)")
        com_port = port.split(" - ")[0].strip() if " - " in port else port.strip()
        
        # Choose script by platform
        import sys
        is_windows = sys.platform.startswith("win")
        script_name = "flash_WAN.bat" if is_windows else "flash_WAN.sh"

        # Resolve script directory:
        #   Frozen (PyInstaller exe): exe is in dist/, bin/ folder sits next to it.
        #   Source: firmware_tab.py is 4 levels under DATN_config_app/; bin files are in dist/bin/.
        if getattr(sys, "frozen", False):
            script_dir = Path(sys.executable).parent / "bin"
        else:
            script_dir = Path(__file__).resolve().parent.parent.parent.parent / "dist" / "bin"

        flash_script = script_dir / script_name

        if not flash_script.exists():
            self._log(f"{script_name} not found at {flash_script}", "ERROR")
            messagebox.showerror("Error", f"{script_name} not found!\n\nExpected at:\n{flash_script}")
            return

        self.flashing = True
        self.update_btn.config(state=tk.DISABLED)
        self._log("=" * 60, "DEBUG")
        self._log(f"Starting firmware update: BOTH WAN and LAN", "INFO")

        if is_windows:
            cmd = f'"{flash_script}" {com_port}'
            shell = True
            display_cmd = cmd
        else:
            cmd = ["bash", str(flash_script), com_port]
            shell = False
            display_cmd = " ".join(cmd)

        self._log(f"Command: {display_cmd}", "DEBUG")

        # Run in thread
        thread = threading.Thread(target=self._flash_thread, args=(cmd, shell, script_dir))
        thread.daemon = True
        thread.start()
    
    def _flash_thread(self, cmd, shell: bool, cwd: Path):
        """Flash thread"""
        try:
            process = subprocess.Popen(
                cmd,
                shell=shell,
                cwd=str(cwd),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding='utf-8',
                errors='ignore',
                bufsize=1
            )
            
            # Read output realtime
            for line in iter(process.stdout.readline, ''):
                if line:
                    line = line.rstrip()
                    if 'ERROR' in line.upper() or 'FAILED' in line.upper():
                        self._log(line, 'ERROR')
                    elif 'SUCCESS' in line.upper() or ' OK' in line:
                        self._log(line, 'SUCCESS')
                    else:
                        self._log(line, 'DEBUG')
            
            return_code = process.wait()
            
            if return_code == 0:
                self._log("Firmware update completed!", 'SUCCESS')
                self.after(0, lambda: messagebox.showinfo("Success", 
                    "Firmware updated for both WAN and LAN!"))
            else:
                self._log(f"Flash failed (code {return_code})", 'ERROR')
                self.after(0, lambda: messagebox.showerror("Error", 
                    "Firmware update failed!"))
            
        except Exception as e:
            self._log(f"Flash error: {e}", 'ERROR')
            self.after(0, lambda: messagebox.showerror("Error", str(e)))
        
        finally:
            self.flashing = False
            self.after(0, lambda: self.update_btn.config(state=tk.NORMAL))
            self._log("=" * 60, "DEBUG")
    
    def _log(self, message: str, level: str = "INFO"):
        """Log message - sends to external console only (Flash Log panel removed)"""
        # Call external log callback for main console display
        if self.log_callback:
            self.log_callback(message, level)
