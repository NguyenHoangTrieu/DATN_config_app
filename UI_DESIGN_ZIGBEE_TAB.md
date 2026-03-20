# UI Design – Advanced Mode: Zigbee Tab

---

## Layout tổng thể

```
┌─ 🔶 Zigbee ──────────────────────────────────────────────────────────────────────────────┐
│                                                                                           │
│  Stack Slot: [S1 ▼]   Preset: [Zigbee (E180-ZG120B) ▼]   [🔄 Reload]                    │
│  Module ID:  [001_____________]   Module Name: [E180-ZG120B______________________________]│
│                                                                                           │
├────────────────────────────────────────────┬──────────────────────────────────────────────┤
│  LEFT PANEL  (scrollable, ~55% width)      │  RIGHT PANEL  (scrollable, ~45% width)      │
│                                            │                                              │
│  ┌─ 🔌 Communication ──────────────────┐  │  ┌─ 📄 Generated JSON ──────────────────┐   │
│  │  (xem Section 2)                    │  │  │  (xem Section 3)                     │   │
│  └─────────────────────────────────────┘  │  └──────────────────────────────────────┘   │
│                                            │                                              │
│  ┌─ ⚙️ Functions ───────────────────────┐  │  ┌─ 🚀 Actions ────────────────────────┐   │
│  │  (xem Section 4)                    │  │  │  (xem Section 5)                     │   │
│  └─────────────────────────────────────┘  │  └──────────────────────────────────────┘   │
│                                            │                                              │
│                                            │  ┌─ 📊 Status ─────────────────────────┐   │
│                                            │  │  (xem Section 6)                     │   │
│                                            │  └──────────────────────────────────────┘   │
└────────────────────────────────────────────┴──────────────────────────────────────────────┘
```

---

## Section 1 – Tab Header

```
┌────────────────────────────────────────────────────────────────────────────┐
│  Stack Slot: [S1 ▼]   Preset: [Zigbee (E180-ZG120B) ▼]   [🔄 Reload]     │
│  Module ID:  [001__________________________]                               │
│  Module Name:[E180-ZG120B_________________________________________]        │
└────────────────────────────────────────────────────────────────────────────┘
```

| Widget | Loại | Options | Mô tả |
|--------|------|---------|-------|
| Stack Slot | Combobox (readonly) | `S1`, `S2` | Slot module trên gateway |
| Preset | Combobox (editable) | `Zigbee (E180-ZG120B)` (001), `Zigbee (STM32WB55)` (005) | Chọn preset → auto-fill Module ID + Name; để trống = tạo module mới |
| Module ID | Entry (editable) | mặc định `001` | Người dùng gõ tùy ý → ghi vào JSON `module_id` |
| Module Name | Entry (editable) | mặc định `E180-ZG120B` | Người dùng gõ tùy ý → ghi vào JSON `module_name` |
| 🔄 Reload | Button | — | Reload form + Module ID/Name về giá trị mặc định từ preset đã chọn |

---

## Section 2 – Communication Panel

```
┌─ 🔌 Communication ─────────────────────────────────────────────────────────┐
│                                                                             │
│   Port type:   [uart ▼]                                                    │
│                                                                             │
│   ── hiển thị khi port_type = uart hoặc usb ──                             │
│   Baudrate:    [115200 ▼]                                                  │
│                                                                             │
│   ── chỉ hiển thị khi port_type = uart ──                                  │
│   Parity:      [none ▼]                                                    │
│   Stop bit:    [1 ▼]                                                       │
│                                                                             │
│   ── chỉ hiển thị khi port_type = spi ──                                   │
│   SPI mode:    [0 ▼]                                                       │
│   Clock Hz:    [1000000    ]                                               │
│   CS pin:      [05_________]                                               │
│                                                                             │
│   ── chỉ hiển thị khi port_type = i2c ──                                   │
│   I2C addr:    [0x60_______]                                               │
│   Clock Hz:    [400000     ]                                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

| Field | Widget | Options / Mặc định | Ghi chú |
|-------|--------|--------------------|---------|
| Port type | Combobox (readonly) | `uart`, `usb`, `spi`, `i2c` – mặc định `uart` | Thay đổi → ẩn/hiện fields bên dưới |
| Baudrate | Combobox (readonly) | `9600`, `38400`, `57600`, `115200`, `230400` – mặc định `115200` | Ẩn khi spi / i2c |
| Parity | Combobox (readonly) | `none`, `odd`, `even` – mặc định `none` | Chỉ hiện khi uart |
| Stop bit | Combobox (readonly) | `1`, `2` – mặc định `1` | Chỉ hiện khi uart |
| SPI mode | Combobox (readonly) | `0`, `1`, `2`, `3` – mặc định `0` | Chỉ hiện khi spi |
| SPI Clock Hz | Spinbox | min 100000, max 40000000, mặc định 1000000 | Chỉ hiện khi spi |
| SPI CS pin | Entry | mặc định `05` | Chỉ hiện khi spi |
| I2C addr | Entry (hex) | mặc định `0x60` | Chỉ hiện khi i2c |
| I2C Clock Hz | Spinbox | min 10000, max 1000000, mặc định 400000 | Chỉ hiện khi i2c |

---

## Section 3 – JSON Preview Panel

```
┌─ 📄 Generated JSON ────────────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  {                                                                   │  │
│  │    "module_id": "001",                                               │  │
│  │    "module_type": "ZIGBEE",                                          │  │
│  │    "module_name": "E180-ZG120B",                                     │  │
│  │    "module_communication": {                                         │  │
│  │      "port_type": "uart",                                            │  │
│  │      "parameters": {                                                 │  │
│  │        "baudrate": 115200,                                           │  │
│  │        "parity": "none",                                             │  │
│  │        "stopbit": 1                                                  │  │
│  │      }                                                               │  │
│  │    },                                                                │  │
│  │    "functions": [                                                    │  │
│  │      {                                                               │  │
│  │        "function_name": "MODULE_HW_RESET",                          │  │
│  │        "command": "",                                                │  │
│  │        "is_prefix": false,                                           │  │
│  │        "cmd_type": -1,                                               │  │
│  │        "cmd_code": -1,                                               │  │
│  │        "response_format": "ascii",                                   │  │
│  │        ...                                                           │  │
│  │      },                                                              │  │
│  │      ...                                                             │  │
│  │    ]                                                                 │  │
│  │  }                                                                   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│  (scrollbar dọc – editable – realtime update)                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Realtime update**: mỗi khi thay đổi bất kỳ field nào trong form → preview tự cập nhật
- **Editable**: người dùng có thể gõ trực tiếp vào preview → form đồng bộ lại
- **Font**: Consolas 9pt (monospace)
- **Màu nền**: `#FAFAFA`

---

## Section 4 – Functions Panel (Zigbee)

### 4.1 Cấu trúc accordion

```
┌─ ⚙️ Functions ──────────────────────────────────────────────────────────────┐
│                                                                             │
│  ▼ 🔄 Lifecycle  (5 functions)                                              │
│  │  ▸ MODULE_HW_RESET        ☑ Enabled                                     │
│  │  ▸ MODULE_SW_RESET        ☑ Enabled                                     │
│  │  ▸ MODULE_FACTORY_RESET   ☑ Enabled                                     │
│  │  ▸ MODULE_GET_INFO        ☑ Enabled                                     │
│  │  ▸ MODULE_ENTER_HEX_MODE  ☑ Enabled                                     │
│                                                                             │
│  ▼ 🌐 Network Management  (7 functions)                                     │
│  │  ▸ MODULE_START_NETWORK   ☑ Enabled                                     │
│  │  ▸ MODULE_STOP_NETWORK    ☑ Enabled                                     │
│  │  ▸ MODULE_GET_NET_STATUS  ☑ Enabled                                     │
│  │  ▸ MODULE_SET_CHANNEL     ☑ Enabled                                     │
│  │  ▸ MODULE_SET_PANID       ☑ Enabled                                     │
│  │  ▸ MODULE_SET_TX_POWER    ☑ Enabled                                     │
│  │  ▸ MODULE_SET_PERMIT_JOIN ☑ Enabled                                     │
│                                                                             │
│  ▼ 🔍 Node Discovery  (6 functions)                                         │
│  │  ▸ MODULE_NODE_JOIN_NOTIFY     ☑ Enabled   ⚡ async                     │
│  │  ▸ MODULE_NODE_LEAVE_NOTIFY    ☑ Enabled   ⚡ async                     │
│  │  ▸ MODULE_NODE_ANNOUNCE_NOTIFY ☑ Enabled   ⚡ async                     │
│  │  ▸ MODULE_QUERY_SHORT_ADDR     ☑ Enabled                                │
│  │  ▸ MODULE_QUERY_NODE_PORT_INFO ☑ Enabled                                │
│  │  ▸ MODULE_DELETE_NODE          ☑ Enabled                                │
│                                                                             │
│  ▼ ⚡ ZCL Control  (6 functions)                                            │
│  │  ▸ MODULE_ZCL_READ_ATTR        ☑ Enabled                                │
│  │  ▸ MODULE_ZCL_WRITE_ATTR       ☑ Enabled                                │
│  │  ▸ MODULE_ZCL_SEND_CONTROL_CMD ☑ Enabled                                │
│  │  ▸ MODULE_ZCL_RECV_CONTROL_CMD ☑ Enabled   ⚡ async                     │
│  │  ▸ MODULE_ZCL_RECV_ATTR_REPORT ☑ Enabled   ⚡ async                     │
│  │  ▸ MODULE_ZCL_SET_REPORT_RULE  ☑ Enabled                                │
│                                                                             │
│  ▼ 📨 Data Transfer  (2 functions)                                          │
│  │  ▸ MODULE_SEND_UNICAST    ☑ Enabled                                     │
│  │  ▸ MODULE_SEND_BROADCAST  ☑ Enabled                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Ghi chú badge `⚡ async`**: hiển thị bên cạnh tên function khi `is_async_event: true`; badge màu vàng cam.

### 4.2 Function item – body (khi mở rộng ▾)

Zigbee có thêm 3 fields đặc thù so với BLE/LoRa: `cmd_type`, `cmd_code`, `response_format`, và `is_async_event`.

#### Template: function HEX mode (cmd_type / cmd_code hợp lệ, command trống)

```
  ▾ MODULE_SW_RESET        ☑ Enabled
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                                                                         │
  │   Command:       [________________________________]    (trống)          │
  │   Is Prefix:     ☐                                                      │
  │                                                                         │
  │   CMD Type:      [0x00 ]    (dec: 0)                                    │
  │   CMD Code:      [0x04 ]    (dec: 4)                                    │
  │   Resp Format:   [ascii ▼]                                              │
  │   Is Async:      ☐                                                      │
  │                                                                         │
  │   GPIO Start:    [No GPIO]                     [+ Add GPIO]             │
  │   Delay Start:   [0       ] ms                                          │
  │                                                                         │
  │   GPIO End:      [No GPIO]                     [+ Add GPIO]             │
  │   Delay End:     [1000    ] ms                                          │
  │                                                                         │
  │   Expect Resp:   [________________________________]    (trống)          │
  │   Timeout:       [2000    ] ms                                          │
  │                                                                         │
  └─────────────────────────────────────────────────────────────────────────┘
```

#### Template: function AT-mode (cmd_type = -1 / cmd_code = -1)

Khi `cmd_type = -1` và `cmd_code = -1`, hai field CMD Type và CMD Code **hiển thị disabled** với label `N/A`:

```
  ▾ MODULE_ENTER_HEX_MODE  ☑ Enabled
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                                                                         │
  │   Command:       [AT+EXIT_______________________________]               │
  │   Is Prefix:     ☐                                                      │
  │                                                                         │
  │   CMD Type:      [N/A   ]    (disabled – AT mode)                       │
  │   CMD Code:      [N/A   ]    (disabled – AT mode)                       │
  │   Resp Format:   [ascii ▼]                                              │
  │   Is Async:      ☐                                                      │
  │                                                                         │
  │   GPIO Start:    [No GPIO]                     [+ Add GPIO]             │
  │   Delay Start:   [0       ] ms                                          │
  │                                                                         │
  │   GPIO End:      [No GPIO]                     [+ Add GPIO]             │
  │   Delay End:     [200     ] ms                                          │
  │                                                                         │
  │   Expect Resp:   [EXIT____________________________]                     │
  │   Timeout:       [1000    ] ms                                          │
  │                                                                         │
  └─────────────────────────────────────────────────────────────────────────┘
```

#### Template: function GPIO-only + cmd_type = -1 (MODULE_HW_RESET)

```
  ▾ MODULE_HW_RESET        ☑ Enabled
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                                                                         │
  │   Command:       [________________________________]    (trống)          │
  │   Is Prefix:     ☐                                                      │
  │                                                                         │
  │   CMD Type:      [N/A   ]    (disabled – GPIO only)                     │
  │   CMD Code:      [N/A   ]    (disabled – GPIO only)                     │
  │   Resp Format:   [ascii ▼]                                              │
  │   Is Async:      ☐                                                      │
  │                                                                         │
  │   GPIO Start:                                                           │
  │     #1:  Pin [01 ▼]  State [LOW  ▼]  [✕]                               │
  │             [+ Add GPIO]                                                │
  │   Delay Start:   [100     ] ms                                          │
  │                                                                         │
  │   GPIO End:                                                             │
  │     #1:  Pin [01 ▼]  State [HIGH ▼]  [✕]                               │
  │             [+ Add GPIO]                                                │
  │   Delay End:     [500     ] ms                                          │
  │                                                                         │
  │   Expect Resp:   [________________________________]    (trống)          │
  │   Timeout:       [0       ] ms                                          │
  │                                                                         │
  └─────────────────────────────────────────────────────────────────────────┘
```

#### Template: async event function (is_async_event = true, timeout = 0)

```
  ▾ MODULE_NODE_JOIN_NOTIFY   ☑ Enabled   ⚡ async
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                                                                         │
  │   Command:       [________________________________]    (trống)          │
  │   Is Prefix:     ☐                                                      │
  │                                                                         │
  │   CMD Type:      [0x80 ]    (dec: 128)                                  │
  │   CMD Code:      [0x03 ]    (dec: 3)                                    │
  │   Resp Format:   [hex  ▼]                                               │
  │   Is Async:      ☑                                                      │
  │                                                                         │
  │   GPIO Start:    [No GPIO]                     [+ Add GPIO]             │
  │   Delay Start:   [0       ] ms                                          │
  │                                                                         │
  │   GPIO End:      [No GPIO]                     [+ Add GPIO]             │
  │   Delay End:     [0       ] ms                                          │
  │                                                                         │
  │   Expect Resp:   [55 80 03_______________________]    (hex bytes)       │
  │   Timeout:       [0       ] ms    ← 0 = lắng nghe liên tục             │
  │                                                                         │
  └─────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Bảng field cho từng function Zigbee

#### GROUP: Lifecycle

| Function | command | is_prefix | cmd_type | cmd_code | resp_format | is_async | gpio_start | delay_start | gpio_end | delay_end | expect_resp | timeout |
|----------|---------|-----------|----------|----------|-------------|----------|------------|-------------|----------|-----------|-------------|---------|
| MODULE_HW_RESET | *(trống)* | ☐ | N/A (-1) | N/A (-1) | ascii | ☐ | pin=01 LOW | 100 ms | pin=01 HIGH | 500 ms | *(trống)* | 0 ms |
| MODULE_SW_RESET | *(trống)* | ☐ | 0x00 (0) | 0x04 (4) | ascii | ☐ | — | 0 ms | — | 1000 ms | *(trống)* | 2000 ms |
| MODULE_FACTORY_RESET | *(trống)* | ☐ | 0x00 (0) | 0x04 (4) | ascii | ☐ | — | 0 ms | — | 2000 ms | *(trống)* | 5000 ms |
| MODULE_GET_INFO | *(trống)* | ☐ | 0x00 (0) | 0x00 (0) | ascii | ☐ | — | 0 ms | — | 0 ms | *(trống)* | 1000 ms |
| MODULE_ENTER_HEX_MODE | `AT+EXIT` | ☐ | N/A (-1) | N/A (-1) | ascii | ☐ | — | 0 ms | — | 200 ms | `EXIT` | 1000 ms |

#### GROUP: Network Management

| Function | command | is_prefix | cmd_type | cmd_code | resp_format | is_async | delay_end | expect_resp | timeout |
|----------|---------|-----------|----------|----------|-------------|----------|-----------|-------------|---------|
| MODULE_START_NETWORK | *(trống)* | ☐ | 0x00 (0) | 0x02 (2) | ascii | ☐ | 0 ms | *(trống)* | 5000 ms |
| MODULE_STOP_NETWORK | *(trống)* | ☐ | 0x00 (0) | 0x03 (3) | ascii | ☐ | 0 ms | *(trống)* | 2000 ms |
| MODULE_GET_NET_STATUS | *(trống)* | ☐ | 0x00 (0) | 0x00 (0) | ascii | ☐ | 0 ms | *(trống)* | 1000 ms |
| MODULE_SET_CHANNEL | *(trống)* | ☑ | 0x00 (0) | 0x06 (6) | ascii | ☐ | 0 ms | *(trống)* | 1000 ms |
| MODULE_SET_PANID | *(trống)* | ☑ | 0x00 (0) | 0x08 (8) | ascii | ☐ | 0 ms | *(trống)* | 1000 ms |
| MODULE_SET_TX_POWER | *(trống)* | ☑ | 0x00 (0) | 0x0D (13) | ascii | ☐ | 0 ms | *(trống)* | 1000 ms |
| MODULE_SET_PERMIT_JOIN | *(trống)* | ☑ | 0x00 (0) | 0x12 (18) | ascii | ☐ | 0 ms | *(trống)* | 1000 ms |

#### GROUP: Node Discovery

| Function | command | is_prefix | cmd_type | cmd_code | resp_format | is_async | expect_resp | timeout |
|----------|---------|-----------|----------|----------|-------------|----------|-------------|---------|
| MODULE_NODE_JOIN_NOTIFY | *(trống)* | ☐ | 0x80 (128) | 0x03 (3) | hex | ☑ | `55 80 03` | 0 ms |
| MODULE_NODE_LEAVE_NOTIFY | *(trống)* | ☐ | 0x80 (128) | 0x06 (6) | hex | ☑ | `55 80 06` | 0 ms |
| MODULE_NODE_ANNOUNCE_NOTIFY | *(trống)* | ☐ | 0x80 (128) | 0x05 (5) | hex | ☑ | `55 80 05` | 0 ms |
| MODULE_QUERY_SHORT_ADDR | *(trống)* | ☑ | 0x01 (1) | 0x00 (0) | ascii | ☐ | *(trống)* | 1000 ms |
| MODULE_QUERY_NODE_PORT_INFO | *(trống)* | ☑ | 0x01 (1) | 0x04 (4) | ascii | ☐ | *(trống)* | 1000 ms |
| MODULE_DELETE_NODE | *(trống)* | ☑ | 0x01 (1) | 0x34 (52) | ascii | ☐ | *(trống)* | 2000 ms |

#### GROUP: ZCL Control

| Function | command | is_prefix | cmd_type | cmd_code | resp_format | is_async | expect_resp | timeout |
|----------|---------|-----------|----------|----------|-------------|----------|-------------|---------|
| MODULE_ZCL_READ_ATTR | *(trống)* | ☑ | 0x02 (2) | 0x00 (0) | ascii | ☐ | *(trống)* | 2000 ms |
| MODULE_ZCL_WRITE_ATTR | *(trống)* | ☑ | 0x02 (2) | 0x01 (1) | ascii | ☐ | *(trống)* | 2000 ms |
| MODULE_ZCL_SEND_CONTROL_CMD | *(trống)* | ☑ | 0x02 (2) | 0x0F (15) | ascii | ☐ | *(trống)* | 2000 ms |
| MODULE_ZCL_RECV_CONTROL_CMD | *(trống)* | ☐ | 0x82 (130) | 0x0F (15) | hex | ☑ | `55 82 0F` | 0 ms |
| MODULE_ZCL_RECV_ATTR_REPORT | *(trống)* | ☐ | 0x82 (130) | 0x0A (10) | hex | ☑ | `55 82 0A` | 0 ms |
| MODULE_ZCL_SET_REPORT_RULE | *(trống)* | ☑ | 0x02 (2) | 0x03 (3) | ascii | ☐ | *(trống)* | 2000 ms |

#### GROUP: Data Transfer

| Function | command | is_prefix | cmd_type | cmd_code | resp_format | is_async | expect_resp | timeout |
|----------|---------|-----------|----------|----------|-------------|----------|-------------|---------|
| MODULE_SEND_UNICAST | *(trống)* | ☑ | 0x02 (2) | 0x0F (15) | ascii | ☐ | *(trống)* | 2000 ms |
| MODULE_SEND_BROADCAST | *(trống)* | ☑ | 0x02 (2) | 0x0F (15) | ascii | ☐ | *(trống)* | 2000 ms |

---

## Section 5 – Actions Panel

```
┌─ 🚀 Actions ────────────────────────────────────────────────────────────────┐
│                                                                             │
│   [⚙️ Generate]           [💾 Save]                                         │
│                           *(disabled khi chưa có file loaded)*             │
│   [📂 Load JSON]          [📤 Send to Gateway]                             │
│                                                                             │
│   File: (none)                                                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

| Nút | Hành động |
|-----|-----------|
| ⚙️ Generate | Mở Save As dialog → tạo file `.json` mới → file đó trở thành *loaded file* |
| 💾 Save | Ghi đè lên *loaded file*; **disabled** khi `File: (none)` |
| 📂 Load JSON | Mở Open dialog → đọc file `.json` → điền form + preview → đặt làm *loaded file* |
| 📤 Send to Gateway | Gửi `CFZB:JSON:{minified_json}\r\n` qua serial |

> **Ghi chú**: Label `File:` hiển thị đường dẫn đầy đủ của loaded file. Cả **Load** và **Generate** đều set loaded file → kích hoạt nút **Save**.

---

## Section 6 – Status Panel

```
┌─ 📊 Status ─────────────────────────────────────────────────────────────────┐
│                                                                             │
│   Last sent:   —                                                            │
│   Response:    (waiting…)                                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

| Field | Mô tả |
|-------|-------|
| Last sent | Timestamp lần gửi cuối, ví dụ `20:31:38` |
| Response | `(waiting…)` khi chờ; `PARSE_OK` (xanh) khi thành công; `PARSE_FAIL` (đỏ) khi lỗi |

---

## Section 7 – Quy tắc hiển thị đặc thù Zigbee

### 7.1 CMD Type / CMD Code input format

```
CMD Type:  [0x00 ]    (dec: 0)
           ↑ Entry text, width 6     ↑ Label hiển thị dec tương ứng (read-only, cập nhật tự động)
```

- Nhập dạng hex `0x82` hoặc decimal `130` đều được chấp nhận
- Hiển thị: luôn format `0xXX` trong Entry; dec label cập nhật theo
- Giá trị `-1`: hiển thị text `N/A`, trường disabled (màu xám)

### 7.2 Response Format dropdown

| Giá trị | Ý nghĩa |
|---------|---------|
| `ascii` | Expect response so sánh chuỗi ASCII thông thường |
| `hex` | Expect response so sánh chuỗi hex `55 80 03` (space-separated bytes) |

Khi chọn `hex`, field **Expect Resp** hiển thị placeholder `e.g. 55 80 03`.
Khi chọn `ascii`, placeholder là `e.g. OK`.

### 7.3 Is Async badge

Khi `is_async_event = true`:
- Tiêu đề item hiển thị badge nhỏ `⚡ async` màu `#FF8C00`
- Timeout tự động disable và hiển thị giá trị `0` (listener không timeout)
- Tooltip: `"Async event – gateway listens continuously, no timeout"`

### 7.4 Phân biệt rõ mode

Zigbee E180-ZG120B có 2 mode hoạt động:
- **AT mode** (`cmd_type = -1`): gửi command ASCII text; dùng cho MODULE_ENTER_HEX_MODE
- **HEX mode** (`cmd_type ≥ 0`): gateway build HEX binary frame; không dùng command field

Khi `cmd_type = -1`:
- Field **Command** → enabled (màu thường)
- Field **CMD Type** + **CMD Code** → disabled (màu xám, text `N/A`)

Khi `cmd_type ≥ 0`:
- Field **Command** → disabled (màu xám, text trống)
- Field **CMD Type** + **CMD Code** → enabled

---

## Widget Specs tổng hợp

| Widget | Kiểu | Chi tiết |
|--------|------|---------|
| GPIO Pin dropdown | Combobox readonly | Options: `01`–`11`, `WK`, `PE` |
| GPIO State dropdown | Combobox readonly | Options: `LOW`, `HIGH` |
| Delay fields | Spinbox | min 0, max 60000, step 50, suffix "ms" |
| Timeout field | Spinbox | min 0, max 60000, step 100, suffix "ms" |
| Command field | Entry | width ~40 chars; disabled khi cmd_type ≥ 0 |
| Expect Resp field | Entry | width ~40 chars; placeholder thay đổi theo resp_format |
| CMD Type field | Entry | width 6; format `0xXX`; disabled khi = -1 |
| CMD Code field | Entry | width 6; format `0xXX`; disabled khi = -1 |
| Dec label (CMD) | Label readonly | cập nhật tự động khi cmd_type / cmd_code thay đổi |
| Response Format | Combobox readonly | `ascii`, `hex` |
| Is Async checkbox | Checkbutton | tick → disable timeout field |
| Is Prefix checkbox | Checkbutton | — |
| Enabled checkbox | Checkbutton | tick = enabled trong JSON |
| Group header | Label + Button | click collapse/expand tất cả items trong nhóm |
| Function item header | Label + Checkbutton + Badge | arrow ▸/▾; checkbox Enabled; badge `⚡ async` nếu có |
