"""
Serial Manager for ESP32 Gateway Configuration Tool
Handles serial port communication
"""

import serial
import serial.tools.list_ports
import threading
import queue
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional, Callable, List, Tuple, Dict, Any

# ──────────────────────────────────────────────────────────────────────────────
# Known USB-to-serial adapter VID/PID table.
#
# To add support for a new device family, simply append an entry:
#   {'vid': 0xXXXX, 'pid': 0xYYYY, 'description': 'Short name'}
#
# Set pid=None to match ALL PIDs under that VID (wildcard for a whole family).
# ──────────────────────────────────────────────────────────────────────────────
KNOWN_GATEWAY_ADAPTERS: List[Dict[str, Any]] = [
    # WCH CH340 family — CH340, CH340K, CH340C, CH340T, CH341, etc.
    {'vid': 0x1A86, 'pid': None,   'description': 'CH340/CH340K/CH341 (WCH)'},

    # Silicon Labs CP210x family
    {'vid': 0x10C4, 'pid': 0xEA60, 'description': 'CP2102 (Silicon Labs)'},
    {'vid': 0x10C4, 'pid': 0xEA70, 'description': 'CP2104 (Silicon Labs)'},
    {'vid': 0x10C4, 'pid': 0xEA80, 'description': 'CP2105 (Silicon Labs)'},
    {'vid': 0x10C4, 'pid': 0xEA63, 'description': 'CP2102N (Silicon Labs)'},

    # FTDI FT232 / FT2232 / FT4232
    {'vid': 0x0403, 'pid': None,   'description': 'FT232/FT2232/FT4232 (FTDI)'},

    # Espressif native USB — all PIDs (CDC ACM = 0x1000, JTAG = 0x1001, composite, etc.)
    {'vid': 0x303A, 'pid': None,   'description': 'Espressif USB (ESP32-S2/S3/C3/C6)'},
]

# CFSC probe constants
_CFSC_PROBE_COMMAND = b'CFSC\r\n'
_CFSC_PROBE_MARKER  = 'CFSC_RESP:START'
_CFSC_PROBE_TIMEOUT = 3.0   # seconds


class SerialManager:
    """Manages serial port connection and communication"""
    
    def __init__(self, on_data_callback: Optional[Callable[[str], None]] = None,
                 on_log_callback: Optional[Callable[[str, str], None]] = None,
                 on_tx_callback: Optional[Callable[[str], None]] = None):
        self.serial_port: Optional[serial.Serial] = None
        self.read_thread: Optional[threading.Thread] = None
        self.running = False
        self.on_data_callback = on_data_callback
        self.on_log_callback = on_log_callback
        self.on_tx_callback = on_tx_callback  # Callback for TX data (for UART log)
        self.response_buffer = ""
        self.response_queue = queue.Queue()
        
    def log(self, message: str, level: str = "INFO"):
        """Log a message"""
        if self.on_log_callback:
            self.on_log_callback(message, level)
    
    @staticmethod
    def list_ports() -> List[Tuple[str, str]]:
        """List all available serial ports (unfiltered)."""
        ports = []
        for port in serial.tools.list_ports.comports():
            ports.append((port.device, port.description))
        return ports

    # ──────────────────────────────────────────────────────────────────────
    # Gateway Scan — VID/PID filter → CFSC probe
    # ──────────────────────────────────────────────────────────────────────

    @staticmethod
    def list_gateway_candidate_ports() -> List[Tuple[str, str]]:
        """Return ports whose VID/PID match a known USB-serial adapter.

        Iterates ``KNOWN_GATEWAY_ADAPTERS``; an entry with ``pid=None``
        matches every PID under that VID (whole family wildcard).

        Returns:
            List of ``(device, description)`` tuples — may be empty.
        """
        candidates = []
        for port in serial.tools.list_ports.comports():
            port_vid = getattr(port, 'vid', None)
            port_pid = getattr(port, 'pid', None)
            if port_vid is None:
                continue
            for adapter in KNOWN_GATEWAY_ADAPTERS:
                vid_match = (port_vid == adapter['vid'])
                pid_match = (adapter['pid'] is None) or (port_pid == adapter['pid'])
                if vid_match and pid_match:
                    candidates.append((port.device, port.description))
                    break   # already matched, skip remaining adapters for this port
        return candidates

    @staticmethod
    def probe_gateway_port(port: str, baudrate: int = 115200,
                           timeout: float = _CFSC_PROBE_TIMEOUT) -> bool:
        """Open *port*, send a CFSC probe, and check for a valid CFSC response.

        Uses a temporary isolated serial session.  DTR and RTS are driven LOW
        *before* the port is opened so that boards with an auto-reset circuit
        (ESP32 EN/BOOT capacitor network) are not inadvertently reset.
        """
        s = serial.Serial()
        s.port      = port
        s.baudrate  = baudrate
        s.bytesize  = serial.EIGHTBITS
        s.parity    = serial.PARITY_NONE
        s.stopbits  = serial.STOPBITS_ONE
        s.rtscts    = False
        s.dsrdtr    = False
        s.timeout   = 0.1
        # Pre-set line levels so the OS applies them atomically on open().
        # This prevents the brief DTR/RTS pulse that triggers auto-reset.
        s.dtr = False
        s.rts = False
        try:
            s.open()
            try:
                time.sleep(0.15)          # let port settle (important for native USB)
                s.reset_input_buffer()
                s.write(_CFSC_PROBE_COMMAND)

                deadline = time.time() + timeout
                buf = b''
                while time.time() < deadline:
                    chunk = s.read(256)
                    if chunk:
                        buf += chunk
                        if _CFSC_PROBE_MARKER.encode() in buf:
                            return True
                    else:
                        time.sleep(0.05)
            finally:
                s.close()
        except (serial.SerialException, OSError):
            pass
        return False

    def scan_for_gateways(self, baudrate: int = 115200,
                          progress_callback: Optional[Callable[[int, int, str], None]] = None
                          ) -> List[Tuple[str, str]]:
        """Scan descriptor-filtered candidate COM ports and return gateways.

        Flow:
        1) Filter by known USB-serial adapter descriptor (VID/PID table)
        2) Probe only filtered ports with CFSC command
        """
        candidates = self.list_gateway_candidate_ports()
        total = len(candidates)
        if total == 0:
            return []

        confirmed: List[Tuple[str, str]] = []
        lock = threading.Lock()
        completed_count = [0]

        def _probe(device_desc: Tuple[str, str]) -> Tuple[str, str, bool]:
            device, desc = device_desc
            result = self.probe_gateway_port(device, baudrate)
            with lock:
                completed_count[0] += 1
                if progress_callback:
                    progress_callback(completed_count[0], total, device)
            return device, desc, result

        max_workers = min(total, 4)
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(_probe, c): c for c in candidates}
            for future in as_completed(futures):
                device, desc, ok = future.result()
                if ok:
                    with lock:
                        confirmed.append((device, desc))

        confirmed.sort(key=lambda x: x[0])
        return confirmed
    
    def connect(self, port: str, baudrate: int = 115200, timeout: float = 1.0) -> bool:
        """Connect to serial port.

        Opens the port in a way that prevents the brief DTR/RTS pulse which
        would trigger the ESP32 auto-reset circuit (same technique used in
        ``probe_gateway_port``).  Steps:
          1. Build a ``Serial`` object WITHOUT auto-opening.
          2. Pre-set ``dtr=False`` and ``rts=False`` so the OS applies those
             levels atomically on ``open()``.
          3. Open, wait 150 ms for native USB CDC-ACM to settle, then flush
             any power-on noise from the RX buffer before starting the read
             thread.
        """
        try:
            if self.is_connected():
                self.disconnect()

            s = serial.Serial()
            s.port     = port
            s.baudrate = baudrate
            s.bytesize = serial.EIGHTBITS
            s.parity   = serial.PARITY_NONE
            s.stopbits = serial.STOPBITS_ONE
            s.rtscts   = False
            s.dsrdtr   = False
            s.timeout  = timeout
            # Pre-set DTR/RTS LOW before open() so no reset pulse is generated.
            s.dtr = False
            s.rts = False
            s.open()

            time.sleep(0.15)          # let native USB CDC-ACM enumerate / settle
            s.reset_input_buffer()    # discard any power-on/noise bytes

            self.serial_port = s
            self.running = True
            self.read_thread = threading.Thread(target=self._read_loop, daemon=True)
            self.read_thread.start()

            self.log(f"Connected to {port} at {baudrate} baud", "SUCCESS")
            return True

        except (serial.SerialException, OSError) as e:
            self.log(f"Connection failed: {e}", "ERROR")
            return False
    
    def disconnect(self):
        """Disconnect from serial port"""
        self.running = False
        
        if self.read_thread and self.read_thread.is_alive():
            self.read_thread.join(timeout=2.0)
        
        if self.serial_port and self.serial_port.is_open:
            port_name = self.serial_port.port
            self.serial_port.close()
            self.log(f"Disconnected from {port_name}", "INFO")
        
        self.serial_port = None
        self.read_thread = None
    
    def is_connected(self) -> bool:
        """Check if connected"""
        return self.serial_port is not None and self.serial_port.is_open
    
    def send(self, data: str, add_crlf: bool = True) -> bool:
        """Send data to serial port"""
        if not self.is_connected():
            self.log("Not connected", "ERROR")
            return False
        
        try:
            if add_crlf and not data.endswith('\r\n'):
                data += '\r\n'
            
            self.serial_port.write(data.encode('utf-8'))
            self.log(f"→ Sent: {data.strip()}", "DEBUG")
            
            # Call TX callback for UART log
            if self.on_tx_callback:
                self.on_tx_callback(data.strip())
            
            return True
            
        except serial.SerialException as e:
            self.log(f"Send failed: {e}", "ERROR")
            return False
    
    def send_raw(self, data: bytes) -> bool:
        """Send raw binary data to serial port (no encoding, no CRLF)"""
        if not self.is_connected():
            self.log("Not connected", "ERROR")
            return False
        
        try:
            self.serial_port.write(data)
            # Add CRLF terminator
            self.serial_port.write(b'\r\n')
            
            self.log(f"→ Sent raw: {data.hex().upper()}", "DEBUG")
            
            # Call TX callback for UART log (show hex representation)
            if self.on_tx_callback:
                self.on_tx_callback(f"[RAW] {data.hex().upper()}")
            
            return True
            
        except serial.SerialException as e:
            self.log(f"Send raw failed: {e}", "ERROR")
            return False
    
    def send_command(self, command: str, timeout: float = 5.0) -> Optional[str]:
        """Send command and wait for response"""
        if not self.is_connected():
            return None
        
        # Clear queue
        while not self.response_queue.empty():
            try:
                self.response_queue.get_nowait()
            except queue.Empty:
                break
        
        self.response_buffer = ""
        
        if not self.send(command):
            return None
        
        # Wait for response
        start_time = time.time()
        response = ""
        
        while time.time() - start_time < timeout:
            try:
                data = self.response_queue.get(timeout=0.1)
                response += data
                
                # Check for CFSC response completion
                if "CFSC_RESP:END" in response:
                    return response
                    
            except queue.Empty:
                continue
        
        if response:
            return response
        
        self.log("Response timeout", "WARNING")
        return None
    
    def _read_loop(self):
        """Background thread for reading serial data"""
        while self.running and self.serial_port and self.serial_port.is_open:
            try:
                if self.serial_port.in_waiting > 0:
                    data = self.serial_port.read(self.serial_port.in_waiting)
                    decoded = data.decode('utf-8', errors='ignore')
                    
                    self.response_queue.put(decoded)
                    
                    if self.on_data_callback:
                        self.on_data_callback(decoded)
                else:
                    time.sleep(0.01)
                    
            except serial.SerialException:
                break
            except Exception as e:
                self.log(f"Read error: {e}", "ERROR")
                break
    
    @property
    def port(self) -> Optional[str]:
        """Get current port name"""
        if self.serial_port:
            return self.serial_port.port
        return None
