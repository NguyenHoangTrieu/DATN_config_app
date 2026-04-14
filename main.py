"""
ESP32 Gateway Configuration Tool v4.0
Main Application Entry Point
"""

import tkinter as tk
from tkinter import ttk, messagebox, filedialog
import json
from pathlib import Path
from datetime import datetime
import threading

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from src.serial.manager import SerialManager
from src.config.protocol import (
    GatewayConfig, ConfigParser, 
    CFSC_COMMAND, CFSC_RESP_START, CFSC_RESP_END
)
from src.ui.connection_bar import ConnectionBar
from src.ui.uart_log_panel import UartLogPanel
from src.ui.console_panel import ConsolePanel
from src.ui.basic.basic_panel import BasicPanel
from src.ui.advanced.advanced_panel import AdvancedPanel
from src.config.paths import STACK_DEFAULT_JSON, _resource_path


class GatewayConfigApp:
    """Main application class"""
    
    VERSION = "4.0.0"
    WINDOW_TITLE = "🔌 ESP32 Gateway Configuration Tool"
    WINDOW_SIZE = "1300x800"
    
    def __init__(self):
        self.root = tk.Tk()
        self.root.title(self.WINDOW_TITLE)
        self.root.geometry(self.WINDOW_SIZE)
        self.root.minsize(1100, 700)
        
        # Initialize managers
        self.serial_manager = SerialManager(
            on_data_callback=self._on_serial_data,
            on_log_callback=self._log,
            on_tx_callback=self._on_serial_tx
        )
        
        # Current config
        self.current_config: GatewayConfig = GatewayConfig()
        self.raw_response: str = ""
        # Serial receive line buffer — accumulates bytes until \n arrives
        self._rx_line_buffer: str = ""
        self._flush_timer_id = None
        # Tracks stacks for which the "no JSON" dialog has already been shown
        # (reset whenever a fresh config with json_len > 0 is received).
        self._prompted_stacks: set = set()  # elements: (stack_idx, stack_id)
        
        # Current mode (False = basic, True = advanced)
        self.advanced_mode = tk.BooleanVar(value=False)
        
        # Build UI
        self._create_styles()
        self._create_ui()
        
        # Initial port refresh
        self.root.after(100, self._refresh_ports)
    
    def _create_styles(self):
        """Create custom styles"""
        style = ttk.Style()
        
        # Try to use a modern theme
        available_themes = style.theme_names()
        if 'clam' in available_themes:
            style.theme_use('clam')
        
        # Custom button styles
        style.configure('Action.TButton', font=('Segoe UI', 10), padding=5)
        style.configure('Set.TButton', font=('Segoe UI', 10, 'bold'), padding=8)
        
        # Configure colors - match background for all widgets
        bg_color = '#F5F5F5'
        style.configure('TLabelframe', background=bg_color)
        style.configure('TLabelframe.Label', font=('Segoe UI', 10, 'bold'), background=bg_color)
        style.configure('TFrame', background=bg_color)
        style.configure('TLabel', background=bg_color)
        style.configure('TCheckbutton', background=bg_color)
        style.configure('TNotebook', background=bg_color)
        style.configure('TNotebook.Tab', padding=[10, 5])
    
    def _create_ui(self):
        """Create main UI with 3-Panel layout: Config | UART Log + Debug Log below"""
        # Main container
        main_frame = ttk.Frame(self.root)
        main_frame.pack(fill=tk.BOTH, expand=True)
        
        # Connection bar
        self.connection_bar = ConnectionBar(
            main_frame,
            on_connect=self._on_connect,
            on_disconnect=self._on_disconnect,
            on_refresh=self._get_ports,
            serial_manager=self.serial_manager,
            on_scan_complete=self._on_scan_complete,
        )
        self.connection_bar.pack(fill=tk.X, padx=10, pady=5)
        
        # Separator
        ttk.Separator(main_frame, orient='horizontal').pack(fill=tk.X, padx=10)
        
        # Mode selector and action buttons row
        controls_frame = ttk.Frame(main_frame)
        controls_frame.pack(fill=tk.X, padx=10, pady=8)
        
        # Advanced Mode checkbox (left side)
        mode_frame = ttk.Frame(controls_frame)
        mode_frame.pack(side=tk.LEFT)
        
        self.advanced_check = ttk.Checkbutton(
            mode_frame, 
            text="Advanced Mode",
            variable=self.advanced_mode,
            command=self._on_mode_change
        )
        self.advanced_check.pack(side=tk.LEFT, padx=5)

        # Log panel visibility checkboxes (inline, right of Advanced Mode)
        ttk.Separator(mode_frame, orient='vertical').pack(
            side=tk.LEFT, fill=tk.Y, padx=8, pady=2)

        self.show_uart_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(
            mode_frame, text="UART Log",
            variable=self.show_uart_var,
            command=self._on_log_toggle
        ).pack(side=tk.LEFT, padx=4)

        self.show_console_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(
            mode_frame, text="Console Log",
            variable=self.show_console_var,
            command=self._on_log_toggle
        ).pack(side=tk.LEFT, padx=4)
        
        # Action buttons (right side)
        action_frame = ttk.Frame(controls_frame)
        action_frame.pack(side=tk.RIGHT)
        
        ttk.Button(action_frame, text="📖 Read Config",
                  style='Action.TButton',
                  command=self._read_config).pack(side=tk.LEFT, padx=3)
        
        ttk.Button(action_frame, text="💾 Save File",
                  style='Action.TButton',
                  command=self._save_to_file).pack(side=tk.LEFT, padx=3)
        
        ttk.Button(action_frame, text="📂 Load File",
                  style='Action.TButton',
                  command=self._load_from_file).pack(side=tk.LEFT, padx=3)
        
        # Separator
        ttk.Separator(main_frame, orient='horizontal').pack(fill=tk.X, padx=10)
        
        # ═══════════════════════════════════════════════════════════════════
        # 2-Panel Layout: Config (left) | UART Log (right)
        # ═══════════════════════════════════════════════════════════════════
        self.horizontal_paned = ttk.PanedWindow(main_frame, orient=tk.HORIZONTAL)
        self.horizontal_paned.pack(fill=tk.BOTH, expand=True, padx=10, pady=5)
        
        # Left side - Configuration panel container (fixed width)
        self.config_container = ttk.Frame(self.horizontal_paned, width=550)
        self.config_container.pack_propagate(False)
        
        # Right side: stacked UART Log (expands) + Console Log (fixed)
        self.right_frame = ttk.Frame(self.horizontal_paned)

        self.uart_log = UartLogPanel(self.right_frame, on_send=self._on_uart_send)
        self.uart_log.pack(fill=tk.BOTH, expand=True)

        self._log_separator = ttk.Separator(self.right_frame, orient='horizontal')
        self._log_separator.pack(fill=tk.X)

        self.console_log = ConsolePanel(self.right_frame)
        self.console_log.pack(fill=tk.X)
        
        # Add to horizontal paned
        self.horizontal_paned.add(self.config_container, weight=0)
        self.horizontal_paned.add(self.right_frame, weight=1)
        
        # Create config panels
        self.basic_panel = BasicPanel(
            self.config_container, 
            serial_manager=self.serial_manager,
            log_callback=self._log
        )
        self.advanced_panel = AdvancedPanel(
            self.config_container,
            serial_manager=self.serial_manager,
            log_callback=self._log
        )
        
        # Show basic panel by default
        self.basic_panel.pack(fill=tk.BOTH, expand=True)
        
        # Status bar
        status_frame = ttk.Frame(main_frame)
        status_frame.pack(fill=tk.X, padx=10, pady=5)
        
        self.status_label = ttk.Label(status_frame, text="Ready")
        self.status_label.pack(side=tk.LEFT)
        
        version_label = ttk.Label(status_frame, 
                                  text=f"v{self.VERSION} | © 2024",
                                  foreground="#757575")
        version_label.pack(side=tk.RIGHT)
        
        # Welcome log
        self._log("ESP32 Gateway Configuration Tool started", "INFO")
        self._log("Select a COM port and click Connect to begin", "INFO")
    
    def _on_mode_change(self):
        """Handle mode checkbox change"""
        # Hide all panels
        self.basic_panel.pack_forget()
        self.advanced_panel.pack_forget()
        
        # Show selected panel (anchor nw to avoid whitespace)
        if self.advanced_mode.get():
            self.advanced_panel.pack(fill=tk.BOTH, expand=True)
            self._log("Switched to ADVANCED mode", "INFO")
        else:
            self.basic_panel.pack(fill=tk.BOTH, expand=True)
            self._log("Switched to BASIC mode", "INFO")

    def _on_log_toggle(self):
        """Show or hide uart_log / console_log panels based on checkboxes.

        When both are hidden, remove the right_frame from horizontal_paned so
        the config panel fills the full window width.
        When at least one is visible, ensure right_frame is in horizontal_paned.
        """
        show_uart    = self.show_uart_var.get()
        show_console = self.show_console_var.get()

        # UART log
        if show_uart:
            self.uart_log.pack(fill=tk.BOTH, expand=True)
        else:
            self.uart_log.pack_forget()

        # Separator between logs (only when both visible)
        if show_uart and show_console:
            self._log_separator.pack(fill=tk.X)
        else:
            self._log_separator.pack_forget()

        # Console log
        if show_console:
            self.console_log.pack(fill=tk.BOTH, expand=show_uart is False)
        else:
            self.console_log.pack_forget()

        # Add/remove entire right frame from the horizontal PanedWindow
        panes = list(self.horizontal_paned.panes())
        right_name = str(self.right_frame)
        right_present = right_name in panes

        if not show_uart and not show_console:
            if right_present:
                self.horizontal_paned.forget(self.right_frame)
        else:
            if not right_present:
                self.horizontal_paned.add(self.right_frame, weight=1)
    
    def _get_ports(self):
        """Get available serial ports"""
        return self.serial_manager.list_ports()
    
    def _refresh_ports(self):
        """Refresh port list"""
        ports = self._get_ports()
        self.connection_bar._on_refresh()
        self.advanced_panel.refresh_ports(ports)
    
    def _on_connect(self, port: str, baudrate: int):
        """Handle connect request.

        After a successful connection the CFSC command is sent automatically
        (500 ms delay lets the serial link settle) so the UI is populated
        without requiring a manual "Read Config" click.
        """
        if self.serial_manager.connect(port, baudrate):
            self.connection_bar.set_connected(True, port)
            self.uart_log.set_port(port)  # Update UART log header
            self._set_status(f"Connected to {port}")
            self._log("Auto-reading config from gateway…", "INFO")
            # Small delay: gives the UART link time to stabilise before the
            # first command is sent, especially important with native USB CDC.
            self.root.after(500, self._read_config)
    
    def _on_uart_send(self, text: str, add_crlf: bool = True):
        """Send a raw command string over the active serial connection."""
        if not self.serial_manager.is_connected():
            self._log("Cannot send \u2014 not connected", "ERROR")
            return
        success = self.serial_manager.send(text, add_crlf=add_crlf)
        if not success:
            self._log(f"Send failed: {text!r}", "ERROR")

    def _on_disconnect(self):
        """Handle disconnect request"""
        self.serial_manager.disconnect()
        self.connection_bar.set_connected(False)
        self.uart_log.set_disconnected()  # Update UART log header
        self._set_status("Disconnected")
        # Clear guard so a re-connect triggers auto-send again if the
        # gateway still has no JSON config loaded.
        self._prompted_stacks.clear()

    def _on_scan_complete(self, gateways):
        """Called after a manual scan finishes.  The user selects the port and
        connects manually — no auto-connect logic here.
        """
        if len(gateways) == 1:
            port, _desc = gateways[0]
            self._log(f"Gateway found: {port} — select it in the dropdown and click Connect", "INFO")
        elif len(gateways) > 1:
            names = ', '.join(g[0] for g in gateways)
            self._log(f"Found {len(gateways)} gateways: {names} — select one and click Connect", "INFO")
    
    def _on_serial_data(self, data: str):
        """Handle incoming serial data — display in UART Log and route to BLE handlers.

        Serial data can arrive in arbitrary-sized chunks (hardware buffering).
        The firmware terminates each response packet with ``\\n``, so we
        accumulate bytes in ``_rx_line_buffer`` and only process complete
        lines.  A 300 ms safety-flush timer handles the edge case where a
        response has no trailing ``\\n`` (legacy / raw data).
        """
        # Always log raw data to UART panel immediately (for debugging)
        if hasattr(self, 'uart_log'):
            self.uart_log.log_rx(data)

        # Accumulate into line buffer
        self._rx_line_buffer += data

        # Process every complete line (terminated by \n)
        while '\n' in self._rx_line_buffer:
            line, self._rx_line_buffer = self._rx_line_buffer.split('\n', 1)
            self._route_ble_line(line.strip())

        # Safety flush: if residual data sits > 300 ms without \n, flush it
        if self._rx_line_buffer:
            if self._flush_timer_id is not None:
                self.root.after_cancel(self._flush_timer_id)
            self._flush_timer_id = self.root.after(300, self._flush_rx_buffer)
        else:
            # Buffer empty — cancel any pending flush
            if self._flush_timer_id is not None:
                self.root.after_cancel(self._flush_timer_id)
                self._flush_timer_id = None

    def _flush_rx_buffer(self):
        """Flush incomplete line buffer after timeout (safety net)."""
        self._flush_timer_id = None
        if self._rx_line_buffer:
            line = self._rx_line_buffer.strip()
            self._rx_line_buffer = ""
            if line:
                self._route_ble_line(line)

    def _route_ble_line(self, line: str):
        """Route a complete line to the appropriate BLE handler widget.

        Uses split('\\n') is no longer needed — each *line* is already a
        single, complete message thanks to the line-buffering layer above.
        Firmware encodes multi-line AT responses with ``\\x1E`` (Record
        Separator) so the entire CFBL packet stays on one line.
        """
        if not line:
            return
        is_ble_line = (
            line.startswith("CFBL:")
            or line.startswith("+SCAN:")
            or line.startswith("+CONNECTED:")
            or line.startswith("+DISCONNECTED:")
            or line in ("BR:SCAN:DONE", "PARSE_OK", "BR:JSON:OK")
            or line.startswith("PARSE_FAIL")
            or line.startswith("BR:JSON:FAIL")
        )
        if is_ble_line:
            # Advanced panel stack tabs (BLE, Zigbee, …)
            for widget in getattr(self.advanced_panel, '_stack_tabs', {}).values():
                self.root.after(0, lambda w=widget, l=line: w.handle_response(l))
    
    def _on_serial_tx(self, data: str):
        """Handle outgoing serial data - display in UART Log"""
        if hasattr(self, 'uart_log'):
            self.uart_log.log_tx(data)
    
    def _log(self, message: str, level: str = "INFO"):
        """Log to console panel (and stdout as fallback)."""
        from datetime import datetime
        print(f"[{datetime.now().strftime('%H:%M:%S')}][{level}] {message}")
        if hasattr(self, 'console_log'):
            self.root.after(0, lambda m=message, l=level: self.console_log.log(m, l))
    
    def _set_status(self, message: str):
        """Set status bar message"""
        self.status_label.config(text=message)
    
    def _read_config(self):
        """Read config from gateway"""
        if not self.serial_manager.is_connected():
            messagebox.showwarning("Warning", "Not connected to gateway")
            return
        
        self._log("Reading configuration from gateway...", "INFO")
        self._set_status("Reading config...")
        
        # Send CFSC command
        def read_thread():
            response = self.serial_manager.send_command(CFSC_COMMAND, timeout=5.0)
            
            if response:
                self.raw_response = response
                config = ConfigParser.parse_response(response)
                
                if config:
                    self.current_config = config
                    self.root.after(0, self._update_ui_from_config)
                    self.root.after(0, lambda: self._log("Configuration read successfully", "SUCCESS"))
                    self.root.after(0, lambda: self._set_status("Config loaded"))
                else:
                    self.root.after(0, lambda: self._log("Failed to parse config response", "ERROR"))
                    self.root.after(0, lambda: self._set_status("Parse error"))
            else:
                self.root.after(0, lambda: self._log("No response from gateway", "ERROR"))
                self.root.after(0, lambda: self._set_status("Read failed"))
        
        thread = threading.Thread(target=read_thread)
        thread.daemon = True
        thread.start()
    
    def _update_ui_from_config(self):
        """Update UI panels from current config"""
        self.basic_panel.set_config(self.current_config)
        self.advanced_panel.set_config(self.current_config)

        # Auto-send JSON file for stacks that have no JSON config yet.
        # When stack_id != "none" (module present) and json_len == 0 (no config on gateway),
        # automatically load the corresponding default JSON file and send it.
        # Stacks are sent sequentially with a 5-second gap to prevent the WAN
        # MCU's single config-cache slot from being overwritten before the LAN
        # MCU fetches the first config (first send at 400 ms, second at 5400 ms).
        stack_info = self.current_config.lan.stack_info
        send_slot = 0  # tracks how many sends have been scheduled this cycle
        for idx, sid, json_len in [
            (0, stack_info.stack1_id, stack_info.stack1_json_len),
            (1, stack_info.stack2_id, stack_info.stack2_json_len),
        ]:
            key = (idx, sid)
            if json_len > 0:
                # JSON is now present on gateway — clear guard so a future removal is noticed
                self._prompted_stacks.discard(key)
            elif sid not in ("", "none") and key not in self._prompted_stacks:
                # Stack has a real module but no JSON config loaded on gateway.
                # Schedule auto-send: first stack at 400 ms, each subsequent
                # stack 5000 ms later to allow the gateway to process the previous
                # config before receiving the next one.
                delay_ms = 400 + send_slot * 5000
                self._prompted_stacks.add(key)
                self.root.after(
                    delay_ms,
                    lambda i=idx, s=sid: self._auto_send_stack_json(i, s)
                )
                send_slot += 1

    def _auto_send_stack_json(self, stack_idx: int, stack_id: str):
        """Silently load the default JSON for *stack_id* and send it to the
        gateway without any user interaction.  Called in Basic mode only.

        Lookup table (STACK_DEFAULT_JSON) maps stack_id → relative path of
        the JSON file (relative to the project / frozen-app root).
        """
        from src.config.paths import load_stack_id_map

        rel_path = STACK_DEFAULT_JSON.get(stack_id)
        if not rel_path:
            self._log(
                f"[auto-JSON] No default JSON for stack_id={stack_id}", "WARN")
            return

        json_path = _resource_path(rel_path)
        if not os.path.exists(json_path):
            self._log(
                f"[auto-JSON] Default JSON not found: {json_path}", "ERROR")
            return

        try:
            with open(json_path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            json_content = json.dumps(data, separators=(",", ":"))
        except Exception as exc:
            self._log(f"[auto-JSON] Failed to read {json_path}: {exc}", "ERROR")
            return

        # Look up cmd_prefix and module type from stack_id_map
        stack_map = load_stack_id_map()
        entry = stack_map.get("lan_stack_map", {}).get(stack_id, {})
        cmd_prefix   = entry.get("cmd_prefix", "CFML")
        module_type  = entry.get("type", "")

        # All modules use: CFML:<prefix>:JSON:<slot>:<json>
        # Patch stack_id in JSON body to match physical slot before sending
        data["stack_id"] = stack_idx
        json_content = json.dumps(data, separators=(",", ":"))
        cmd = f"CFML:{cmd_prefix}:JSON:{stack_idx}:{json_content}\r\n"

        self._log(
            f"[auto-JSON] Sending default JSON for stack {stack_idx} "
            f"(id={stack_id}, {len(json_content)} bytes)", "INFO")
        self.serial_manager.send(cmd)

    def _prompt_json_upload(self, stack_idx: int, stack_id: str):
        """Notify user that JSON config is missing for the given stack.

        Clicking Yes sends the default JSON immediately (same as basic mode)
        and then navigates to the module tab in Advanced mode so the user
        can review / re-send.
        """
        from src.config.paths import load_stack_id_map
        stack_map  = load_stack_id_map()
        entry      = stack_map.get("lan_stack_map", {}).get(stack_id, {})
        stack_type = entry.get("label", f"stack_id={stack_id}")
        module_type = entry.get("type", "")

        answer = messagebox.askyesno(
            "JSON Config Missing",
            f"Stack {stack_idx + 1} ({stack_type}) has no JSON config loaded on the gateway.\n"
            f"Send the default JSON config now?",
        )
        if answer:
            # Send the default JSON immediately (same path as basic mode)
            self._auto_send_stack_json(stack_idx, stack_id)

            # Also switch to Advanced mode and select the matching module tab
            # so the user can review or re-send.
            self.advanced_mode.set(True)
            self._on_mode_change()

            # Map module type → actual tab attribute on advanced_panel
            _TYPE_TAB = {
                "BLE":    lambda p: p.ble_tab,
                "LORA":   lambda p: p.lora_tab,
                "ZIGBEE": lambda p: p.zigbee_tab,
                "RS485":  lambda p: p.rs485_tab,
            }
            tab_getter = _TYPE_TAB.get(module_type)
            if tab_getter is not None:
                def _select(getter=tab_getter):
                    try:
                        self.advanced_panel.notebook.select(getter(self.advanced_panel))
                    except Exception as e:
                        self._log(f"[prompt_json] notebook.select failed: {e}", "ERROR")
                self.root.after(150, _select)
        else:
            # User dismissed — remove the guard so a manual "Read Config"
            # can re-trigger the prompt if the stack still has no JSON.
            self._prompted_stacks.discard((stack_idx, stack_id))
    
    def _save_to_file(self):
        """Save config to file"""
        filename = filedialog.asksaveasfilename(
            defaultextension=".json",
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")],
            initialfile=f"gateway_config_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        )
        
        if not filename:
            return
        
        # Convert to dict
        config_dict = {
            "wan": {
                "internet_type": self.current_config.wan.internet_type,
                "wifi_ssid": self.current_config.wan.wifi_ssid,
                "lte_apn": self.current_config.wan.lte_apn,
                "mqtt_broker": self.current_config.wan.mqtt_broker,
            },
            "lan": {
                "stack_1_type": self.current_config.lan.stack.stack_1_type,
                "stack_2_type": self.current_config.lan.stack.stack_2_type,
            }
        }
        
        try:
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(config_dict, f, indent=2)
            
            self._log(f"Config saved to {filename}", "SUCCESS")
            messagebox.showinfo("Success", f"Configuration saved to:\n{filename}")
        except Exception as e:
            self._log(f"Save failed: {e}", "ERROR")
            messagebox.showerror("Error", f"Failed to save: {e}")
    
    def _load_from_file(self):
        """Load config from file"""
        filename = filedialog.askopenfilename(
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")]
        )
        
        if not filename:
            return
        
        try:
            with open(filename, 'r', encoding='utf-8') as f:
                config_dict = json.load(f)
            
            # Update current config
            if "wan" in config_dict:
                wan = config_dict["wan"]
                self.current_config.wan.internet_type = wan.get("internet_type", "WIFI")
                self.current_config.wan.wifi_ssid = wan.get("wifi_ssid", "")
                self.current_config.wan.lte_apn = wan.get("lte_apn", "internet")
                self.current_config.wan.mqtt_broker = wan.get("mqtt_broker", "mqtt.thingsboard.cloud")
            
            if "lan" in config_dict:
                lan = config_dict["lan"]
                self.current_config.lan.stack.stack_1_type = lan.get("stack_1_type", "NONE")
                self.current_config.lan.stack.stack_2_type = lan.get("stack_2_type", "NONE")
            
            self._update_ui_from_config()
            self._log(f"Config loaded from {filename}", "SUCCESS")
            messagebox.showinfo("Success", "Configuration loaded successfully")
            
        except Exception as e:
            self._log(f"Load failed: {e}", "ERROR")
            messagebox.showerror("Error", f"Failed to load: {e}")
    
    def run(self):
        """Run the application"""
        self.root.mainloop()
        # Cleanup on exit
        self.serial_manager.disconnect()


def main():
    """Main entry point"""
    app = GatewayConfigApp()
    app.run()


if __name__ == "__main__":
    main()
