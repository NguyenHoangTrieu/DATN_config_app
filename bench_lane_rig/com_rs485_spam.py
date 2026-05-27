#!/usr/bin/env python3
"""
com_rs485_spam.py - PC-side RS485 traffic generator for §5 end-to-end latency test.

Sends rate-paced packets over a serial COM port (PC -> USB-RS485 adapter ->
LAN MCU RS485 lane). Each packet carries a 4-byte little-endian sequence
number followed by a fixed-byte payload pattern. The LAN MCU stamps the
reception time, forwards to WAN, and WAN computes end-to-end latency.

Two modes:
  fixed : hold one rate for `--count` packets (or forever if count=0)
  ramp  : walk a built-in rate ladder, holding each step for `--step-sec`

Usage examples:
  python com_rs485_spam.py --port COM5 --baud 115200 --pps 10 --count 1100
  python com_rs485_spam.py --port COM5 --baud 115200 --pps 200 --count 1100 --pkt 64
  python com_rs485_spam.py --port COM5 --baud 921600 --mode ramp --step-sec 5

Self-stats are printed to stdout every 1 second:
  [TX] t=10.0s sent=1000 bytes=64000 pps=100.0 kbps=51.2

Dependencies: pip install pyserial
"""
import argparse
import struct
import sys
import time

try:
    import serial
except ImportError:
    print("ERROR: pyserial not installed. Run: pip install pyserial", file=sys.stderr)
    sys.exit(1)


RAMP_STEPS_PPS = [10, 25, 50, 100, 200, 400, 600]  # ramp ladder for --mode ramp


def build_packet(seq: int, size: int) -> bytes:
    """4-byte LE sequence header + pattern payload (bytes 4..size-1 = i & 0xFF)."""
    if size < 4:
        raise ValueError("packet size must be >= 4")
    header = struct.pack("<I", seq & 0xFFFFFFFF)
    payload = bytes((i & 0xFF) for i in range(4, size))
    return header + payload


def spam_fixed(ser, pps: int, pkt_size: int, count: int) -> None:
    """Send `count` packets at `pps` packets/sec. count=0 -> forever."""
    period = 1.0 / pps if pps > 0 else 0.0
    sent = 0
    total_b = 0
    seq = 0
    t_start = time.perf_counter()
    t_next = t_start
    t_last_log = t_start

    print(f"[CFG] mode=fixed pps={pps} pkt={pkt_size}B count={count or 'inf'}")

    try:
        while count == 0 or sent < count:
            now = time.perf_counter()
            if now >= t_next:
                pkt = build_packet(seq, pkt_size)
                ser.write(pkt)
                seq += 1
                sent += 1
                total_b += pkt_size
                t_next += period

                # Avoid drift if we ever fall behind by more than 1 period
                if now - t_next > period:
                    t_next = now + period

            if now - t_last_log >= 1.0:
                elapsed = now - t_start
                cur_pps = sent / elapsed if elapsed > 0 else 0
                kbps = total_b * 8 / 1000.0 / elapsed if elapsed > 0 else 0
                print(f"[TX] t={elapsed:.1f}s sent={sent} bytes={total_b} "
                      f"pps={cur_pps:.1f} kbps={kbps:.1f}")
                t_last_log = now

            # Light sleep when next slot is far away to avoid 100% CPU
            sleep_for = t_next - time.perf_counter()
            if sleep_for > 0.001:
                time.sleep(min(sleep_for, 0.005))

    except KeyboardInterrupt:
        pass
    finally:
        ser.flush()
        elapsed = time.perf_counter() - t_start
        print(f"[DONE] sent={sent} bytes={total_b} elapsed={elapsed:.2f}s "
              f"avg_pps={sent/elapsed:.1f}")


def spam_ramp(ser, pkt_size: int, step_sec: float) -> None:
    """Walk RAMP_STEPS_PPS, holding each step for `step_sec`. Runs forever."""
    sent_total = 0
    total_b = 0
    seq = 0
    print(f"[CFG] mode=ramp steps={RAMP_STEPS_PPS} step_sec={step_sec} pkt={pkt_size}B")
    try:
        while True:
            for step_idx, pps in enumerate(RAMP_STEPS_PPS):
                period = 1.0 / pps
                step_sent = 0
                step_b = 0
                t_step_start = time.perf_counter()
                t_next = t_step_start
                t_last_log = t_step_start

                while time.perf_counter() - t_step_start < step_sec:
                    now = time.perf_counter()
                    if now >= t_next:
                        pkt = build_packet(seq, pkt_size)
                        ser.write(pkt)
                        seq += 1
                        sent_total += 1
                        step_sent += 1
                        total_b += pkt_size
                        step_b += pkt_size
                        t_next += period
                        if now - t_next > period:
                            t_next = now + period

                    if now - t_last_log >= 1.0:
                        elapsed = now - t_step_start
                        cur_pps = step_sent / elapsed if elapsed > 0 else 0
                        print(f"[TX] step={step_idx+1}/{len(RAMP_STEPS_PPS)} "
                              f"req_pps={pps} t={elapsed:.1f}s "
                              f"step_sent={step_sent} cur_pps={cur_pps:.1f} "
                              f"total_sent={sent_total}")
                        t_last_log = now

                    sleep_for = t_next - time.perf_counter()
                    if sleep_for > 0.001:
                        time.sleep(min(sleep_for, 0.005))

                print(f"[STEP DONE] step={step_idx+1} req_pps={pps} "
                      f"sent={step_sent} bytes={step_b}")
    except KeyboardInterrupt:
        pass
    finally:
        ser.flush()
        print(f"[DONE] total_sent={sent_total} total_bytes={total_b}")


def main() -> int:
    ap = argparse.ArgumentParser(description="PC RS485 traffic generator for e2e latency test")
    ap.add_argument("--port", required=True, help="COM port (e.g. COM5 / /dev/ttyUSB0)")
    ap.add_argument("--baud", type=int, default=115200, help="baud rate (default 115200)")
    ap.add_argument("--pkt", type=int, default=64, help="packet size in bytes (default 64, min 4)")
    ap.add_argument("--mode", choices=["fixed", "ramp"], default="fixed",
                    help="fixed=single rate, ramp=walk built-in ladder")
    ap.add_argument("--pps", type=int, default=100,
                    help="packets per second (fixed mode, default 100)")
    ap.add_argument("--count", type=int, default=1100,
                    help="number of packets to send (fixed mode, 0=forever, default 1100)")
    ap.add_argument("--step-sec", type=float, default=5.0,
                    help="seconds per step (ramp mode, default 5)")
    args = ap.parse_args()

    if args.pkt < 4:
        print("ERROR: --pkt must be >= 4", file=sys.stderr)
        return 1

    try:
        ser = serial.Serial(args.port, args.baud, timeout=0.1, write_timeout=2.0)
    except serial.SerialException as e:
        print(f"ERROR: cannot open {args.port}: {e}", file=sys.stderr)
        return 1

    # Drain any RX noise from adapter power-up
    ser.reset_input_buffer()
    ser.reset_output_buffer()
    print(f"[OPEN] {args.port} @ {args.baud} baud")

    try:
        if args.mode == "fixed":
            spam_fixed(ser, args.pps, args.pkt, args.count)
        else:
            spam_ramp(ser, args.pkt, args.step_sec)
    finally:
        ser.close()
        print("[CLOSE]")

    return 0


if __name__ == "__main__":
    sys.exit(main())
