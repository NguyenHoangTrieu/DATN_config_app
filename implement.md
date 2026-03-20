# Implementation Plan: ESP32 Gateway Configuration Tool v5.0

> **Trạng thái**: Thiết kế – chờ phê duyệt trước khi implement
> **Phiên bản trước**: v4.0 (gửi AT command trực tiếp từ UI)

---

## 📋 Tổng quan thay đổi so với v4.0

| Hạng mục | v4.0 (cũ) | v5.0 (mới) |
|----------|-----------|-----------|
| **Basic mode – tab module** | Hiển thị khi stack ID khớp; có button gửi lệnh cơ bản | Hiển thị khi stack ID khớp; **chỉ đọc thông tin** (Info Card), không gửi lệnh |
| **Advanced mode – tab module** | Hiển thị khi stack ID khớp; gửi AT command trực tiếp | **Luôn hiển thị** 3 tab đầy đủ; xây dựng và gửi **JSON config**, không gửi AT command |
| **Giao tiếp vật lý** | Chỉ UART qua COM port | **UART / SPI / I2C / USB** (phản ánh đúng firmware) |
| **Connection bar** | COM port + Baud | COM port + **Type** + Baud |

---

## 🎯 Mục tiêu thiết kế

1. **Basic mode = Module Info Viewer**: Tab module chỉ xuất hiện khi stack ID của gateway khớp trong `stack_id_map.json`; nội dung là thẻ thông tin read-only (tên module, ID, comm type, baudrate).
2. **Advanced mode = JSON Config Builder**: Tab BLE / LoRa / Zigbee luôn hiển thị; mọi cấu hình module thông qua form → preview JSON → gửi `CFBL:JSON:` / `CFLR:JSON:` / `CFZB:JSON:`.
3. **Không gửi AT command trực tiếp** trong bất kỳ tab module nào (BLE / Zigbee / LoRa).
4. **Hỗ trợ đầy đủ** UART / SPI / I2C / USB trong connection bar và trong `module_communication` của JSON config được tạo.

---

## 🖼️ Layout tổng thể (giữ nguyên từ v4.0)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ 🔌 ESP32 Gateway Configuration Tool                           [_][□][X]   │
├────────────────────────────────────────────────────────────────────────────┤
│ Port:[COM3▼] [Refresh] [🔍 Scan]  Type:[UART▼]  Baud:[115200▼] [Connect] │
├────────────────────────────────────────────────────────────────────────────┤
│ ☐ Advanced Mode   [📖 Read Config] [💾 Save] [📂 Load]                    │
├──────────────────────────────────────┬─────────────────────────────────────┤
│                                      │                                     │
│   ┌─ CONFIGURATION ────────────────┐ │ ┌─ UART LOG ─────────────────────┐ │
│   │  [Tabs]                        │ │ │  Raw data từ gateway            │ │
│   │  << TAB CONTENT >>             │ │ │  (luôn hiển thị)                │ │
│   │                                │ │ └─────────────────────────────────┘ │
│   └────────────────────────────────┘ │                                     │
├──────────────────────────────────────┴─────────────────────────────────────┤
│ ┌─ DEBUG LOG (full width) ─────────────────────────────────────────────┐   │
│ │ [HH:MM:SS] ✓ event messages ...                                      │   │
│ └──────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Connection Bar – Thêm hỗ trợ kiểu kết nối

### 1.1 Các kiểu kết nối firmware hỗ trợ

| Kiểu | `port_type` trong JSON | Ghi chú |
|------|----------------------|---------|
| UART | `"uart"` | Phổ biến nhất, dùng COM port + baud |
| USB  | `"usb"`  | CDC ACM, dùng COM port + baud |
| SPI  | `"spi"`  | GPIO chip-select, không cần baud |
| I2C  | `"i2c"`  | GPIO SCL/SDA, địa chỉ slave, không cần baud |

### 1.2 Thay đổi connection bar

```
v4.0:  Port:[COM3▼] [Refresh] [🔍 Scan]  Baud:[115200▼]  [Connect]
v5.0:  Port:[COM3▼] [Refresh] [🔍 Scan]  Type:[UART▼]  Baud:[115200▼]  [Connect]
```

- **Type dropdown**: `UART` | `USB` | `SPI` | `I2C`
- Khi type = **UART** hoặc **USB**: hiển thị COM port selector + Baud selector
- Khi type = **SPI**: ẩn baud selector; note nhỏ "SPI – clock/CS set in JSON"
- Khi type = **I2C**: ẩn baud selector; note nhỏ "I2C – address/clock set in JSON"
- Lựa chọn type được ghi nhớ; khi đọc config gateway, type cập nhật theo `module_communication.port_type` của stack slot active

---

## 2. BASIC MODE – Thiết kế mới (Info Card only)

### 2.1 Nguyên tắc

- **Chỉ show tab module** khi stack ID gateway báo về khớp trong `stack_id_map.json`
- **Không gửi AT command** từ basic mode
- Nội dung tab = thẻ thông tin read-only từ `stack_00X_config.json`

### 2.2 Tabs cố định (luôn hiển thị)

```
[📶 WiFi]  [📱 LTE]  [☁️ Server]
```

WiFi / LTE / Server giữ nguyên như v4.0 có nút Set và gửi WAN command.

### 2.3 Tabs module (động – chỉ add khi khớp ID)

```
Ví dụ:
  gateway báo stack1_id = "002" (BLE)  → add tab "🔷 BLE (S1)"
  gateway báo stack2_id = "003" (LoRa) → add tab "🟩 LoRa (S2)"
  gateway báo stack1_id = "000" (None) → không add tab
  stack_id không có trong stack_id_map → không add tab
```

### 2.4 Nội dung tab module trong basic mode (Info Card)

```
┌─ 🔷 BLE Stack 1 ──────────────────────────────────────────────────────────┐
│                                                                             │
│   Module Name:        STM32WB55 BLE                                        │
│   Stack ID:           002                                                   │
│   Module Type:        BLE                                                   │
│   Communication:      UART                                                  │
│   Baudrate:           115200                                                 │
│   Parity / Stop bit:  none / 1                                              │
│   JSON Config:        stack_002_config.json         [📂 View JSON]         │
│   Total functions:    24                                                    │
│                                                                             │
│   💡 Use Advanced Mode to configure this module.                           │
│                                                                             │
└────────────────────────────────────────────────────────────────────────────┘
```

**Nguồn dữ liệu**:

| Trường | Nguồn JSON |
|--------|-----------|
| Module Name | `module_name` |
| Stack ID | `module_id` |
| Module Type | `module_type` |
| Communication | `module_communication.port_type` |
| Baudrate | `module_communication.parameters.baudrate` |
| Parity / Stop bit | `module_communication.parameters.parity` / `stopbit` |
| Total functions | `len(functions)` |

**Không có nút gửi lệnh nào** trong Info Card.

**`[📂 View JSON]`**: mở dialog xem JSON config (read-only text area, không cho sửa).

### 2.5 Tab module đăng ký động

Basic panel sẽ đọc `stack_id_map.json` để xây dựng registry, mapping:

| Type | Tab class |
|------|-----------|
| `BLE` | `BLEInfoTab` |
| `LORA` | `LoRaInfoTab` |
| `ZIGBEE` | `ZigbeeInfoTab` |

Mỗi class chỉ render Info Card (không có gì khác nhau về bản chất), có thể dùng một class chung `ModuleInfoTab`.

---

## 3. ADVANCED MODE – Thiết kế mới (JSON Config Builder)

### 3.1 Nguyên tắc

- **Luôn hiển thị đầy đủ tabs**: BLE / LoRa / Zigbee không phụ thuộc vào stack ID báo về
- Người dùng tự chọn **stack slot** (S1 / S2) và **module** từ dropdown trong mỗi tab
- Thao tác = điền form → xem preview JSON → gửi JSON tới gateway
- **Không có button gửi AT command trực tiếp**

### 3.2 Tabs cố định (Advanced mode)

```
[📶 WiFi]  [📱 LTE]  [☁️ Server]  [🔷 BLE]  [🟩 LoRa]  [🔶 Zigbee]  [🔄 FW]
```

WiFi / LTE / Server / FW: giữ nguyên như v4.0.
BLE / LoRa / Zigbee: rewrite thành JSON Config Builder (xem 3.3).

### 3.3 Layout JSON Config Builder (mỗi tab module)

Tab chia 2 vùng bằng `PanedWindow` (ngang):

```
┌─ 🔷 BLE Config Builder ────────────────────────────────────────────────────┐
│  Stack Slot: [S1 ▼]    Module: [BLE (STM32WB55) ▼]    [🔄 Reload]         │
├───────────────────────────────────┬────────────────────────────────────────┤
│  LEFT: Config Form                │  RIGHT: JSON Preview + Actions         │
│                                   │                                        │
│  ┌─ Communication ─────────────┐  │  ┌─ Generated JSON ────────────────┐  │
│  │ Port type: [uart ▼]         │  │  │  {                              │  │
│  │ Baudrate:  [115200 ▼]       │  │  │    "module_id": "002",          │  │
│  │ Parity:    [none ▼]         │  │  │    "module_type": "BLE",        │  │
│  │ Stop bit:  [1 ▼]            │  │  │    "module_communication": {    │  │
│  └─────────────────────────────┘  │  │      "port_type": "uart",       │  │
│                                   │  │      "parameters": {            │  │
│  ┌─ Functions ──────────────────┐ │  │        "baudrate": 115200,      │  │
│  │  ▸ Lifecycle ─────────────── │ │  │        ...                      │  │
│  │    ☑ MODULE_HW_RESET         │ │  │      }                          │  │
│  │      GPIO pin: [01▼] [LOW▼]  │ │  │    },                           │  │
│  │      Delay end: [500] ms     │ │  │    "functions": [ ... ]         │  │
│  │    ☑ MODULE_SW_RESET         │ │  │  }                              │  │
│  │      Command: [AT+RESET\r\n] │ │  └─────────────────────────────────┘  │
│  │      Timeout: [2000] ms      │ │                                        │
│  │      Expect:  [OK]           │ │  [📋 Copy] [💾 Save] [📂 Load]        │
│  │  ▸ Network ─────────────────  │ │  [📤 Send to Gateway]                 │
│  │    ...                       │ │                                        │
│  └──────────────────────────────┘ │  ── Status ───────────────────────    │
│                                   │  Last sent:  —                         │
│                                   │  Response:   (waiting…)                │
└───────────────────────────────────┴────────────────────────────────────────┘
```

### 3.4 Config Form – chi tiết

#### Section: Communication

| Field | Widget | Ghi chú |
|-------|--------|---------|
| Port type | Dropdown: `uart` / `spi` / `i2c` / `usb` | Thay đổi → ẩn/hiện fields bên dưới |
| Baudrate | Dropdown: 9600 / 38400 / 57600 / 115200 / 230400 | Chỉ active khi uart / usb |
| Parity | Dropdown: `none` / `odd` / `even` | Chỉ active khi uart |
| Stop bit | Dropdown: `1` / `2` | Chỉ active khi uart |
| SPI mode | Dropdown: `0` / `1` / `2` / `3` | Chỉ hiện khi spi |
| SPI clock Hz | Spinbox | Chỉ hiện khi spi |
| SPI CS pin | Entry | Chỉ hiện khi spi |
| I2C address | Entry (hex) | Chỉ hiện khi i2c |
| I2C clock Hz | Spinbox | Chỉ hiện khi i2c |

#### Section: Functions (accordion theo nhóm)

Mỗi function từ JSON schema được render như accordion item:

```
▸ MODULE_HW_RESET   ☑ Enabled
  ├─ GPIO start:    [pin: 01▼] [state: LOW▼]      [+ Add]
  ├─ Delay start:   [100] ms
  ├─ GPIO end:      [pin: 01▼] [state: HIGH▼]
  └─ Delay end:     [500] ms

▸ MODULE_SW_RESET   ☑ Enabled
  ├─ Command:       [AT+RESET\r\n____________]
  ├─ Is prefix:     ☐
  ├─ Timeout:       [2000] ms
  ├─ Expect resp:   [OK__________________]
  └─ Delay end:     [1000] ms

▸ MODULE_SET_CHANNEL   ☑ Enabled    (Zigbee – HEX mode)
  ├─ cmd_type:      [0x00]
  ├─ cmd_code:      [0x06]
  ├─ Response fmt:  [hex ▼]
  └─ Timeout:       [1000] ms
```

**Ánh xạ trường JSON → widget**:

| Field JSON | Widget |
|-----------|--------|
| `command` | Entry |
| `is_prefix` | Checkbox |
| `cmd_type` | Entry (int/hex; N/A nếu = -1) |
| `cmd_code` | Entry (int/hex; N/A nếu = -1) |
| `response_format` | Dropdown: `ascii` / `hex` |
| `expect_response` | Entry |
| `timeout` | Spinbox (ms) |
| `gpio_start_control` | List widget (pin + state pairs) |
| `delay_start` | Spinbox (ms) |
| `gpio_end_control` | List widget (pin + state pairs) |
| `delay_end` | Spinbox (ms) |

**Function enabled/disabled**: Checkbox `☑ Enabled` – nếu bỏ chọn, function vẫn xuất hiện trong JSON nhưng với `"enabled": false` để gateway bỏ qua; không xóa khỏi JSON.

### 3.5 JSON Preview

- Cập nhật **realtime** theo mỗi thay đổi trong form
- JSON đầy đủ đúng schema của `stack_00X_config.json`
- Có thể chỉnh sửa trực tiếp trong vùng preview → form đồng bộ lại
- JSON **minify** khi gửi (không whitespace thừa)

### 3.6 Actions (vùng phải)

| Nút | Hành động |
|-----|----------|
| `📋 Copy` | Copy JSON vào clipboard |
| `💾 Save` | Lưu JSON ra file |
| `📂 Load` | Đọc JSON từ file → điền form + preview |
| `📤 Send to Gateway` | Gửi lệnh `CFxx:JSON:<json>\r\n` tới gateway |

**Format lệnh gửi**:

```
BLE:    CFBL:JSON:{json_minified}\r\n
LoRa:   CFLR:JSON:{json_minified}\r\n
Zigbee: CFZB:JSON:{json_minified}\r\n
```

Gateway parse JSON này và lưu vào flash, tương tự flow hiện tại.

### 3.7 Stack selector và Module selector

Mỗi tab có 2 dropdown ở header:

- **Stack Slot**: `S1` (stack_idx=0) | `S2` (stack_idx=1)
- **Module**: danh sách module cùng type lấy từ `stack_id_map.json`:
  - BLE tab:    `BLE (STM32WB55)` (002) | `BLE (Custom)` (004)
  - LoRa tab:   `LoRa (RAK3172)` (003) | `LoRa (Wio-E5 mini)` (006)
  - Zigbee tab: `Zigbee (E180-ZG120B)` (001) | `Zigbee (STM32WB55)` (005)

Chọn module → load `stack_00X_config.json` tương ứng → điền form + preview.

---

## 4. Hỗ trợ Communication Type trong JSON

Khi người dùng chọn port type trong form, `module_communication` trong JSON thay đổi:

### UART
```json
"module_communication": {
  "port_type": "uart",
  "parameters": {
    "baudrate": 115200,
    "parity": "none",
    "stopbit": 1
  }
}
```

### USB (CDC ACM)
```json
"module_communication": {
  "port_type": "usb",
  "parameters": {
    "baudrate": 115200
  }
}
```

### SPI
```json
"module_communication": {
  "port_type": "spi",
  "parameters": {
    "spi_mode": 0,
    "clock_hz": 1000000,
    "cs_pin": "05"
  }
}
```

### I2C
```json
"module_communication": {
  "port_type": "i2c",
  "parameters": {
    "i2c_addr": 96,
    "clock_hz": 400000
  }
}
```

---

## 5. Luồng người dùng

### Basic mode – xem thông tin module

```
Kết nối gateway
  → Click [📖 Read Config]
  → Panel nhận stack1_id = "002", stack2_id = "000"
  → Add tab "🔷 BLE (S1)" với Info Card từ stack_002_config.json
  → Stack 2 = "000" → không add tab
  → User xem thông tin module (read-only)
  → Thông báo: "💡 Use Advanced Mode to configure this module."
```

### Advanced mode – build và gửi JSON config

```
Switch to Advanced Mode
  → Tab "🔷 BLE" luôn hiển thị sẵn
  → User chọn Stack Slot = S1, Module = BLE (STM32WB55)
  → Form tải stack_002_config.json, điền giá trị mặc định
  → User thay đổi baudrate 115200 → 9600; disable MODULE_FACTORY_RESET
  → JSON Preview cập nhật realtime
  → Click [📤 Send to Gateway]
  → App gửi: CFBL:JSON:{"module_id":"002",...}\r\n
  → Gateway response: PARSE_OK
```

### Advanced mode – load và gửi JSON có sẵn

```
Click [📂 Load]
  → Chọn file stack_002_config.json
  → App parse → điền form + preview
  → Chỉnh sửa nếu cần
  → Click [📤 Send to Gateway]
```

---

## 6. Quy tắc generate JSON

1. Schema: đúng cấu trúc `stack_00X_config.json`
2. `module_communication`: lấy từ Communication section của form
3. `functions`: toàn bộ functions trong schema, giữ thứ tự
4. Function disabled (☐ Enabled) → `"enabled": false` trong JSON, không xóa
5. GPIO list rỗng → `"gpio_start_control": []`
6. Zigbee: giữ `cmd_type` / `cmd_code` đúng kiểu int (-1 nếu không dùng HEX)
7. String `\r\n` trong command được bảo toàn khi serialize
8. JSON minify khi gửi (no extra spaces / newlines)

---

## 7. Files cần thay đổi

### Sửa

| File | Thay đổi |
|------|----------|
| `src/ui/connection_bar.py` | Thêm Type dropdown; ẩn/hiện baud theo type |
| `src/ui/basic/basic_panel.py` | Registry dùng `stack_id_map.json` động; chỉ add tab khi ID khớp |
| `src/ui/basic/ble_basic_tab.py` | Xóa commands; thay bằng Info Card read-only |
| `src/ui/advanced/advanced_panel.py` | BLE/LoRa/Zigbee luôn hiển thị; bỏ dynamic add/remove |
| `src/ui/advanced/ble_tab.py` | Rewrite hoàn toàn → JSON Config Builder |
| `src/ui/advanced/lora_tab.py` | Rewrite hoàn toàn → JSON Config Builder |
| `src/ui/advanced/zigbee_tab.py` | Rewrite hoàn toàn → JSON Config Builder |
| `src/config/paths.py` | Thêm `load_module_config(stack_id)` |

### Tạo mới

| File | Mô tả |
|------|-------|
| `src/ui/basic/lora_basic_tab.py` | Info Card cho LoRa |
| `src/ui/basic/zigbee_basic_tab.py` | Info Card cho Zigbee |
| `src/ui/advanced/config_form.py` | Shared form widget (Communication + Functions accordion + JSON Preview) |

### Không thay đổi

- `main.py`
- `src/serial/manager.py`
- `src/config/protocol.py`
- `src/ui/advanced/wifi_tab.py`, `lte_tab.py`, `server_tab.py`, `firmware_tab.py`
- `src/config/stack_id_map.json`
- `src/config/stack_00X_config.json` (target JSON schema)
- `src/config/stack_00X_app_commands.json` (dùng cho label/hint trong form)

---

## 8. Task list (theo thứ tự phụ thuộc)

> **Chưa implement – chờ phê duyệt**

### Nhóm A – Connection bar
- [ ] A1. Thêm Type dropdown (UART / SPI / I2C / USB) vào `connection_bar.py`
- [ ] A2. Logic ẩn/hiện baud selector và hiện note theo type
- [ ] A3. Expose `get_comm_type()` public method

### Nhóm B – Basic mode Info Card
- [ ] B1. Sửa `ble_basic_tab.py`: xóa commands, thêm Info Card từ `stack_00X_config.json`
- [ ] B2. Tạo `lora_basic_tab.py`: Info Card cho LoRa
- [ ] B3. Tạo `zigbee_basic_tab.py`: Info Card cho Zigbee
- [ ] B4. Sửa `basic_panel.py`: đăng ký 3 tab class mới; đảm bảo chỉ add khi stack ID khớp

### Nhóm C – Advanced mode JSON Config Builder
- [ ] C1. Tạo `config_form.py`: widget dùng chung bao gồm:
  - Communication section (port type + params theo type)
  - Functions accordion (group → function → fields)
  - JSON Preview (realtime sync 2 chiều)
  - Action buttons (Copy / Save / Load / Send)
- [ ] C2. Rewrite `ble_tab.py`: stack selector + module selector + `ConfigForm`
- [ ] C3. Rewrite `lora_tab.py`: dùng `ConfigForm`
- [ ] C4. Rewrite `zigbee_tab.py`: dùng `ConfigForm` (thêm HEX cmd_type/cmd_code)
- [ ] C5. Sửa `advanced_panel.py`: BLE/LoRa/Zigbee tabs luôn add tại init, không dynamic

### Nhóm D – Helper
- [ ] D1. Thêm `load_module_config(stack_id)` vào `paths.py`

### Nhóm E – Test
- [ ] E1. Basic mode: stack ID khớp → tab hiện; không khớp / "000" → tab ẩn
- [ ] E2. Basic mode: Info Card hiển thị đúng thông tin từ JSON
- [ ] E3. Advanced mode: BLE/LoRa/Zigbee tabs luôn có mặt dù không kết nối
- [ ] E4. Advanced mode: form → JSON Preview đúng schema
- [ ] E5. Send to Gateway: `CFBL:JSON:...\r\n` → gateway trả `PARSE_OK`
- [ ] E6. Communication type UART/SPI/I2C/USB → `module_communication` JSON đúng
