# UI Design – Advanced Mode: LoRa Tab

---

## Layout tổng thể

```
┌─ 🟩 LoRa ────────────────────────────────────────────────────────────────────────────────┐
│                                                                                           │
│  Stack Slot: [S1 ▼]   Preset: [LoRa (RAK3172) ▼]   [🔄 Reload]                          │
│  Module ID:  [003_____________]   Module Name: [RAK3172___________________________________]│
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
│  Stack Slot: [S1 ▼]   Preset: [LoRa (RAK3172) ▼]   [🔄 Reload]           │
│  Module ID:  [003__________________________]                               │
│  Module Name:[RAK3172____________________________________________]         │
└────────────────────────────────────────────────────────────────────────────┘
```

| Widget | Loại | Options | Mô tả |
|--------|------|---------|-------|
| Stack Slot | Combobox (readonly) | `S1`, `S2` | Slot module trên gateway |
| Preset | Combobox (editable) | `LoRa (RAK3172)` (003), `LoRa (Wio-E5 mini)` (006) | Chọn preset → auto-fill Module ID + Name; để trống = tạo module mới |
| Module ID | Entry (editable) | mặc định `003` | Người dùng gõ tùy ý → ghi vào JSON `module_id` |
| Module Name | Entry (editable) | mặc định `RAK3172` | Người dùng gõ tùy ý → ghi vào JSON `module_name` |
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
│  │    "module_id": "003",                                               │  │
│  │    "module_type": "LORA",                                            │  │
│  │    "module_name": "RAK3172",                                         │  │
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

## Section 4 – Functions Panel (LoRa)

### 4.1 Cấu trúc accordion

```
┌─ ⚙️ Functions ──────────────────────────────────────────────────────────────┐
│                                                                             │
│  ▼ 🔄 System  (4 functions)                                                 │
│  │  ▸ MODULE_HW_RESET       ☑ Enabled                                      │
│  │  ▸ MODULE_SW_RESET       ☑ Enabled                                      │
│  │  ▸ MODULE_GET_INFO       ☑ Enabled                                      │
│  │  ▸ MODULE_FACTORY_RESET  ☑ Enabled                                      │
│                                                                             │
│  ▼ 🌍 Region & Class  (2 functions)                                          │
│  │  ▸ MODULE_SET_REGION     ☑ Enabled                                      │
│  │  ▸ MODULE_SET_CLASS      ☑ Enabled                                      │
│                                                                             │
│  ▼ 🔑 OTAA Provisioning  (7 functions)                                      │
│  │  ▸ MODULE_SET_JOIN_MODE  ☑ Enabled                                      │
│  │  ▸ MODULE_SET_DEVEUI     ☑ Enabled                                      │
│  │  ▸ MODULE_GET_DEVEUI     ☑ Enabled                                      │
│  │  ▸ MODULE_SET_APPEUI     ☑ Enabled                                      │
│  │  ▸ MODULE_SET_APPKEY     ☑ Enabled                                      │
│  │  ▸ MODULE_JOIN           ☑ Enabled                                      │
│  │  ▸ MODULE_GET_JOIN_STATUS ☑ Enabled                                     │
│                                                                             │
│  ▼ 🔒 ABP Provisioning  (3 functions)                                       │
│  │  ▸ MODULE_SET_DEVADDR    ☑ Enabled                                      │
│  │  ▸ MODULE_SET_NWKSKEY    ☑ Enabled                                      │
│  │  ▸ MODULE_SET_APPSKEY    ☑ Enabled                                      │
│                                                                             │
│  ▼ 📶 MAC & RF Settings  (6 functions)                                      │
│  │  ▸ MODULE_SET_DR         ☑ Enabled                                      │
│  │  ▸ MODULE_SET_ADR        ☑ Enabled                                      │
│  │  ▸ MODULE_SET_TXP        ☑ Enabled                                      │
│  │  ▸ MODULE_SET_CHANNEL    ☑ Enabled                                      │
│  │  ▸ MODULE_SET_CONFIRM    ☑ Enabled                                      │
│  │  ▸ MODULE_SET_PUBLIC_NET ☑ Enabled                                      │
│                                                                             │
│  ▼ 📨 Data  (3 functions)                                                   │
│  │  ▸ MODULE_SEND_UNCONFIRMED ☑ Enabled                                    │
│  │  ▸ MODULE_SEND_CONFIRMED   ☑ Enabled                                    │
│  │  ▸ MODULE_READ_RECV        ☑ Enabled                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Function item – body (khi mở rộng ▾)

Template áp dụng cho **TẤT CẢ** LoRa functions:

```
  ▾ MODULE_SW_RESET       ☑ Enabled
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                                                                         │
  │   Command:       [ATZ\r\n_________________________________]             │
  │   Is Prefix:     ☐                                                      │
  │                                                                         │
  │   GPIO Start:    [No GPIO]                     [+ Add GPIO]             │
  │   Delay Start:   [0       ] ms                                          │
  │                                                                         │
  │   GPIO End:      [No GPIO]                     [+ Add GPIO]             │
  │   Delay End:     [1000    ] ms                                          │
  │                                                                         │
  │   Expect Resp:   [OK______________________________]                     │
  │   Timeout:       [2000    ] ms                                          │
  │                                                                         │
  └─────────────────────────────────────────────────────────────────────────┘
```

**Trường hợp có GPIO** (MODULE_HW_RESET):

```
  ▾ MODULE_HW_RESET       ☑ Enabled
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                                                                         │
  │   Command:       [________________________________]    (trống)          │
  │   Is Prefix:     ☐                                                      │
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

### 4.3 Bảng field cho từng function LoRa

#### GROUP: System

| Function | command | is_prefix | gpio_start | delay_start | gpio_end | delay_end | expect_response | timeout |
|----------|---------|-----------|------------|-------------|----------|-----------|-----------------|---------|
| MODULE_HW_RESET | *(trống)* | ☐ | pin=01 LOW | 100 ms | pin=01 HIGH | 500 ms | *(trống)* | 0 ms |
| MODULE_SW_RESET | `ATZ\r\n` | ☐ | — | 0 ms | — | 1000 ms | `OK` | 2000 ms |
| MODULE_GET_INFO | `AT+VER=?\r\n` | ☐ | — | 0 ms | — | 0 ms | `OK` | 1000 ms |
| MODULE_FACTORY_RESET | `ATR\r\n` | ☐ | — | 0 ms | — | 2000 ms | `OK` | 5000 ms |

#### GROUP: Region & Class

| Function | command | is_prefix | delay_end | expect_resp | timeout |
|----------|---------|-----------|-----------|-------------|---------|
| MODULE_SET_REGION | `AT+BAND=` | ☑ | 0 ms | `OK` | 1000 ms |
| MODULE_SET_CLASS | `AT+CLASS=` | ☑ | 0 ms | `OK` | 1000 ms |

#### GROUP: OTAA Provisioning

| Function | command | is_prefix | delay_end | expect_resp | timeout |
|----------|---------|-----------|-----------|-------------|---------|
| MODULE_SET_JOIN_MODE | `AT+NJM=` | ☑ | 0 ms | `OK` | 500 ms |
| MODULE_SET_DEVEUI | `AT+DEVEUI=` | ☑ | 0 ms | `OK` | 500 ms |
| MODULE_GET_DEVEUI | `AT+DEVEUI=?\r\n` | ☐ | 0 ms | `+DEVEUI:` | 1000 ms |
| MODULE_SET_APPEUI | `AT+APPEUI=` | ☑ | 0 ms | `OK` | 500 ms |
| MODULE_SET_APPKEY | `AT+APPKEY=` | ☑ | 0 ms | `OK` | 500 ms |
| MODULE_JOIN | `AT+JOIN=1:0:10:8\r\n` | ☐ | 0 ms | `OK` | 30000 ms |
| MODULE_GET_JOIN_STATUS | `AT+NJS=?\r\n` | ☐ | 0 ms | `+NJS:` | 1000 ms |

#### GROUP: ABP Provisioning

| Function | command | is_prefix | delay_end | expect_resp | timeout |
|----------|---------|-----------|-----------|-------------|---------|
| MODULE_SET_DEVADDR | `AT+DEVADDR=` | ☑ | 0 ms | `OK` | 500 ms |
| MODULE_SET_NWKSKEY | `AT+NWKSKEY=` | ☑ | 0 ms | `OK` | 500 ms |
| MODULE_SET_APPSKEY | `AT+APPSKEY=` | ☑ | 0 ms | `OK` | 500 ms |

#### GROUP: MAC & RF Settings

| Function | command | is_prefix | delay_end | expect_resp | timeout |
|----------|---------|-----------|-----------|-------------|---------|
| MODULE_SET_DR | `AT+DR=` | ☑ | 0 ms | `OK` | 500 ms |
| MODULE_SET_ADR | `AT+ADR=` | ☑ | 0 ms | `OK` | 500 ms |
| MODULE_SET_TXP | `AT+TXP=` | ☑ | 0 ms | `OK` | 500 ms |
| MODULE_SET_CHANNEL | `AT+MASK=` | ☑ | 0 ms | `OK` | 500 ms |
| MODULE_SET_CONFIRM | `AT+CFM=` | ☑ | 0 ms | `OK` | 500 ms |
| MODULE_SET_PUBLIC_NET | `AT+PUBLIC=` | ☑ | 0 ms | `OK` | 500 ms |

#### GROUP: Data

| Function | command | is_prefix | delay_end | expect_resp | timeout |
|----------|---------|-----------|-----------|-------------|---------|
| MODULE_SEND_UNCONFIRMED | `AT+SEND=` | ☑ | 0 ms | `+EVT:SEND_CONFIRMED` | 30000 ms |
| MODULE_SEND_CONFIRMED | `AT+SEND=` | ☑ | 0 ms | `+EVT:SEND_CONFIRMED` | 30000 ms |
| MODULE_READ_RECV | `AT+RECV=?\r\n` | ☐ | 0 ms | `+RECV:` | 2000 ms |

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
| 📤 Send to Gateway | Gửi `CFLR:JSON:{minified_json}\r\n` qua serial |

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

## Widget Specs tổng hợp

| Widget | Kiểu | Chi tiết |
|--------|------|---------|
| GPIO Pin dropdown | Combobox readonly | Options: `01`–`11`, `WK`, `PE` |
| GPIO State dropdown | Combobox readonly | Options: `LOW`, `HIGH` |
| Delay fields | Spinbox | min 0, max 60000, step 50, suffix "ms" |
| Timeout field | Spinbox | min 0, max 60000, step 1000, suffix "ms" |
| Command field | Entry | width ~40 chars |
| Expect Resp field | Entry | width ~40 chars |
| Is Prefix checkbox | Checkbutton | — |
| Enabled checkbox | Checkbutton | tick = enabled trong JSON |
| Group header | Label + Button | click collapse/expand tất cả items trong nhóm |
| Function item header | Label + Checkbutton | arrow ▸/▾ expand; checkbox Enabled |
