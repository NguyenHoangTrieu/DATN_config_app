# TODO: BLE Command Refactor - Prefix Pattern

## Mục tiêu
Thống nhất xử lý BLE commands thành 2 loại:
- **Non-Prefix Commands**: Command chuẩn từ JSON, thực hiện trực tiếp (reset, get version...)
- **Prefix Commands**: Command động từ server/PC app, parser prefix để match function (scan, connect...)

## Những gì sẽ làm

### 1. Cập nhật JSON Config
**File**: `DA2_esp_LAN/Middleware/BLE_Handler/ble_config.json`

- ✅ Thêm field `"is_prefix": true/false` cho mỗi function
- **Non-prefix** (is_prefix = false):
  - MODULE_HW_RESET
  - MODULE_SW_RESET  
  - MODULE_FACTORY_RESET
  - MODULE_GET_INFO
  - MODULE_ENTER_CMD_MODE
  - MODULE_START_BROADCAST
  - MODULE_GET_CONNECTION_STATUS
  - MODULE_ENTER_SLEEP
  - MODULE_WAKEUP
  
- **Prefix** (is_prefix = true):
  - MODULE_START_DISCOVERY (prefix: "AT+SCAN")
  - MODULE_CONNECT (prefix: "AT+CONNECT=")
  - MODULE_DISCONNECT (prefix: "AT+DISCONNECT=")
  - MODULE_SEND_DATA (prefix: "AT+WRITE=")
  - MODULE_SET_NAME (prefix: "AT+NAME=")
  - MODULE_SET_COMM_CONFIG (prefix: "AT+UART=")
  - MODULE_SET_RF_PARAMS (prefix: "AT+RF=")
  - MODULE_ENTER_DATA_MODE (prefix: "AT+DATAMODE=")
  - MODULE_GET_DIAGNOSTICS (prefix: "AT+INFO=")
  - MODULE_DISCOVER_SERVICES (prefix: "AT+DISC=")
  - MODULE_DISCOVER_CHARACTERISTICS (prefix: "AT+CHARS=")

### 2. Cập nhật JSON Parser
**File**: `DA2_esp_LAN/Middleware/JSON_Config_Parser/src/json_ble_config_parser.c`

- ✅ Parse field `is_prefix` từ JSON
- ✅ Lưu vào struct `ble_function_config_t`

**File**: `DA2_esp_LAN/Middleware/JSON_Config_Parser/include/json_ble_config_parser.h`

- ✅ Thêm `bool is_prefix` vào struct `ble_function_config_t`

### 3. Tạo hàm mới: `config_parse_ble_command()`
**File**: `DA2_esp_LAN/Application/Config_Handler/src/config_handler_ble_commands.c`

**Input**: 
- Command string từ server (ví dụ: `"AT+SCAN=5000"`)
- Stack ID

**Logic**:
1. Loop qua tất cả functions trong JSON config
2. So sánh prefix với command string
3. Nếu match:
   - Lấy GPIO control, delay_start, timeout, delay_end
   - Gọi `ble_handler_send_command()` với full command từ server
   - Return function_name matched

**Return**: Function name matched hoặc NULL

### 4. Xóa các hàm cũ
**File**: `DA2_esp_LAN/Application/Config_Handler/src/config_handler_ble_commands.c`

- ❌ Xóa `config_parse_ble_scan()`
- ❌ Xóa `config_parse_ble_setup()`

**File**: `DA2_esp_LAN/Application/Config_Handler/include/config_handler_ble_commands.h`

- ❌ Xóa khai báo 2 hàm trên
- ✅ Thêm khai báo `config_parse_ble_command()`

### 5. Xóa hàm riêng trong BLE Handler Middleware
**File**: `DA2_esp_LAN/Middleware/BLE_Handler/src/ble_handler.c`

- ❌ Xóa `ble_handler_start_discovery()` (vì MODULE_START_DISCOVERY là prefix)
- ❌ Xóa các hàm specific khác cho prefix commands (nếu có)
- ✅ Giữ lại các hàm non-prefix (reset, get_info...)

**File**: `DA2_esp_LAN/Middleware/BLE_Handler/include/ble_handler.h`

- ❌ Xóa khai báo các hàm trên

### 6. Cập nhật Config Handler chính
**File**: `DA2_esp_LAN/Application/Config_Handler/src/config_handler.c`

- ✅ Replace calls từ `config_parse_ble_scan()` → `config_parse_ble_command()`
- ✅ Replace calls từ `config_parse_ble_setup()` → `config_parse_ble_command()`

### 7. Cập nhật BLE Handler Task
**File**: `DA2_esp_LAN/Application/BLE_Handler/src/ble_handler_task.c`

- ✅ Kiểm tra các calls tới hàm đã xóa
- ✅ Replace bằng generic command sender

## Flow mới

### Non-Prefix Command (từ baseboard)
```
Baseboard init → Load JSON → Execute exact command
Example: AT+RESET\r\n (y hệt JSON)
```

### Prefix Command (từ server/PC app) ví dụ cho AT+SCAN=5000, các command khác tương tự
```
Server → CFBL:0:"AT+SCAN=5000"
  ↓
config_parse_ble_command()
  ↓
Match prefix "AT+SCAN" → MODULE_START_DISCOVERY
  ↓
Get GPIO/delay/timeout from JSON
  ↓
ble_handler_send_command("AT+SCAN=5000") với controls từ JSON
```

## Files cần sửa (tổng cộng 8 files)

1. ✅ `ble_config.json` - Thêm is_prefix
2. ✅ `json_ble_config_parser.h` - Thêm field vào struct
3. ✅ `json_ble_config_parser.c` - Parse is_prefix
4. ✅ `config_handler_ble_commands.h` - Xóa 2 hàm cũ, thêm hàm mới
5. ✅ `config_handler_ble_commands.c` - Implement hàm mới, xóa 2 hàm cũ
6. ✅ `config_handler.c` - Update calls
7. ✅ `ble_handler.h` - Xóa khai báo hàm specific
8. ✅ `ble_handler.c` - Xóa implementation hàm specific

## Confirm?
- [x] Logic đúng chưa?
- [x] Có thêm file nào cần sửa không?
- [x] Có function nào cần giữ lại không?

---

## ✅ REFACTOR COMPLETED - SUMMARY

### Đã xóa các hàm PREFIX commands không cần thiết:
- ❌ `ble_handler_start_discovery()` - Xóa (PREFIX: AT+SCAN)
- ❌ `ble_handler_set_name()` - Xóa (PREFIX: AT+NAME=)
- ❌ `ble_handler_set_comm_config()` - Xóa (PREFIX: AT+UART=)
- ❌ `ble_handler_set_rf_params()` - Xóa (PREFIX: AT+RF=)
- ❌ `ble_handler_enter_data_mode()` - Xóa (PREFIX: AT+DATAMODE=)
- ❌ `ble_handler_connect()` - Xóa (PREFIX: AT+CONNECT=)
- ❌ `ble_handler_disconnect()` - Xóa (PREFIX: AT+DISCONNECT=)

### Giữ lại các hàm NON-PREFIX (baseboard init):
- ✅ `ble_handler_hw_reset()` - NON-PREFIX
- ✅ `ble_handler_sw_reset()` - NON-PREFIX  
- ✅ `ble_handler_factory_reset()` - NON-PREFIX
- ✅ `ble_handler_get_info()` - NON-PREFIX
- ✅ `ble_handler_enter_cmd_mode()` - NON-PREFIX
- ✅ `ble_handler_start_broadcast()` - NON-PREFIX
- ✅ `ble_handler_get_connection_status()` - NON-PREFIX
- ✅ `ble_handler_enter_sleep()` - NON-PREFIX
- ✅ `ble_handler_wakeup()` - NON-PREFIX

### API mới thống nhất:
- ✅ `ble_handler_get_function_by_command()` - Match prefix từ JSON
- ✅ `ble_handler_execute_command_with_config()` - Execute với GPIO/delays từ JSON
- ✅ `config_parse_ble_command()` - Unified parser cho tất cả BLE commands

### Flow hoàn chỉnh:
```
Server/PC App → "CFBL:0:AT+SCAN=5000"
    ↓
config_parse_ble_command() - Match prefix "AT+SCAN"
    ↓
Get GPIO/delays/timeout from JSON config
    ↓
Enqueue command + config → Task Queue
    ↓
ble_handler_execute_command_with_config() - Execute với full control
```
