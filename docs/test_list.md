# MODULE BASE SETTING - BLE TRIAL VERSION TEST PLAN

## Document Information
- **Version**: 1.0
- **Date**: February 14, 2026
- **Purpose**: Test plan for Module Base Setting architecture trial (BLE-only)
- **Scope**: Verify BLE module configuration via JSON and dynamic handler initialization

---

## Test Environment Setup

### Hardware Requirements
- ESP32-C6 LAN MCU board
- BLE module: STM32WB55 (Module ID: 002) connected to Stack 0
- ESP32-S3 WAN MCU board
- UART/SPI connection between LAN and WAN MCUs
- USB cable for debugging

### Software Requirements
- Firmware: DA2_esp_LAN (Module Base Setting trial version)
- PC App: Configuration tool for sending JSON configs
- Serial monitor: For log verification
- MQTT broker: For server communication tests

---

## PRE-TEST CHECKLIST

- [ ] 1. Firmware compiled successfully without Zigbee/LoRa/CAN references
- [ ] 2. BLE module physically connected to Stack 0 pins
- [ ] 3. UART connection between LAN-WAN MCUs verified
- [ ] 4. PC App configured to communicate with WAN MCU
- [ ] 5. Serial monitor connected to LAN MCU (115200 baud)

---

## TEST SEQUENCE

### **PHASE 1: SYSTEM INITIALIZATION** 🟢

#### Test 1.1: Boot and Module Detection
**Objective**: Verify system boots and detects BLE module

**Steps**:
1. Power on LAN MCU
2. Check serial log for initialization messages

**Expected Results**:
```
[stack_handler] Stack handler initialized
[stack_handler] Stack 0 module ID: 002 (BLE STM32WB)
[stack_handler] Stack 1 module ID: 000 (No module)
[config_global] Config globals initialized
[config_global] Stack 1 ID set to: 002
[config_global] Stack 2 ID set to: 000
```

**Pass Criteria**:
- ✅ Stack 0 reports module ID "002"
- ✅ Stack 1 reports module ID "000"
- ✅ No errors during initialization

---

#### Test 1.2: Config Global Variables
**Objective**: Verify global config variables initialized correctly

**Steps**:
1. Send config query command from PC App: `CFCQ`
2. Monitor WAN MCU response

**Expected Results**:
```
[WAN_DL] Config query request from WAN MCU
[WAN_DL] LAN config response sent: XXX bytes
  Stack 1 ID: 002
  Stack 2 ID: 000
  RS485 baudrate: 115200
  Stack 1 JSON: 0 bytes
  Stack 2 JSON: 0 bytes
```

**Pass Criteria**:
- ✅ WAN MCU receives correct stack IDs
- ✅ RS485 baudrate default = 115200
- ✅ JSON configs initially empty

---

### **PHASE 2: JSON CONFIG LOADING** 🟡

#### Test 2.1: Send BLE JSON Config
**Objective**: Load BLE module configuration via JSON

**Steps**:
1. Prepare BLE JSON config file (ble_config.json)
2. Send via PC App command: `CFBL:JSON:0:<json_content>`
3. Monitor serial logs

**Sample JSON Content** (shortened):
```json
{
  "module_id": "002",
  "module_type": "BLE",
  "module_name": "STM32WB_BLE_Gateway",
  "module_communication": {
    "port_type": "uart",
    "parameters": {
      "baudrate": 115200,
      "parity": "none",
      "stopbit": 1
    }
  },
  "functions": [
    {
      "function_name": "MODULE_HW_RESET",
      "command": "",
      "gpio_start_control": [{"pin": "RST", "state": "LOW"}],
      "delay_start": 100,
      "expect_response": "",
      "timeout": 0,
      "gpio_end_control": [{"pin": "RST", "state": "HIGH"}],
      "delay_end": 1000
    },
    {
      "function_name": "MODULE_SW_RESET",
      "command": "AT+RESET\\r\\n",
      "gpio_start_control": [],
      "delay_start": 0,
      "expect_response": "OK",
      "timeout": 2000,
      "gpio_end_control": [],
      "delay_end": 1000
    }
  ]
}
```

**Expected Results**:
```
[config_handler] BLE JSON config received: XXX bytes
[BLE_PARSER] Parsed function: MODULE_HW_RESET (ID=0)
[BLE_PARSER] Parsed function: MODULE_SW_RESET (ID=1)
[BLE_PARSER] BLE config parsed successfully: 20 functions
[config_global] Stack 1 JSON config saved (XXX bytes)
[module_monitor] Config loaded for Stack 0
```

**Pass Criteria**:
- ✅ JSON parsing successful (no errors)
- ✅ All 20 BLE functions parsed correctly
- ✅ JSON saved to g_stack_1_json_config
- ✅ Module Monitor Task acknowledges config

---

#### Test 2.2: Verify JSON Persistence
**Objective**: Confirm JSON config stored in global variables

**Steps**:
1. After Test 2.1, send config query: `CFCQ`
2. Verify response includes JSON config

**Expected Results**:
```
[WAN_DL] LAN config response sent: XXX bytes
  Stack 1 ID: 002
  Stack 2 ID: 000
  RS485 baudrate: 115200
  Stack 1 JSON: XXX bytes
  Stack 2 JSON: 0 bytes
```

**Pass Criteria**:
- ✅ Stack 1 JSON length > 0
- ✅ JSON content matches sent config

---

### **PHASE 3: BLE HANDLER INITIALIZATION** 🔵

#### Test 3.1: Initialize BLE Handler
**Objective**: BLE Handler middleware initializes with JSON config

**Steps**:
1. Module Monitor Task auto-starts BLE handler
2. Monitor initialization logs

**Expected Results**:
```
[BLE_HANDLER] Initializing BLE handler
[MOD_CTRL] Module config controller initialized
[MOD_CTRL] Initializing UART for stack 0
[MOD_CTRL] UART initialized for stack 0: baudrate=115200, parity=0
[BLE_HANDLER] BLE handler initialized for stack 0
```

**Pass Criteria**:
- ✅ UART communication initialized (115200 baud)
- ✅ No initialization errors
- ✅ BLE handler ready

---

#### Test 3.2: Communication Layer Verification
**Objective**: Verify BSP communication layer works

**Steps**:
1. BLE handler attempts first command
2. Monitor UART traffic and responses

**Expected Results**:
```
[module_uart_comm] Sending 10 bytes on stack 0
[module_uart_comm] Received 5 bytes on stack 0
```

**Pass Criteria**:
- ✅ UART send/receive working
- ✅ No communication errors

---

### **PHASE 4: FUNCTION EXECUTION TESTS** 🟣

#### Test 4.1: GPIO-Only Function (HW Reset)
**Objective**: Test GPIO control without UART command

**Steps**:
1. Execute: `ble_handler_hw_reset(0);`
2. Monitor GPIO and timing

**Expected Results**:
```
[BLE_HANDLER] Executing BLE function 0 on stack 0
[MOD_CTRL] GPIO pin RST set to LOW
[BLE_HANDLER] Waiting 100 ms before command
[MOD_CTRL] GPIO pin RST set to HIGH
[BLE_HANDLER] Waiting 1000 ms after GPIO sequences
[BLE_HANDLER] GPIO-only function 0 completed on stack 0 (took XXX ms)
```

**Pass Criteria**:
- ✅ RST pin goes LOW for 100ms
- ✅ RST pin goes HIGH
- ✅ Total delay ~1100ms
- ✅ Returns GPIO_OK response

---

#### Test 4.2: Command Function (SW Reset)
**Objective**: Test AT command execution with response

**Steps**:
1. Execute: `ble_handler_sw_reset(0);`
2. Monitor UART traffic

**Expected Results**:
```
[BLE_HANDLER] Executing BLE function 1 on stack 0
[BLE_HANDLER] Sending command: AT+RESET
[module_uart_comm] TX [12 bytes]: AT+RESET\r\n
[module_uart_comm] RX [4 bytes]: OK\r\n
[BLE_HANDLER] Response received: OK
[BLE_HANDLER] Function 1 completed successfully
```

**Pass Criteria**:
- ✅ Command sent correctly
- ✅ Response "OK" received within 2000ms timeout
- ✅ No errors

---

#### Test 4.3: Parametrized Function (Set Name)
**Objective**: Test command with parameter substitution

**Steps**:
1. Execute: `ble_handler_set_name(0, "Gateway001");`
2. Verify {PARAM} replacement

**Expected Results**:
```
[BLE_HANDLER] Executing BLE function 4 on stack 0
[BLE_HANDLER] Param: Gateway001
[BLE_HANDLER] Command after substitution: AT+NAME=Gateway001
[module_uart_comm] TX [23 bytes]: AT+NAME=Gateway001\r\n
[module_uart_comm] RX [4 bytes]: OK\r\n
[BLE_HANDLER] Function 4 completed successfully
```

**Pass Criteria**:
- ✅ {PARAM} replaced with "Gateway001"
- ✅ Command executed successfully
- ✅ BLE module name updated

---

### **PHASE 5: PC APP INTEGRATION TESTS** 🔴

#### Test 5.1: BLE Discovery Command
**Objective**: PC App sends scan command, receives streaming responses

**Steps**:
1. PC App sends: `CFBL:DISC:0:AT+SCAN:5000`
2. Monitor scan results streaming back

**Expected Results**:
```
[config_handler_ble] Starting BLE SCAN (stack=0, cmd_len=7, timeout=5000)
[BLE_HANDLER] Streaming scan started on stack 0
[WAN_UL] Uplink BLE stream: 45 bytes
[WAN_UL] Uplink BLE stream: 45 bytes
...
[config_handler_ble] BLE SCAN completed
[WAN_UL] Uplink: BR:SCAN:DONE
```

**Pass Criteria**:
- ✅ Scan command executed
- ✅ Multiple scan results streamed to WAN MCU
- ✅ DONE message received by PC App
- ✅ PC App displays discovered devices

---

#### Test 5.2: BLE Setup Command
**Objective**: PC App executes setup commands (connect, send data)

**Steps**:
1. PC App sends: `CFBL:SETUP:0:AT+CONNECT=<MAC>:2000`
2. Verify connection established

**Expected Results**:
```
[config_handler_ble] Starting BLE SETUP command
[BLE_HANDLER] Sending command: AT+CONNECT=XX:XX:XX:XX:XX:XX
[module_uart_comm] RX [12 bytes]: CONNECTED\r\n
[BLE_HANDLER] Setup completed successfully
[WAN_UL] Uplink: BR:SETUP:OK
```

**Pass Criteria**:
- ✅ Connect command successful
- ✅ BLE device connected
- ✅ PC App receives OK response

---

### **PHASE 6: ERROR HANDLING TESTS** ⚠️

#### Test 6.1: Invalid JSON Config
**Objective**: System rejects malformed JSON

**Steps**:
1. Send invalid JSON (missing fields, wrong format)
2. Verify error handling

**Expected Results**:
```
[JSON_PARSER] Missing or invalid 'port_type' field
[config_handler] Failed to parse BLE JSON config
[config_handler] Error: ESP_ERR_INVALID_ARG
```

**Pass Criteria**:
- ✅ JSON parsing fails gracefully
- ✅ Error logged clearly
- ✅ System remains stable (no crash)

---

#### Test 6.2: Timeout Handling
**Objective**:Command timeout handled correctly

**Steps**:
1. Execute command that won't get response
2. Verify timeout triggers

**Expected Results**:
```
[BLE_HANDLER] Sending command: AT+INVALID
[BLE_HANDLER] Waiting for response (timeout=2000ms)...
[BLE_HANDLER] Response timeout after 2000ms
[BLE_HANDLER] Command failed: ESP_ERR_TIMEOUT
```

**Pass Criteria**:
- ✅ Timeout after configured duration
- ✅ Error code returned
- ✅ Handler continues operating

---

#### Test 6.3: Communication Failure
**Objective**: System handles UART failures

**Steps**:
1. Disconnect BLE module UART
2. Execute command
3. Verify error handling

**Expected Results**:
```
[module_uart_comm] UART send failed: ESP_FAIL
[BLE_HANDLER] Bus write error
[BLE_HANDLER] Command execution failed
```

**Pass Criteria**:
- ✅ Communication error detected
- ✅ No system crash
- ✅ Error propagated to caller

---

### **PHASE 7: MULTI-PROTOCOL VERIFICATION** 🌐

#### Test 7.1: RS485 and BLE Coexistence
**Objective**: Verify BLE and RS485 can operate simultaneously

**Steps**:
1. Configure RS485 on Stack 1 (if available)
2. Execute BLE command on Stack 0
3. Execute RS485 command on Stack 1
4. Verify no interference

**Expected Results**:
```
[BLE_HANDLER] Stack 0: BLE command executing
[RS485_HANDLER] Stack 1: RS485 command executing
[BLE_HANDLER] Stack 0: Command completed
[RS485_HANDLER] Stack 1: Command completed
```

**Pass Criteria**:
- ✅ Both protocols work independently
- ✅ No bus contention
- ✅ Correct routing to each stack

---

#### Test 7.2: Config Query with Multiple Stacks
**Objective**: WAN MCU gets correct config for all stacks

**Steps**:
1. Configure Stack 0 with BLE JSON
2. Configure Stack 1 with RS485 baudrate
3. Send CFCQ query

**Expected Results**:
```
stack1_id=002|
stack2_id=000|
rs485_baudrate=9600|
stack1_json_len=XXX|
<BLE JSON content>
stack2_json_len=0|
```

**Pass Criteria**:
- ✅ All config params present
- ✅ JSON configs included correctly
- ✅ No truncation

---

### **PHASE 8: STRESS TESTS** 💪

#### Test 8.1: Rapid Command Execution
**Objective**: Handler stable under rapid commands

**Steps**:
1. Execute 100 BLE commands in quick succession
2. Monitor for errors or memory leaks

**Expected Results**:
- All commands executed successfully
- No memory leaks (heap stable)
- Response times consistent

**Pass Criteria**:
- ✅ 100% success rate
- ✅ No crashes
- ✅ Average latency < 100ms per command

---

#### Test 8.2: Long-Running Operations
**Objective**: System stable during extended scan

**Steps**:
1. Start BLE scan for 60 seconds
2. Monitor system resources

**Expected Results**:
- Scan completes successfully
- System responsive
- No watchdog resets

**Pass Criteria**:
- ✅ Scan runs full duration
- ✅ All results captured
- ✅ Task switching normal

---

## POST-TEST CHECKLIST

- [ ] 1. All Phase 1-8 tests passed
- [ ] 2. No memory leaks detected
- [ ] 3. System stable after 1-hour runtime
- [ ] 4. Logs reviewed for warnings/errors
- [ ] 5. Performance metrics documented

---

## TEST RESULTS SUMMARY

| Phase | Test ID | Description | Status | Notes |
|-------|---------|-------------|--------|-------|
| 1 | 1.1 | Boot and Module Detection | ⬜ PENDING | |
| 1 | 1.2 | Config Global Variables | ⬜ PENDING | |
| 2 | 2.1 | Send BLE JSON Config | ⬜ PENDING | |
| 2 | 2.2 | Verify JSON Persistence | ⬜ PENDING | |
| 3 | 3.1 | Initialize BLE Handler | ⬜ PENDING | |
| 3 | 3.2 | Communication Layer | ⬜ PENDING | |
| 4 | 4.1 | GPIO-Only Function | ⬜ PENDING | |
| 4 | 4.2 | Command Function | ⬜ PENDING | |
| 4 | 4.3 | Parametrized Function | ⬜ PENDING | |
| 5 | 5.1 | BLE Discovery Command | ⬜ PENDING | |
| 5 | 5.2 | BLE Setup Command | ⬜ PENDING | |
| 6 | 6.1 | Invalid JSON Config | ⬜ PENDING | |
| 6 | 6.2 | Timeout Handling | ⬜ PENDING | |
| 6.3 | Communication Failure | ⬜ PENDING | |
| 7 | 7.1 | RS485 and BLE Coexistence | ⬜ PENDING | |
| 7 | 7.2 | Config Query Multiple Stacks | ⬜ PENDING | |
| 8 | 8.1 | Rapid Command Execution | ⬜ PENDING | |
| 8 | 8.2 | Long-Running Operations | ⬜ PENDING | |

**Legend**:
- ⬜ PENDING
- ✅ PASSED
- ❌ FAILED
- ⚠️ PARTIAL

---

## KNOWN ISSUES & WORKAROUNDS

### Issue 1: USB Communication Not Implemented
**Impact**: Cannot test USB port type
**Workaround**: Use UART for all tests
**Status**: Expected - USB deferred to production

### Issue 2: CAN/LoRa/Zigbee Deprecated
**Impact**: Config commands for these protocols return "unknown"
**Workaround**: This is intentional for trial version
**Status**: Working as designed

---

## FUTURE ENHANCEMENTS

1. **Multi-Module JSON Loading**: Support JSON configs for Zigbee, LoRa
2. **Runtime Module Detection**: Auto-detect module type without hardcoding
3. **NVS Persistence**: Save/load JSON configs from flash
4. **OTA Config Updates**: Update JSON without firmware flash
5. **Web UI Config Editor**: Browser-based JSON config generator

---

## APPENDIX A: Test Commands Quick Reference

```bash
# Config Query
CFCQ

# BLE JSON Load (Stack 0)
CFBL:JSON:0:<json_content>

# BLE Discovery Scan
CFBL:DISC:0:AT+SCAN:5000

# BLE Setup Command
CFBL:SETUP:0:AT+CONNECT=<MAC>:2000

# Get Module Info
CFBL:SETUP:0:AT+VER:500
```

---

## APPENDIX B: Expected Log Patterns

### Successful Boot
```
[stack_handler] Stack 0 module ID: 002 (BLE STM32WB)
[config_global] Stack 1 ID set to: 002
[BLE_HANDLER] BLE handler initialized for stack 0
```

### Successful Command
```
[BLE_HANDLER] Executing BLE function X
[module_uart_comm] TX [XX bytes]
[module_uart_comm] RX [XX bytes]
[BLE_HANDLER] Function X completed successfully
```

### Error Pattern
```
[XXX] Error: ESP_ERR_XXXX
[XXX] Failed to ...
```

---

## TEST COMPLETION SIGN-OFF

**Tested By**: _____________________  
**Date**: _____________________  
**Firmware Version**: _____________________  
**Overall Result**: PASS / FAIL / PARTIAL  

**Comments**:
_________________________________________
_________________________________________
_________________________________________

---

## APPENDIX C: ESP32-C6 BLE LED Integration Test

> **Target**: ESP32C6_LED (BLE Peripheral) ↔ STM32WB Module (Central)  
> **Purpose**: Test bật/tắt LED trên ESP32C6 qua AT commands

---

### C.1 BLE GATT Handle Layout (ESP32C6 Arduino BLE)

Khi ESP32C6 khởi động, GATT table được tạo như sau:

| Handle | Attribute Type | Description |
|--------|---------------|-------------|
| `0x0001` | Service Declaration | Generic Access (0x1800) |
| `0x0002` | Char Declaration | Device Name |
| `0x0003` | Char Value | Device Name = "ESP32C6_LED" |
| `0x0004` | Service Declaration | Generic Attribute (0x1801) |
| `0x0005` | Char Declaration | Service Changed |
| ... | ... | ... |
| `0x000E` | **Service Declaration** | **Custom Service FFE0** |
| `0x000F` | Char Declaration | FFE1 (READ\|WRITE\|NOTIFY) |
| `0x0010` | **Char Value (FFE1)** | **← WRITE LED tại đây** |
| `0x0011` | **CCCD Descriptor** | **← NOTIFY enable tại đây** |

> ⚠️ **Lưu ý quan trọng**:  
> - `AT+WRITE`: dùng handle `0x0010` (char value)  
> - `AT+NOTIFY`: dùng handle `0x0011` (CCCD), KHÔNG phải `0x000F`

---

### C.2 LED Control Values

| Value (hex) | Lệnh AT | Kết quả |
|-------------|---------|---------|
| `01` | `AT+WRITE=0,0x0010,01` | LED ON |
| `00` | `AT+WRITE=0,0x0010,00` | LED OFF |

---

### C.3 Full Test Sequence

#### Bước 1: Scan tìm ESP32C6

```
AT+SCAN=5000
```

**Expected output**:
```
+SCAN:XX:XX:XX:XX:XX:XX,ESP32C6_LED,-65,1
...
OK
```

Ghi nhớ địa chỉ MAC của thiết bị `ESP32C6_LED`.

---

#### Bước 2: Xem danh sách devices đã scan

```
AT+LIST
```

**Expected output**:
```
+DEVICE:0,XX:XX:XX:XX:XX:XX,ESP32C6_LED,-65
OK
```

Ghi nhớ **index** (ví dụ: `0`) để dùng cho các lệnh tiếp theo.

---

#### Bước 3: Kết nối đến ESP32C6

```
AT+CONNECT=0
```

*(hoặc dùng MAC trực tiếp: `AT+CONNECT=XX:XX:XX:XX:XX:XX`)*

**Expected output**:
```
+CONNECTED:0,0xXXXX
OK
```

---

#### Bước 4: Discover Services

```
AT+DISC=0
```

**Expected output**:
```
OK
+SERVICE:0x0001,0x0003,0x1800
+SERVICE:0x0004,0x0005,0x1801
+SERVICE:0x000E,0xFFFF,0xFFE0
```

Xác nhận service `FFE0` tại handle range `0x000E → 0xFFFF`.

---

#### Bước 5: Discover Characteristics (tùy chọn - để xác nhận handles)

```
AT+CHARS=0,0x000E,0xFFFF
```

**Expected output**:
```
OK
+CHAR:0x000F,0x1E,0x0010,0xFFE1
```

Giải mã: `decl_handle=0x000F`, `properties=0x1E` (READ+WRITE+NOTIFY), `value_handle=0x0010`, `UUID=FFE1`  
→ **CCCD handle = `0x0010 + 1 = 0x0011`**

---

#### Bước 6: Bật LED (LED ON)

```
AT+WRITE=0,0x0010,01
```

**Expected output**:
```
OK
```

ESP32C6 Serial Monitor sẽ hiển thị:
```
[LED] Write: 0x01 -> LED ON
```

---

#### Bước 7: Tắt LED (LED OFF)

```
AT+WRITE=0,0x0010,00
```

**Expected output**:
```
OK
```

ESP32C6 Serial Monitor sẽ hiển thị:
```
[LED] Write: 0x00 -> LED OFF
```

---

#### Bước 8: Enable Notification (nhận trạng thái LED từ ESP32C6)

```
AT+NOTIFY=0,0x0011,1
```

**Expected output**:
```
OK
```

Sau đó khi LED thay đổi trạng thái, STM32WB sẽ nhận:
```
+NOTIFY:0,0x0010,01
```
hoặc
```
+NOTIFY:0,0x0010,00
```

---

#### Bước 9: Disable Notification

```
AT+NOTIFY=0,0x0011,0
```

**Expected output**:
```
OK
```

---

#### Bước 10: Đọc trạng thái LED hiện tại

```
AT+READ=0,0x0010
```

**Expected output**:
```
+READ:0,0x0010,01
OK
```
*(giá trị `01` = LED đang ON)*

---

#### Bước 11: Ngắt kết nối

```
AT+DISCONNECT=0
```

**Expected output**:
```
+DISCONNECTED:0
OK
```

---

### C.4 Quick Test Sequence (Copy-paste)

```
AT+SCAN=5000
AT+LIST
AT+CONNECT=0
AT+DISC=0
AT+CHARS=0,0x000E,0xFFFF
AT+WRITE=0,0x0010,01
AT+WRITE=0,0x0010,00
AT+NOTIFY=0,0x0011,1
AT+DISCONNECT=0
```

---

### C.5 Test Results

| Step | Command | Expected | Status | Notes |
|------|---------|----------|--------|-------|
| 1 | `AT+SCAN=5000` | Thấy ESP32C6_LED | ⬜ | |
| 2 | `AT+LIST` | Index + MAC + Name | ⬜ | |
| 3 | `AT+CONNECT=0` | +CONNECTED:0,0xXXXX | ⬜ | |
| 4 | `AT+DISC=0` | +SERVICE:0x000E,...,0xFFE0 | ⬜ | |
| 5 | `AT+CHARS=0,0x000E,0xFFFF` | +CHAR:...,0x0010,0xFFE1 | ⬜ | |
| 6 | `AT+WRITE=0,0x0010,01` | OK + LED bật sáng | ⬜ | |
| 7 | `AT+WRITE=0,0x0010,00` | OK + LED tắt | ⬜ | |
| 8 | `AT+NOTIFY=0,0x0011,1` | OK | ⬜ | |
| 9 | `AT+NOTIFY=0,0x0011,0` | OK | ⬜ | |
| 10 | `AT+READ=0,0x0010` | +READ:0,0x0010,XX | ⬜ | |
| 11 | `AT+DISCONNECT=0` | +DISCONNECTED:0 | ⬜ | |

---

### C.6 Troubleshooting

| Lỗi | Nguyên nhân | Giải pháp |
|-----|-------------|-----------|
| `AT+NOTIFY=0,0x000F,1` → ERROR | Handle `0x000F` là char declaration, không phải CCCD | Dùng handle `0x0011` (CCCD) |
| `AT+WRITE=0,0x000F,01` → ERROR | `0x000F` là declaration handle, không write được | Dùng handle `0x0010` (char value) |
| Scan không thấy ESP32C6 | ESP32 chưa boot hoặc đang connected với device khác | Reset ESP32, chờ advertising |
| WRITE → OK nhưng LED không sáng | Sai GPIO pin hoặc ESP32 chưa chạy firmware | Kiểm tra Serial Monitor ESP32, verify GPIO8 |

---

**End of Test Plan**
