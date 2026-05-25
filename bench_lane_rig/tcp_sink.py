#!/usr/bin/env python3
"""
tcp_sink.py — minimal TCP byte-counter sink for §3 mode A (raw socket).

Run on a LAN host that the WAN MCU can reach. Counts bytes received per
window and prints kbps so you can cross-check against the firmware log.

Usage:
    python3 tcp_sink.py [host] [port] [window_seconds]

Defaults: host=0.0.0.0  port=5555  window=2.0
"""
import socket, sys, threading, time

HOST   = sys.argv[1] if len(sys.argv) > 1 else "0.0.0.0"
PORT   = int(sys.argv[2]) if len(sys.argv) > 2 else 5555
WINDOW = float(sys.argv[3]) if len(sys.argv) > 3 else 2.0

bytes_total = 0
bytes_window = 0
lock = threading.Lock()
running = True

def reporter():
    global bytes_window
    while running:
        time.sleep(WINDOW)
        with lock:
            b = bytes_window
            bytes_window = 0
        kbps = (b * 8) / (WINDOW * 1000.0)
        print(f"[SINK] win={WINDOW:.1f}s bytes={b} kbps={kbps:.1f} total={bytes_total}")

def serve_client(conn, addr):
    global bytes_total, bytes_window
    print(f"[SINK] client connected from {addr}")
    try:
        while True:
            data = conn.recv(65536)
            if not data: break
            with lock:
                bytes_total += len(data)
                bytes_window += len(data)
    except OSError:
        pass
    finally:
        conn.close()
        print(f"[SINK] client {addr} disconnected")

def main():
    global running
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind((HOST, PORT))
    s.listen(4)
    print(f"[SINK] listening on {HOST}:{PORT}  window={WINDOW}s")

    t = threading.Thread(target=reporter, daemon=True)
    t.start()

    try:
        while True:
            conn, addr = s.accept()
            threading.Thread(target=serve_client,
                             args=(conn, addr), daemon=True).start()
    except KeyboardInterrupt:
        running = False
        print("\n[SINK] shutting down")
        s.close()

if __name__ == "__main__":
    main()
