# TODO_ADD_APP — PC App v5.0: LoRa + Zigbee + JSON Config Builder

> **Phạm vi**: Cập nhật `DATN_config_app` lên thiết kế v5.0.
> Xem chi tiết thiết kế tổng thể ở `DATN_config_app/implement.md`.

---

## Tóm tắt thay đổi kiến trúc

| Thành phần | Trước (v4.0) | Sau (v5.0) |
|-----------|--------------|-----------|
| Advanced tab BLE | Gửi AT command trực tiếp | JSON Config Builder |
| Advanced tab LoRa | Gửi AT command trực tiếp | JSON Config Builder |
| Advanced tab Zigbee | Gửi AT command trực tiếp | JSON Config Builder |
| Basic tab module | Nút gửi lệnh cơ bản | Info Card read-only |
| Hiển thị advanced tab | Chỉ khi stack ID khớp | **Luôn hiển thị** |
| Giao tiếp | UART only | UART / SPI / I2C / USB |

---

## Task 1 – Fix cmd_prefix typo trong `stack_id_map.json`

**File**: `src/config/stack_id_map.json`

Stack `001` có `"cmd_prefix": "CFZG"` nhưng firmware dùng `CFZB`.

```json
// TRƯỚC (bug)
"001": {
  "type":       "ZIGBEE",
  "cmd_prefix": "CFZG"
  ...
}

// SAU (đúng)
"001": {
  "type":       "ZIGBEE",
  "cmd_prefix": "CFZB"
  ...
}
```

---

## Task 2 – Thêm Type dropdown vào Connection Bar

**File**: `src/ui/connection_bar.py`

Thêm dropdown `Type` giữa Scan button và Baud dropdown:

```
Port:[COM3▼] [Refresh] [🔍 Scan]  Type:[UART▼]  Baud:[115200▼]  [Connect]
```

- Options: `UART` | `USB` | `SPI` | `I2C`
- Khi type = SPI hoặc I2C: disable baud selector, hiện note "settings in JSON"
- Khi type = UART hoặc USB: enable baud selector (như cũ)

---

## Task 3 – `load_module_config()` helper trong `paths.py`

**File**: `src/config/paths.py`

```python
def load_module_config(stack_id: str) -> Optional[dict]:
    """Load stack_00X_config.json for given stack_id.
    Returns parsed dict or None if not found."""
    data = load_stack_id_map()
    entry = data.get("lan_stack_map", {}).get(stack_id, {})
    gj = entry.get("gateway_json")
    if not gj:
        return None
    path = _resource_path(f"src/config/{gj}")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None
```

---

## Task 4 – Basic mode: Info Card cho tất cả module type

### 4.1 Sửa `ble_basic_tab.py`

Xóa toàn bộ `_btn_list`, `_manual_list`, các nút gửi lệnh, và JSON send section.
Thay bằng Info Card read-only:

```python
class BLEBasicTab(ttk.Frame):
    """Basic mode – BLE module info card (read-only)."""
    def __init__(self, parent, stack_idx, stack_id, **kwargs): ...
    def _build(self): ...  # renders info card từ load_module_config(stack_id)
```

Các trường hiển thị:

| Label | Nguồn |
|-------|-------|
| Module Name | `module_name` |
| Stack ID | `module_id` |
| Module Type | `module_type` |
| Communication | `module_communication.port_type` |
| Baudrate | `module_communication.parameters.baudrate` |
| Parity / Stop bit | `parity` / `stopbit` |
| Total functions | `len(functions)` |

Nút `[📂 View JSON]`: mở dialog read-only xem JSON đầy đủ.
Label dưới cùng: `"💡 Use Advanced Mode to configure this module."`

### 4.2 Tạo `lora_basic_tab.py`

**File**: `src/ui/basic/lora_basic_tab.py`

Mirror hoàn toàn `ble_basic_tab.py` mới (chỉ đổi emoji và default stack_id).

### 4.3 Tạo `zigbee_basic_tab.py`

**File**: `src/ui/basic/zigbee_basic_tab.py`

Mirror `lora_basic_tab.py`.

### 4.4 Sửa `basic_panel.py`

**File**: `src/ui/basic/basic_panel.py`

Cập nhật `_LAN_STACK_REGISTRY` để đọc từ `stack_id_map.json` và map đúng tab class:

```python
from src.ui.basic.ble_basic_tab     import BLEBasicTab
from src.ui.basic.lora_basic_tab    import LoRaBasicTab
from src.ui.basic.zigbee_basic_tab  import ZigbeeBasicTab

_BASIC_TYPE_TO_TAB = {
    "BLE":    BLEBasicTab,
    "LORA":   LoRaBasicTab,
    "ZIGBEE": ZigbeeBasicTab,
}

_BASIC_TYPE_TO_EMOJI = {
    "BLE":    "🔷",
    "LORA":   "🟩",
    "ZIGBEE": "🔶",
}
```

Logic `set_config()`: chỉ add tab khi `stack_id` tồn tại trong `stack_id_map.json` với type có trong `_BASIC_TYPE_TO_TAB`. Stack "000" hoặc unknown → không add.

---

## Task 5 – Advanced mode: Shared config_form.py

**File**: `src/ui/advanced/config_form.py`

Widget dùng chung cho tất cả tab module trong advanced mode. Gồm:

### 5.1 CommunicationSection

```
Port type: [uart ▼]      ← thay đổi ẩn/hiện các field bên dưới
Baudrate:  [115200 ▼]    ← active khi uart / usb
Parity:    [none ▼]      ← active khi uart
Stop bit:  [1 ▼]         ← active khi uart
── SPI only ──
SPI mode:  [0 ▼]
Clock Hz:  [1000000]
CS pin:    [05___]
── I2C only ──
I2C addr:  [0x60]
Clock Hz:  [400000]
```

### 5.2 FunctionListSection

Accordion theo nhóm (Lifecycle, Network, Discovery, …):

```python
group_order = {
    "BLE":    ["system", "info", "scan", "connection", "discovery", "data", "config"],
    "LORA":   ["system", "region", "otaa", "abp", "mac_rf", "data"],
    "ZIGBEE": ["lifecycle", "network", "discovery", "zcl", "data"],
}
```

Mỗi function item: header (tên + checkbox Enabled) + body (các field).
Body collapse/expand khi click header.

Fields render theo loại function (xem `stack_00X_config.json` schema):
- `command` → Entry
- `is_prefix` → Checkbox
- `cmd_type`, `cmd_code` → Entry int/hex (chỉ hiện khi zigbee + value != -1)
- `response_format` → Dropdown ascii/hex
- `expect_response` → Entry
- `timeout` → Spinbox ms
- `gpio_start_control` / `gpio_end_control` → dynamic list (pin + state pairs + [+Add] [-Remove])
- `delay_start` / `delay_end` → Spinbox ms

### 5.3 JsonPreviewSection

```python
self._preview = tk.Text(...)  # tự động cập nhật khi form thay đổi
```

- Realtime update: mỗi thay đổi trong form gọi `_rebuild_json()`
- Cho phép edit trực tiếp → parse lại → update form (2-way binding)
- JSON minify khi gửi; pretty-print khi hiển thị

### 5.4 ActionSection

```python
[📋 Copy JSON]  [💾 Save JSON]
[📂 Load JSON]  [📤 Send to Gateway]
```

`Send to Gateway` → gửi `f"CF{PREFIX}:JSON:{minified_json}\r\n"` qua `serial_manager`.

### 5.5 API của ConfigForm

```python
class ConfigForm(ttk.Frame):
    def load_from_dict(self, config: dict) -> None: ...
    def get_as_dict(self) -> dict: ...
    def set_module_type(self, module_type: str) -> None: ...
    def set_cmd_prefix(self, prefix: str) -> None: ...
    def set_stack_idx(self, idx: int) -> None: ...
```

---

## Task 6 – Rewrite Advanced tabs dùng ConfigForm

### 6.1 `ble_tab.py`

```python
class BLETab(ttk.Frame):
    def __init__(self, parent, serial_manager, log_callback, **kwargs):
        # Header: Stack selector (S1/S2) + Module selector (filtered by type=BLE)
        # Body: ConfigForm(module_type="BLE", ...)
```

Module selector build từ `stack_id_map.json`, lấy tất cả entries có `type == "BLE"`.
Chọn module → `load_module_config(stack_id)` → `form.load_from_dict(config)`.

### 6.2 `lora_tab.py`

Mirror `ble_tab.py`, type = `"LORA"`, prefix = `"CFLR"`.

### 6.3 `zigbee_tab.py`

Mirror `ble_tab.py`, type = `"ZIGBEE"`, prefix = `"CFZB"`.
Thêm: trong `ConfigForm`, Zigbee functions hiển thị thêm `cmd_type` / `cmd_code` fields.

---

## Task 7 – Sửa `advanced_panel.py`

**File**: `src/ui/advanced/advanced_panel.py`

Thay đổi: BLE / LoRa / Zigbee tabs được add **một lần duy nhất tại `__init__`**, không dynamic add/remove theo stack ID báo về.

```python
# Trong _create_widgets():
self.ble_tab     = BLETab(self.notebook, ...)
self.lora_tab    = LoRaTab(self.notebook, ...)
self.zigbee_tab  = ZigbeeTab(self.notebook, ...)
self.notebook.add(self.ble_tab,     text="🔷 BLE")
self.notebook.add(self.lora_tab,    text="🟩 LoRa")
self.notebook.add(self.zigbee_tab,  text="🔶 Zigbee")
```

Bỏ toàn bộ `_stack_tabs` dict, `_build_stack_registry()`, `_STACK_TYPE_REGISTRY`.

`set_config()` vẫn cập nhật wifi/lte/server/firmware tabs như cũ.
BLE/LoRa/Zigbee tabs: gọi `tab.notify_stack_info(stack_info)` để tab tự set default stack slot selector nếu muốn (optional improvement).

---

## Task 8 – Test checklist

- [ ] Basic mode: stack ID = "002" → tab "🔷 BLE (S1)" với Info Card đúng
- [ ] Basic mode: stack ID = "000" hoặc unknown → không add tab
- [ ] Basic mode: "View JSON" mở dialog read-only đúng file
- [ ] Advanced mode: BLE / LoRa / Zigbee tabs luôn hiện khi switch sang advanced
- [ ] Advanced mode: chọn module → form điền giá trị từ JSON file
- [ ] Advanced mode: thay đổi form → JSON preview cập nhật realtime
- [ ] Advanced mode: edit JSON preview trực tiếp → form đồng bộ
- [ ] Advanced mode: Send → gateway nhận `CFBL:JSON:...\r\n` → `PARSE_OK`
- [ ] Connection bar: Type = SPI → baud ẩn, note hiện; Type = UART → baud hiện
- [ ] Communication section: port_type = spi → JSON có SPI params đúng
- [ ] Communication section: port_type = i2c → JSON có I2C params đúng
- [ ] Zigbee tab: cmd_type / cmd_code fields hiển thị và ghi vào JSON đúng
