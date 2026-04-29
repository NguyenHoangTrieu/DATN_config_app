"""
RS485 Sensor Reader Simulator

Standalone desktop tool that emulates the MODBUS RTU 485 sensor reader from
the attached PDF specification.

Use case:
  - PC runs this script and exposes a COM port through a USB-to-RS485 adapter.
  - Gateway sends MODBUS RTU requests over RS485.
  - This simulator responds like the real sensor module and shows every request
    and response in a live UI.

Documented register map implemented here:
  - 0x0000..0x0007 : AIN0..AIN3 float32 IEEE-754 big-endian
  - 0x0008         : Slave ID (read-only)
  - 0x0009         : Baud code (read/write)
  - 0x000A         : Sleep enable + wait time (read/write)
  - 0x00FF         : Write 0xFFFF to reset defaults

Comments are intentionally explicit because this file is also a test/debug tool.
"""

from __future__ import annotations

import queue
import random
import struct
import threading
import time
import tkinter as tk
from dataclasses import dataclass
from tkinter import messagebox, ttk
from tkinter.scrolledtext import ScrolledText

import serial
import serial.tools.list_ports


BAUD_CODE_TO_RATE = {
    0: 2400,
    1: 4800,
    2: 9600,
    3: 14400,
    4: 19200,
    5: 28800,
    6: 38400,
    7: 57600,
    8: 76800,
    9: 115200,
}

RATE_TO_BAUD_CODE = {rate: code for code, rate in BAUD_CODE_TO_RATE.items()}
DEFAULT_SLEEP_SECONDS = 3
MODBUS_REQUEST_LEN = 8


def crc16_modbus(data: bytes) -> int:
    """Compute MODBUS RTU CRC16 (little-endian on the wire)."""
    crc = 0xFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            if crc & 0x0001:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc >>= 1
    return crc & 0xFFFF


def append_crc(payload: bytes) -> bytes:
    """Return payload with MODBUS CRC appended as low byte, high byte."""
    crc = crc16_modbus(payload)
    return payload + bytes((crc & 0xFF, (crc >> 8) & 0xFF))


def format_hex(data: bytes) -> str:
    """Readable uppercase hex string for logs and UI."""
    return " ".join(f"{byte:02X}" for byte in data)


def now_text() -> str:
    """Human-friendly clock for log lines."""
    return time.strftime("%H:%M:%S")


@dataclass
class ModbusRequest:
    """Decoded MODBUS RTU request frame."""

    slave: int
    function: int
    register: int
    value_or_count: int
    raw: bytes


class SensorModel:
    """Thread-safe model of the emulated sensor reader state."""

    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.strict_wakeup = False
        self.random_walk_enabled = False
        self.random_walk_step = 0.015
        self.reset_defaults()

    def reset_defaults(self) -> None:
        with self.lock:
            self.slave_id = 0x1F
            self.baud_code = 2
            self.sleep_enabled = False
            self.sleep_wait = 0
            self.analog_values = [1.2345, 2.3456, 3.4567, 4.5678]
            self.last_command_monotonic = time.monotonic()
            self.is_sleeping = False
            self.command_count = 0

    def snapshot(self) -> dict:
        """Return a copy used by the UI thread without holding the lock long."""
        with self.lock:
            return {
                "slave_id": self.slave_id,
                "baud_code": self.baud_code,
                "baud_rate": BAUD_CODE_TO_RATE.get(self.baud_code),
                "sleep_enabled": self.sleep_enabled,
                "sleep_wait": self.sleep_wait,
                "analog_values": list(self.analog_values),
                "is_sleeping": self.is_sleeping,
                "command_count": self.command_count,
                "strict_wakeup": self.strict_wakeup,
                "random_walk_enabled": self.random_walk_enabled,
            }

    def set_strict_wakeup(self, enabled: bool) -> None:
        with self.lock:
            self.strict_wakeup = enabled

    def set_random_walk(self, enabled: bool) -> None:
        with self.lock:
            self.random_walk_enabled = enabled

    def set_analog_value(self, index: int, value: float) -> None:
        with self.lock:
            self.analog_values[index] = float(value)

    def set_sleep_from_ui(self, enabled: bool, wait_seconds: int) -> None:
        with self.lock:
            self.sleep_enabled = enabled
            self.sleep_wait = max(0, min(255, int(wait_seconds)))
            if not enabled:
                self.is_sleeping = False
            self.last_command_monotonic = time.monotonic()

    def set_baud_code_from_ui(self, baud_code: int) -> None:
        with self.lock:
            self.baud_code = baud_code

    def set_slave_id_from_ui(self, slave_id: int) -> None:
        with self.lock:
            self.slave_id = slave_id & 0x1F

    def wake_up(self) -> None:
        with self.lock:
            self.is_sleeping = False
            self.last_command_monotonic = time.monotonic()

    def tick(self) -> None:
        """Update sleep state and optional analog drift."""
        with self.lock:
            if self.random_walk_enabled:
                self.analog_values = [
                    self._walk(value, idx) for idx, value in enumerate(self.analog_values)
                ]

            if self.sleep_enabled:
                timeout = self.sleep_wait if self.sleep_wait > 0 else DEFAULT_SLEEP_SECONDS
                if time.monotonic() - self.last_command_monotonic >= timeout:
                    self.is_sleeping = True
            else:
                self.is_sleeping = False

    def should_handle_request(self, slave: int) -> bool:
        with self.lock:
            return slave == self.slave_id

    def handle_request(self, request: ModbusRequest) -> tuple[bytes | None, str, int | None]:
        """
        Execute a MODBUS request.

        Returns:
          response_frame: bytes to send, or None to ignore the request.
          summary:        text for the UI log.
          new_baud_rate:  actual serial baud to apply after sending the reply.
        """
        with self.lock:
            if request.slave != self.slave_id:
                return None, f"Ignore request for slave 0x{request.slave:02X}", None

            if self.is_sleeping:
                if self.strict_wakeup:
                    return None, "Ignored while sleeping (strict WAKEUP emulation)", None
                self.is_sleeping = False

            self.last_command_monotonic = time.monotonic()
            self.command_count += 1

            if request.function == 0x03:
                return self._handle_read_holding(request)

            if request.function == 0x06:
                return self._handle_write_single(request)

            return self._exception_response(request, 0x01, "Illegal function")

    def _handle_read_holding(self, request: ModbusRequest) -> tuple[bytes, str, int | None]:
        start = request.register
        count = request.value_or_count
        if count <= 0 or count > 0x007D:
            return self._exception_response(request, 0x03, "Illegal read count")

        registers = []
        for register in range(start, start + count):
            reg_value = self._read_register(register)
            if reg_value is None:
                return self._exception_response(
                    request,
                    0x02,
                    f"Illegal read address 0x{register:04X}",
                )
            registers.append(reg_value)

        data_bytes = bytearray()
        for register_value in registers:
            data_bytes.extend(struct.pack(">H", register_value))

        payload = bytes((request.slave, 0x03, len(data_bytes))) + bytes(data_bytes)
        response = append_crc(payload)
        summary = f"Read 0x{start:04X} count 0x{count:04X} -> {len(data_bytes)} data bytes"
        return response, summary, None

    def _handle_write_single(self, request: ModbusRequest) -> tuple[bytes, str, int | None]:
        register = request.register
        value = request.value_or_count
        new_baud_rate = None

        if register == 0x0009:
            if value not in BAUD_CODE_TO_RATE:
                return self._exception_response(request, 0x03, f"Unsupported baud code 0x{value:04X}")
            self.baud_code = value
            new_baud_rate = BAUD_CODE_TO_RATE[value]
            summary = f"Write baud code -> {value} ({new_baud_rate} baud)"
        elif register == 0x000A:
            self.sleep_enabled = ((value >> 8) & 0xFF) == 0x01
            self.sleep_wait = value & 0xFF
            if not self.sleep_enabled:
                self.is_sleeping = False
            summary = (
                f"Write sleep config -> enabled={self.sleep_enabled}, "
                f"wait={self.sleep_wait if self.sleep_wait else DEFAULT_SLEEP_SECONDS}s"
            )
        elif register == 0x00FF:
            if value != 0xFFFF:
                return self._exception_response(request, 0x03, "Reset register requires value 0xFFFF")
            self.reset_defaults()
            new_baud_rate = BAUD_CODE_TO_RATE[self.baud_code]
            summary = "Factory reset applied"
        else:
            return self._exception_response(request, 0x02, f"Illegal write address 0x{register:04X}")

        response = append_crc(request.raw[:6])
        return response, summary, new_baud_rate

    def _exception_response(
        self,
        request: ModbusRequest,
        code: int,
        summary: str,
    ) -> tuple[bytes, str, int | None]:
        payload = bytes((request.slave, request.function | 0x80, code))
        return append_crc(payload), summary, None

    def _read_register(self, register: int) -> int | None:
        if 0x0000 <= register <= 0x0007:
            channel_index = register // 2
            float_bytes = struct.pack(">f", self.analog_values[channel_index])
            word_offset = register % 2
            start = word_offset * 2
            return struct.unpack(">H", float_bytes[start : start + 2])[0]

        if register == 0x0008:
            return self.slave_id & 0x001F

        if register == 0x0009:
            return self.baud_code & 0xFFFF

        if register == 0x000A:
            return (((1 if self.sleep_enabled else 0) & 0xFF) << 8) | (self.sleep_wait & 0xFF)

        return None

    def _walk(self, value: float, channel_index: int) -> float:
        base = max(0.0, value)
        step = random.uniform(-self.random_walk_step, self.random_walk_step)
        drift = (channel_index + 1) * 0.0008
        return round(max(0.0, min(6.144, base + step + drift)), 5)


class SensorSimulatorApp:
    """Tkinter application hosting both the emulator state and the COM bridge."""

    def __init__(self) -> None:
        self.root = tk.Tk()
        self.root.title("RS485 Sensor Reader Simulator")
        self.root.geometry("1320x860")
        self.root.minsize(1180, 760)

        self.model = SensorModel()
        self.serial_port: serial.Serial | None = None
        self.serial_thread: threading.Thread | None = None
        self.serial_running = threading.Event()
        self.ui_queue: queue.Queue[tuple[str, object]] = queue.Queue()
        self.rx_buffer = bytearray()

        self.port_var = tk.StringVar()
        self.port_baud_var = tk.StringVar(value="9600")
        self.connection_var = tk.StringVar(value="Disconnected")
        self.sleep_state_var = tk.StringVar(value="Awake")
        self.command_count_var = tk.StringVar(value="0")
        self.actual_link_baud_var = tk.StringVar(value="9600")
        self.last_request_var = tk.StringVar(value="-")

        self.slave_id_var = tk.IntVar(value=0x1F)
        self.strict_wakeup_var = tk.BooleanVar(value=False)
        self.random_walk_var = tk.BooleanVar(value=False)
        self.sleep_enable_var = tk.BooleanVar(value=False)
        self.sleep_wait_var = tk.IntVar(value=0)
        self.baud_code_var = tk.IntVar(value=2)

        self.ain_vars = [tk.DoubleVar(value=value) for value in self.model.snapshot()["analog_values"]]

        self._create_styles()
        self._create_ui()
        self.refresh_ports()
        self._schedule_ui_pump()
        self._schedule_model_tick()

        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

    def _create_styles(self) -> None:
        style = ttk.Style()
        if "clam" in style.theme_names():
            style.theme_use("clam")

        style.configure("TFrame", background="#F2F5F7")
        style.configure("TLabelframe", background="#F2F5F7")
        style.configure("TLabelframe.Label", background="#F2F5F7", font=("Segoe UI", 10, "bold"))
        style.configure("TLabel", background="#F2F5F7")
        style.configure("Header.TLabel", font=("Segoe UI", 16, "bold"), foreground="#143B4A")
        style.configure("State.TLabel", font=("Segoe UI", 10, "bold"))
        style.configure("Action.TButton", padding=6, font=("Segoe UI", 10, "bold"))

    def _create_ui(self) -> None:
        main = ttk.Frame(self.root, padding=10)
        main.pack(fill=tk.BOTH, expand=True)

        header = ttk.Frame(main)
        header.pack(fill=tk.X, pady=(0, 8))
        ttk.Label(header, text="RS485 Sensor Reader Simulator", style="Header.TLabel").pack(side=tk.LEFT)
        ttk.Label(
            header,
            text="USB-to-RS485 -> COM port -> Gateway test bench",
            foreground="#607D8B",
        ).pack(side=tk.LEFT, padx=(12, 0), pady=(6, 0))

        conn = ttk.LabelFrame(main, text="Connection", padding=10)
        conn.pack(fill=tk.X, pady=(0, 10))

        ttk.Label(conn, text="COM Port:").grid(row=0, column=0, sticky="w")
        self.port_combo = ttk.Combobox(conn, textvariable=self.port_var, width=18, state="readonly")
        self.port_combo.grid(row=0, column=1, sticky="w", padx=(6, 10))
        ttk.Button(conn, text="Refresh", command=self.refresh_ports).grid(row=0, column=2, sticky="w")

        ttk.Label(conn, text="Link Baud:").grid(row=0, column=3, sticky="w", padx=(18, 0))
        self.link_baud_combo = ttk.Combobox(
            conn,
            textvariable=self.port_baud_var,
            values=[str(rate) for rate in BAUD_CODE_TO_RATE.values()],
            width=12,
            state="readonly",
        )
        self.link_baud_combo.grid(row=0, column=4, sticky="w", padx=(6, 10))

        self.connect_button = ttk.Button(conn, text="Connect", style="Action.TButton", command=self.toggle_connection)
        self.connect_button.grid(row=0, column=5, sticky="w", padx=(6, 0))

        ttk.Label(conn, text="State:").grid(row=1, column=0, sticky="w", pady=(10, 0))
        ttk.Label(conn, textvariable=self.connection_var, style="State.TLabel", foreground="#1B5E20").grid(
            row=1, column=1, sticky="w", pady=(10, 0)
        )

        ttk.Label(conn, text="Actual Link Baud:").grid(row=1, column=3, sticky="w", pady=(10, 0))
        ttk.Label(conn, textvariable=self.actual_link_baud_var, style="State.TLabel").grid(
            row=1, column=4, sticky="w", pady=(10, 0)
        )

        ttk.Label(conn, text="Last Request:").grid(row=1, column=5, sticky="e", pady=(10, 0))
        ttk.Label(conn, textvariable=self.last_request_var, foreground="#546E7A").grid(
            row=1, column=6, sticky="w", padx=(8, 0), pady=(10, 0)
        )

        layout = ttk.PanedWindow(main, orient=tk.HORIZONTAL)
        layout.pack(fill=tk.BOTH, expand=True)

        left = ttk.Frame(layout)
        right = ttk.Frame(layout)
        layout.add(left, weight=2)
        layout.add(right, weight=3)

        self._build_sensor_panel(left)
        self._build_log_panel(right)

    def _build_sensor_panel(self, parent: ttk.Frame) -> None:
        summary = ttk.LabelFrame(parent, text="Sensor State", padding=10)
        summary.pack(fill=tk.X, pady=(0, 10))

        ttk.Label(summary, text="Sleep State:").grid(row=0, column=0, sticky="w")
        ttk.Label(summary, textvariable=self.sleep_state_var, style="State.TLabel").grid(row=0, column=1, sticky="w")

        ttk.Label(summary, text="Commands Seen:").grid(row=0, column=2, sticky="w", padx=(16, 0))
        ttk.Label(summary, textvariable=self.command_count_var, style="State.TLabel").grid(row=0, column=3, sticky="w")

        ttk.Button(summary, text="Wake Up", command=self.on_wake_click).grid(row=0, column=4, padx=(18, 0))
        ttk.Button(summary, text="Factory Reset", command=self.on_reset_click).grid(row=0, column=5, padx=(8, 0))

        config = ttk.LabelFrame(parent, text="Registers / Behaviour", padding=10)
        config.pack(fill=tk.X, pady=(0, 10))

        ttk.Label(config, text="Slave ID (0-31):").grid(row=0, column=0, sticky="w")
        ttk.Spinbox(config, from_=0, to=31, textvariable=self.slave_id_var, width=8, command=self.on_ui_config_change).grid(
            row=0, column=1, sticky="w", padx=(6, 12)
        )

        ttk.Label(config, text="Baud Code:").grid(row=0, column=2, sticky="w")
        baud_items = [f"{code} -> {rate}" for code, rate in BAUD_CODE_TO_RATE.items()]
        self.baud_combo = ttk.Combobox(config, values=baud_items, width=16, state="readonly")
        self.baud_combo.grid(row=0, column=3, sticky="w", padx=(6, 0))
        self.baud_combo.current(2)
        self.baud_combo.bind("<<ComboboxSelected>>", lambda _event: self.on_baud_combo_change())

        ttk.Checkbutton(
            config,
            text="Sleep enable",
            variable=self.sleep_enable_var,
            command=self.on_ui_config_change,
        ).grid(row=1, column=0, sticky="w", pady=(10, 0))

        ttk.Label(config, text="Sleep wait (s):").grid(row=1, column=1, sticky="e", pady=(10, 0))
        ttk.Spinbox(config, from_=0, to=255, textvariable=self.sleep_wait_var, width=8, command=self.on_ui_config_change).grid(
            row=1, column=2, sticky="w", padx=(6, 12), pady=(10, 0)
        )

        ttk.Checkbutton(
            config,
            text="Strict WAKEUP emulation",
            variable=self.strict_wakeup_var,
            command=self.on_ui_config_change,
        ).grid(row=2, column=0, columnspan=2, sticky="w", pady=(10, 0))

        ttk.Checkbutton(
            config,
            text="Random walk analog values",
            variable=self.random_walk_var,
            command=self.on_ui_config_change,
        ).grid(row=2, column=2, columnspan=2, sticky="w", pady=(10, 0))

        ttk.Label(
            config,
            text=(
                "Strict WAKEUP emulation matches the real sensor more closely: if the device enters sleep, "
                "RS485 requests are ignored until the Wake Up button is pressed."
            ),
            wraplength=520,
            foreground="#607D8B",
            justify=tk.LEFT,
        ).grid(row=3, column=0, columnspan=4, sticky="w", pady=(12, 0))

        channels = ttk.LabelFrame(parent, text="AIN Channels (editable float32 values)", padding=10)
        channels.pack(fill=tk.BOTH, expand=True)

        for idx in range(4):
            frame = ttk.Frame(channels)
            frame.pack(fill=tk.X, pady=5)
            ttk.Label(frame, text=f"AIN{idx}:", width=8).pack(side=tk.LEFT)
            entry = ttk.Entry(frame, textvariable=self.ain_vars[idx], width=16)
            entry.pack(side=tk.LEFT, padx=(0, 8))
            ttk.Button(frame, text="Apply", command=lambda channel=idx: self.apply_analog_value(channel)).pack(side=tk.LEFT)
            ttk.Label(frame, text=f"Registers 0x{idx * 2:04X}..0x{idx * 2 + 1:04X}", foreground="#607D8B").pack(
                side=tk.LEFT, padx=(10, 0)
            )

    def _build_log_panel(self, parent: ttk.Frame) -> None:
        log_frame = ttk.LabelFrame(parent, text="RX / TX Monitor", padding=10)
        log_frame.pack(fill=tk.BOTH, expand=True)

        self.log_text = ScrolledText(log_frame, height=32, font=("Consolas", 10), wrap=tk.WORD, bg="#0D1117", fg="#D8E4EA")
        self.log_text.pack(fill=tk.BOTH, expand=True)
        self.log_text.configure(state=tk.DISABLED)

        hint = ttk.LabelFrame(parent, text="Implemented protocol", padding=10)
        hint.pack(fill=tk.X, pady=(10, 0))
        ttk.Label(
            hint,
            text=(
                "Function 0x03 and 0x06 are implemented exactly as documented. Undefined register reads/writes return "
                "MODBUS exceptions. Register 0x0009 updates the actual COM baud after the write echo is sent."
            ),
            wraplength=700,
            justify=tk.LEFT,
            foreground="#546E7A",
        ).pack(anchor="w")

    def log(self, level: str, message: str) -> None:
        self.ui_queue.put(("log", (level, message)))

    def refresh_ports(self) -> None:
        ports = [port.device for port in serial.tools.list_ports.comports()]
        self.port_combo["values"] = ports
        if ports and not self.port_var.get():
            self.port_var.set(ports[0])

    def toggle_connection(self) -> None:
        if self.serial_port and self.serial_port.is_open:
            self.disconnect_serial()
        else:
            self.connect_serial()

    def connect_serial(self) -> None:
        port = self.port_var.get().strip()
        if not port:
            messagebox.showwarning("No port", "Select a COM port first.")
            return

        baud_rate = int(self.port_baud_var.get())
        try:
            self.serial_port = serial.Serial(
                port=port,
                baudrate=baud_rate,
                bytesize=serial.EIGHTBITS,
                parity=serial.PARITY_NONE,
                stopbits=serial.STOPBITS_ONE,
                timeout=0.1,
                inter_byte_timeout=0.02,
                xonxoff=False,
                rtscts=False,
                dsrdtr=False,
            )
        except serial.SerialException as exc:
            messagebox.showerror("Serial error", str(exc))
            return

        self.serial_running.set()
        self.rx_buffer.clear()
        self.serial_thread = threading.Thread(target=self.serial_worker, daemon=True)
        self.serial_thread.start()

        self.connection_var.set(f"Connected to {port}")
        self.actual_link_baud_var.set(str(baud_rate))
        self.connect_button.configure(text="Disconnect")
        self.log("INFO", f"Connected to {port} at {baud_rate} baud")

    def disconnect_serial(self) -> None:
        self.serial_running.clear()
        if self.serial_thread and self.serial_thread.is_alive():
            self.serial_thread.join(timeout=1.5)
        self.serial_thread = None

        if self.serial_port and self.serial_port.is_open:
            port_name = self.serial_port.port
            self.serial_port.close()
            self.log("INFO", f"Disconnected from {port_name}")

        self.serial_port = None
        self.connection_var.set("Disconnected")
        self.connect_button.configure(text="Connect")

    def serial_worker(self) -> None:
        assert self.serial_port is not None
        while self.serial_running.is_set():
            try:
                chunk = self.serial_port.read(128)
            except serial.SerialException as exc:
                self.log("FAIL", f"Serial read error: {exc}")
                self.ui_queue.put(("disconnect", None))
                return

            if not chunk:
                continue

            self.rx_buffer.extend(chunk)
            self._process_rx_buffer()

    def _process_rx_buffer(self) -> None:
        while len(self.rx_buffer) >= MODBUS_REQUEST_LEN:
            candidate = bytes(self.rx_buffer[:MODBUS_REQUEST_LEN])
            request = self._try_parse_request(candidate)
            if request is None:
                dropped = self.rx_buffer.pop(0)
                self.log("WARN", f"Dropped unsynchronised byte 0x{dropped:02X}")
                continue

            del self.rx_buffer[:MODBUS_REQUEST_LEN]
            self.handle_modbus_request(request)

    def _try_parse_request(self, frame: bytes) -> ModbusRequest | None:
        payload = frame[:-2]
        crc_actual = frame[-2] | (frame[-1] << 8)
        if crc16_modbus(payload) != crc_actual:
            return None

        return ModbusRequest(
            slave=frame[0],
            function=frame[1],
            register=(frame[2] << 8) | frame[3],
            value_or_count=(frame[4] << 8) | frame[5],
            raw=frame,
        )

    def handle_modbus_request(self, request: ModbusRequest) -> None:
        self.log(
            "RX",
            f"{format_hex(request.raw)}  | slave=0x{request.slave:02X}, func=0x{request.function:02X}, "
            f"reg=0x{request.register:04X}, data=0x{request.value_or_count:04X}",
        )
        self.last_request_var.set(f"0x{request.function:02X} @ 0x{request.register:04X}")

        response, summary, new_baud_rate = self.model.handle_request(request)
        self.log("INFO", summary)

        if response is None:
            return

        try:
            assert self.serial_port is not None
            self.serial_port.write(response)
            self.serial_port.flush()
            self.log("TX", format_hex(response))
        except serial.SerialException as exc:
            self.log("FAIL", f"Serial write error: {exc}")
            return

        if new_baud_rate is not None and self.serial_port is not None:
            # Apply the new baud only after the write response is fully flushed.
            time.sleep(0.05)
            self.serial_port.baudrate = new_baud_rate
            self.ui_queue.put(("baud_change", new_baud_rate))
            self.log("INFO", f"Serial link baud changed to {new_baud_rate}")

    def on_ui_config_change(self) -> None:
        self.model.set_slave_id_from_ui(self.slave_id_var.get())
        self.model.set_sleep_from_ui(self.sleep_enable_var.get(), self.sleep_wait_var.get())
        self.model.set_strict_wakeup(self.strict_wakeup_var.get())
        self.model.set_random_walk(self.random_walk_var.get())

    def on_baud_combo_change(self) -> None:
        text = self.baud_combo.get().strip()
        code = int(text.split("->", 1)[0].strip())
        self.baud_code_var.set(code)
        self.model.set_baud_code_from_ui(code)

    def apply_analog_value(self, index: int) -> None:
        try:
            value = float(self.ain_vars[index].get())
        except (TypeError, ValueError):
            messagebox.showerror("Invalid value", f"AIN{index} must be a number.")
            return

        self.model.set_analog_value(index, value)
        self.log("INFO", f"AIN{index} set to {value:.5f} V")

    def on_wake_click(self) -> None:
        self.model.wake_up()
        self.log("INFO", "Software WAKEUP button pressed")

    def on_reset_click(self) -> None:
        self.model.reset_defaults()
        if self.serial_port and self.serial_port.is_open:
            default_rate = BAUD_CODE_TO_RATE[2]
            self.serial_port.baudrate = default_rate
            self.port_baud_var.set(str(default_rate))
            self.actual_link_baud_var.set(str(default_rate))
        self.log("INFO", "Factory defaults restored from UI")
        self._sync_model_to_controls()

    def _sync_model_to_controls(self) -> None:
        snapshot = self.model.snapshot()
        self.slave_id_var.set(snapshot["slave_id"])
        self.sleep_enable_var.set(snapshot["sleep_enabled"])
        self.sleep_wait_var.set(snapshot["sleep_wait"])
        self.strict_wakeup_var.set(snapshot["strict_wakeup"])
        self.random_walk_var.set(snapshot["random_walk_enabled"])
        self.baud_code_var.set(snapshot["baud_code"])

        for combo_index, item in enumerate(BAUD_CODE_TO_RATE.items()):
            code, _rate = item
            if code == snapshot["baud_code"]:
                self.baud_combo.current(combo_index)
                break

        for idx, value in enumerate(snapshot["analog_values"]):
            self.ain_vars[idx].set(value)

    def _schedule_ui_pump(self) -> None:
        self._pump_ui_queue()
        self.root.after(80, self._schedule_ui_pump)

    def _pump_ui_queue(self) -> None:
        while True:
            try:
                event_name, payload = self.ui_queue.get_nowait()
            except queue.Empty:
                break

            if event_name == "log":
                level, message = payload
                self._append_log(level, message)
            elif event_name == "disconnect":
                self.disconnect_serial()
            elif event_name == "baud_change":
                self.port_baud_var.set(str(payload))
                self.actual_link_baud_var.set(str(payload))

        snapshot = self.model.snapshot()
        self.sleep_state_var.set("Sleeping" if snapshot["is_sleeping"] else "Awake")
        self.command_count_var.set(str(snapshot["command_count"]))

    def _append_log(self, level: str, message: str) -> None:
        color = {
            "INFO": "#CFD8DC",
            "RX": "#FFB74D",
            "TX": "#4DD0E1",
            "WARN": "#FFD54F",
            "FAIL": "#EF9A9A",
        }.get(level, "#CFD8DC")

        self.log_text.configure(state=tk.NORMAL)
        self.log_text.insert(tk.END, f"[{now_text()}] [{level}] {message}\n", level)
        self.log_text.tag_config(level, foreground=color)
        self.log_text.see(tk.END)
        self.log_text.configure(state=tk.DISABLED)

    def _schedule_model_tick(self) -> None:
        self.model.tick()
        self.root.after(250, self._schedule_model_tick)

    def on_close(self) -> None:
        self.disconnect_serial()
        self.root.destroy()

    def run(self) -> None:
        self.root.mainloop()


if __name__ == "__main__":
    app = SensorSimulatorApp()
    app.run()