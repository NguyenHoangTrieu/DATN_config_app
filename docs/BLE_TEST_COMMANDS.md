# BLE Module Test Commands

## 1. Load BLE Configuration (JSON)

### Full JSON Config for Stack 0
```
CFBL:JSON:0:{"module_id":"002","module_type":"BLE","module_name":"STM32WB_BLE","module_communication":{"port_type":"uart","parameters":{"baudrate":115200,"parity":"none","stopbit":1}},"functions":[{"function_name":"MODULE_HW_RESET","command":"","is_prefix":false,"gpio_start_control":[{"pin":"01","state":"LOW"}],"delay_start":100,"expect_response":"","timeout":0,"gpio_end_control":[{"pin":"01","state":"HIGH"}],"delay_end":1000},{"function_name":"MODULE_SW_RESET","command":"AT+RESET\r\n","is_prefix":false,"gpio_start_control":[],"delay_start":0,"expect_response":"OK","timeout":2000,"gpio_end_control":[],"delay_end":500},{"function_name":"MODULE_GET_INFO","command":"AT+VERSION?\r\n","is_prefix":false,"gpio_start_control":[],"delay_start":0,"expect_response":"OK","timeout":1000,"gpio_end_control":[],"delay_end":0},{"function_name":"MODULE_ENTER_CMD_MODE","command":"+++","is_prefix":false,"gpio_start_control":[],"delay_start":0,"expect_response":"OK","timeout":1000,"gpio_end_control":[],"delay_end":100},{"function_name":"MODULE_START_DISCOVERY","command":"AT+SCAN=1\r\n","is_prefix":false,"gpio_start_control":[],"delay_start":0,"expect_response":"OK","timeout":30000,"gpio_end_control":[],"delay_end":0},{"function_name":"MODULE_CONNECT","command":"AT+CONNECT=","is_prefix":true,"gpio_start_control":[],"delay_start":0,"expect_response":"CONNECTED","timeout":10000,"gpio_end_control":[],"delay_end":0},{"function_name":"MODULE_DISCONNECT","command":"AT+DISCONNECT\r\n","is_prefix":false,"gpio_start_control":[],"delay_start":0,"expect_response":"OK","timeout":2000,"gpio_end_control":[],"delay_end":0},{"function_name":"MODULE_SEND_DATA","command":"AT+SEND=","is_prefix":true,"gpio_start_control":[],"delay_start":0,"expect_response":"OK","timeout":1000,"gpio_end_control":[],"delay_end":0}]}
```

### Minified JSON Config for Stack 1 (Compact version)
```
CFBL:JSON:1:{"module_id":"003","module_type":"BLE","module_name":"BLE_Stack_1","module_communication":{"port_type":"uart","parameters":{"baudrate":115200,"parity":"none","stopbit":1}},"functions":[{"function_name":"MODULE_HW_RESET","command":"","is_prefix":false,"gpio_start_control":[{"pin":"11","state":"LOW"}],"delay_start":100,"expect_response":"","timeout":0,"gpio_end_control":[{"pin":"11","state":"HIGH"}],"delay_end":1000},{"function_name":"MODULE_ENTER_CMD_MODE","command":"+++","is_prefix":false,"gpio_start_control":[],"delay_start":0,"expect_response":"OK","timeout":1000,"gpio_end_control":[],"delay_end":100}]}
```

---

## 2. BLE Command Tests (After Loading Config)

### Basic Commands

#### Hardware Reset (GPIO-based)
```
CFBL:0:MODULE_HW_RESET
```

#### Software Reset
```
CFBL:0:MODULE_SW_RESET
```

#### Get Module Info/Version
```
CFBL:0:MODULE_GET_INFO
```

#### Enter Command Mode
```
CFBL:0:MODULE_ENTER_CMD_MODE
```

---

### Discovery & Connection

#### Start BLE Scan/Discovery
```
CFBL:0:MODULE_START_DISCOVERY
```

#### Connect to Device (with MAC address)
```
CFBL:0:MODULE_CONNECT:AA:BB:CC:DD:EE:FF
```

#### Disconnect from Device
```
CFBL:0:MODULE_DISCONNECT
```

---

### Data Transfer

#### Send Data (hex format)
```
CFBL:0:MODULE_SEND_DATA:48656C6C6F
```

#### Send Data (with service UUID)
```
CFBL:0:MODULE_SEND_DATA:0000180F-0000-1000-8000-00805F9B34FB:48656C6C6F
```

---

## 3. Other Configuration Commands

### Scan All Configs (CFSC)
```
CFSC
```
Response will include WAN + LAN configs.

### RS485 Baudrate Config
```
CFRS:BR:115200
```

Valid baudrates: 9600, 19200, 38400, 57600, 115200

### FOTA Update
```
CFFW:https://firmware-server.com/lan_mcu_v1.2.3.bin
```

With force flag:
```
CFFW:https://firmware-server.com/lan_mcu_v1.2.3.bin:FORCE
```

---

## 4. Test Sequence Example

### Complete BLE Module Test Flow

```bash
# Step 1: Load BLE configuration for Stack 0
CFBL:JSON:0:{"module_id":"002","module_type":"BLE","module_name":"STM32WB_BLE","module_communication":{"port_type":"uart","parameters":{"baudrate":115200,"parity":"none","stopbit":1}},"functions":[{"function_name":"MODULE_HW_RESET","command":"","is_prefix":false,"gpio_start_control":[{"pin":"01","state":"LOW"}],"delay_start":100,"expect_response":"","timeout":0,"gpio_end_control":[{"pin":"01","state":"HIGH"}],"delay_end":1000},{"function_name":"MODULE_ENTER_CMD_MODE","command":"+++","is_prefix":false,"gpio_start_control":[],"delay_start":0,"expect_response":"OK","timeout":1000,"gpio_end_control":[],"delay_end":100},{"function_name":"MODULE_START_DISCOVERY","command":"AT+SCAN=1\r\n","is_prefix":false,"gpio_start_control":[],"delay_start":0,"expect_response":"OK","timeout":30000,"gpio_end_control":[],"delay_end":0},{"function_name":"MODULE_CONNECT","command":"AT+CONNECT=","is_prefix":true,"gpio_start_control":[],"delay_start":0,"expect_response":"CONNECTED","timeout":10000,"gpio_end_control":[],"delay_end":0}]}

# Wait 2 seconds for config to load

# Step 2: Hardware reset to initialize module
CFBL:0:MODULE_HW_RESET

# Wait 2 seconds

# Step 3: Enter command mode
CFBL:0:MODULE_ENTER_CMD_MODE

# Wait 500ms

# Step 4: Start BLE discovery
CFBL:0:MODULE_START_DISCOVERY

# Wait for scan results (up to 30 seconds)

# Step 5: Connect to discovered device
CFBL:0:MODULE_CONNECT:AA:BB:CC:DD:EE:FF

# Wait for connection

# Step 6: Send test data
CFBL:0:MODULE_SEND_DATA:48656C6C6F576F726C64
```

---

## 5. Error Cases to Test

### Oversized Config (Should reject with ERROR:CONFIG_TOO_LARGE)
```
CFBL:JSON:0:{"module_id":"002","module_type":"BLE"... [JSON larger than 4KB] ...}
```

### Invalid Stack ID
```
CFBL:2:MODULE_HW_RESET
```
Expected: Error (only stack 0 and 1 supported)

### Unknown Command
```
CFBL:0:INVALID_COMMAND
```
Expected: Error or no match

### Missing Config (Command before loading JSON)
```
CFBL:0:MODULE_START_DISCOVERY
```
Expected: Error if config not loaded yet

---

## 6. Response Format

All commands return one of:
- `OK:CMD_QUEUED` - Command accepted and queued
- `ERROR:CONFIG_TOO_LARGE` - Config exceeds 4KB limit
- `ERROR:QUEUE_FULL` - Config handler queue is full
- `ERROR:NO_HANDLER` - Config handler not initialized
- `ERROR:UNKNOWN_CMD` - Unknown command type

---

## 7. Notes

- **Stack IDs**: 0 or 1 (two independent BLE modules supported)
- **GPIO Pin Format**: "XY" where X=stack (0/1), Y=pin number (0-8)
  - Stack 0 pins: "01", "02", "03", etc.
  - Stack 1 pins: "11", "12", "13", etc.
- **Command Prefix**: `is_prefix=true` means command expects additional parameters
  - Example: `AT+CONNECT=` expects MAC address
- **Max Config Size**: 4096 bytes (increased from 256)
- **Timeout Values**: In milliseconds (0 = no wait)
- **Delays**: In milliseconds

---

## 8. Compact Test Commands (Copy-Paste Ready)

```
CFBL:JSON:0:{"module_id":"002","module_type":"BLE","module_name":"STM32WB_BLE","module_communication":{"port_type":"uart","parameters":{"baudrate":115200,"parity":"none","stopbit":1}},"functions":[{"function_name":"MODULE_HW_RESET","command":"","is_prefix":false,"gpio_start_control":[{"pin":"01","state":"LOW"}],"delay_start":100,"expect_response":"","timeout":0,"gpio_end_control":[{"pin":"01","state":"HIGH"}],"delay_end":1000},{"function_name":"MODULE_ENTER_CMD_MODE","command":"+++","is_prefix":false,"gpio_start_control":[],"delay_start":0,"expect_response":"OK","timeout":1000,"gpio_end_control":[],"delay_end":100},{"function_name":"MODULE_START_DISCOVERY","command":"AT+SCAN=1\r\n","is_prefix":false,"gpio_start_control":[],"delay_start":0,"expect_response":"OK","timeout":30000,"gpio_end_control":[],"delay_end":0}]}
CFBL:0:MODULE_HW_RESET
CFBL:0:MODULE_ENTER_CMD_MODE
CFBL:0:MODULE_START_DISCOVERY
CFSC
```
