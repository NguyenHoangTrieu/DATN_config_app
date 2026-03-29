#!/usr/bin/env python3
"""
Send BLE config command via UART with raw bytes.
Avoids terminal software adding control characters or wrapping issues.
"""

import serial
import time
import sys

# BLE config JSON (1807 bytes)
JSON_CONFIG = r'''{"module_id":"002","module_type":"BLE","module_name":"STM32WB_BLE","module_communication":{"port_type":"uart","parameters":{"baudrate":115200,"parity":"none","stopbit":1}},"functions":[{"function_name":"MODULE_HW_RESET","command":"","is_prefix":false,"gpio_start_control":[{"pin":"01","state":"LOW"}],"delay_start":100,"expect_response":"","timeout":0,"gpio_end_control":[{"pin":"01","state":"HIGH"}],"delay_end":1000},{"function_name":"MODULE_SW_RESET","command":"AT+RESET\r\n","is_prefix":false,"gpio_start_control":[],"delay_start":0,"expect_response":"OK","timeout":2000,"gpio_end_control":[],"delay_end":1000},{"function_name":"MODULE_GET_INFO","command":"AT+VER\r\n","is_prefix":false,"gpio_start_control":[],"delay_start":0,"expect_response":"+VER:","timeout":500,"gpio_end_control":[],"delay_end":0},{"function_name":"MODULE_ENTER_CMD_MODE","command":"AT+CMDMODE\r\n","is_prefix":false,"gpio_start_control":[],"delay_start":0,"expect_response":"OK","timeout":500,"gpio_end_control":[],"delay_end":0},{"function_name":"MODULE_START_DISCOVERY","command":"AT+SCAN","is_prefix":true,"gpio_start_control":[],"delay_start":0,"expect_response":"+SCAN:","timeout":10000,"gpio_end_control":[],"delay_end":0},{"function_name":"MODULE_CONNECT","command":"AT+CONNECT=","is_prefix":true,"gpio_start_control":[],"delay_start":0,"expect_response":"+CONNECTED:","timeout":5000,"gpio_end_control":[],"delay_end":0},{"function_name":"MODULE_DISCONNECT","command":"AT+DISCONNECT=","is_prefix":true,"gpio_start_control":[],"delay_start":0,"expect_response":"+DISCONNECTED:","timeout":1000,"gpio_end_control":[],"delay_end":200},{"function_name":"MODULE_SEND_DATA","command":"AT+WRITE=","is_prefix":true,"gpio_start_control":[],"delay_start":0,"expect_response":"OK","timeout":1000,"gpio_end_control":[],"delay_end":0}]}'''

# Command prefix (UART → WAN → LAN)
COMMAND = f"CFML:CFBL:JSON:0:{JSON_CONFIG}"

def send_uart_command(port='COM3', baudrate=115200):
    """Send BLE config via UART as raw bytes."""
    try:
        # Open serial port
        ser = serial.Serial(port, baudrate, timeout=1)
        print(f"[INFO] Opened {port} at {baudrate} baud")
        time.sleep(0.5)
        
        # Verify command length
        cmd_bytes = COMMAND.encode('utf-8')
        print(f"[INFO] Command length: {len(cmd_bytes)} bytes")
        print(f"[INFO] JSON length: {len(JSON_CONFIG)} bytes")
        
        # Check for NULL bytes (should be ZERO!)
        null_count = cmd_bytes.count(b'\x00')
        if null_count > 0:
            print(f"[ERROR] Command contains {null_count} NULL bytes!")
            return False
        
        # Display first 100 and last 100 bytes
        print(f"\n[INFO] First 100 bytes:")
        print(cmd_bytes[:100].hex(' '))
        print(cmd_bytes[:100].decode('utf-8', errors='replace'))
        
        print(f"\n[INFO] Last 100 bytes:")
        print(cmd_bytes[-100:].hex(' '))
        print(cmd_bytes[-100:].decode('utf-8', errors='replace'))
        
        # Send command
        print(f"\n[INFO] Sending command...")
        bytes_sent = ser.write(cmd_bytes)
        ser.flush()
        time.sleep(0.1)
        
        print(f"[OK] Sent {bytes_sent}/{len(cmd_bytes)} bytes")
        
        # Wait for ACK
        print(f"\n[INFO] Waiting for ACK (5 seconds)...")
        time.sleep(5)
        
        # Read response
        if ser.in_waiting > 0:
            response = ser.read(ser.in_waiting)
            print(f"[RESPONSE] {len(response)} bytes:")
            print(response.decode('utf-8', errors='replace'))
        else:
            print(f"[WARN] No response received")
        
        ser.close()
        return True
        
    except serial.SerialException as e:
        print(f"[ERROR] Serial port error: {e}")
        return False
    except Exception as e:
        print(f"[ERROR] {e}")
        return False

if __name__ == '__main__':
    port = sys.argv[1] if len(sys.argv) > 1 else 'COM3'
    success = send_uart_command(port)
    sys.exit(0 if success else 1)
