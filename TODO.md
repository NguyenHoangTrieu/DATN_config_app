## Nội dung chỉnh sửa lại App:
### Task 1:loại bỏ debug window trong app (xóa phần liên quan đến debug window trong code)
### Task 2: cơ chế scan gateway thông qua cổng uart / usb cắm vào như sau:
1. người dùng cắm thiết bị vào cổng usb
2. máy tính nhận diện cổng usb, lấy descriptor của thiết bị usb to uart (các dòng ch340, cp2102,v.v hoặc usb serial thông qua jtag)
3. sau khi đã có descriptor của các device  dạng nói trên, tiến hành scan các cổng uart có thể kết nối với gateway (ví dụ: COM1, COM2, COM3,...) cổng nào trả về chuỗi giá trị key chính xác thì chính là gateway cần kết nối.
4. chỉ hiển thị cổng uart nào xác định là gateway, người dùng chọn cổng đó để kết nối với gateway, các cổng còn lại dù là cổng usb to uart nhưng không phải gateway (không đọc đúng key) sẽ không hiển thị trong app.
5. sau khi người dùng chọn cổng uart, tiến hành kết nối với gateway thông qua cổng đó và hiển thị thông tin gateway trên app.
### Task 3: Cơ chế hiển thị các config cần được sửa lại như sau:
1. sau khi kết nối gateway thành công qua uart, app sẽ gửi lệnh yêu cầu gateway trả về thông tin cấu hình hiện tại của gateway (bao gồm: tên wifi, mật khẩu wifi, tên mqtt server, cổng mqtt server, username mqtt server, password mqtt server, stack id, v.v) (có 2 cơ chế tự động và thủ công, đầu tiên mới có kết nối sẽ tự động scan, sau đó nếu cần scan lại user cần nhấn nút scan thủ công (nút nhấn thủ công đã có trong code cũ, kg cần imple mới))
2. sau khi nhận được thông tin cấu hình từ gateway, app sẽ hiển thị các thông tin này trên giao diện người dùng, tùy theo stack id của LAN và WAN mà app sẽ hiển thị các trường thông tin tương ứng cụ thể, còn các trường thông tin không liên quan đến stack id đó sẽ được ẩn đi để tránh gây nhầm lẫn cho người dùng và giúp giao diện người dùng trở nên gọn gàng hơn.
Format config gửi về cụ thể như sau:
CFSC_RESP:START
[GATEWAY_INFO]
model=ESP32S3_IoT_Gateway
firmware=v1.2.0
hardware=HW_v2.0
serial=GW2025001
internet_status=ONLINE
rtc_time=UNAVAILABLE
[WAN_CONFIG]
internet_type=WIFI
wifi_ssid=Devil
wifi_password=***HIDDEN***
wifi_username=
wifi_auth_mode=0
lte_apn=
lte_username=
lte_password=
lte_comm_type=USB
lte_max_retries=0
lte_timeout_ms=30000
lte_auto_reconnect=false
lte_modem_name=
lte_pwr_pin=WK
lte_rst_pin=PE
server_type=MQTT
mqtt_broker=mqtt://demo.thingsboard.io:1883
mqtt_pub_topic=v1/devices/me/telemetry
mqtt_sub_topic=v1/devices/me/rpc/request/+
mqtt_device_token=***HIDDEN***
mqtt_attribute_topic=v1/devices/me/attributes
stack_wan_id=001
[LAN_CONFIG]
stack1_id=002
stack2_id=000
rs485_baudrate=115200
stack1_json_len=0
stack2_json_len=0
CFSC_RESP:END
- Ở LAN:
logic thực hiện như sau:
1. app check stack id của LAN thông qua việc đọc config theo format trên
2. sau khi có stack id của LAN, app check id của chúng - nếu id là 000 stack này đang rỗng kg có adapter cắm vào -> kg check stack json len của stack này
3. nếu stack id khác 000, (001, 002) app sẽ check tiếp json len của stack đó, nếu json len = 0, app sẽ gửi file json config cho gateway, nếu json len > app kg gửi gì cả (tự động hiểu stack json đã có trên gateway) áp dụng cho cả stack1 và stack2, nếu 1 trong 2 stack có id khác 000 và json len = 0 thì app sẽ gửi file json config tương ứng cho stack đó, nếu cả 2 stack đều có id khác 000 và json len > 0 thì app kg gửi gì cả.
4. khi nhận được stack id tương ứng, app sẽ hiển thị thông tin config và các UI tương tác tương ứng với loại stack đó, ví dụ stack id 001 là stack zigbee thì app sẽ hiển thị các trường thông tin và UI tương tác liên quan đến zigbee, nếu stack id 002 là stack ble thì app sẽ hiển thị các trường thông tin và UI tương tác liên quan đến ble, v.v (gồm advance mode và basic mode, cụ thể cho từng chức năng sẽ được miêu tả sau).
5. trong advance mode của app cần thực hiện chức năng custom json config, người dùng có thể gửi files json config tùy chỉnh của riêng họ thông qua app cho gateway tuy nhiên cần đảm bảo file json này có cấu trúc đúng theo yêu cầu của gateway, nếu file json có cấu trúc sai hoặc thiếu trường thông tin bắt buộc thì app sẽ nhận được parse fail từ gateway và hiển thị lỗi cho người dùng, nếu file json có cấu trúc đúng và đầy đủ trường thông tin bắt buộc thì app sẽ nhận được parse success từ gateway và hiển thị thông báo thành công cho người dùng. (check các thông báo lỗi và thành công cụ thể sẽ được miêu tả sau).
- Ở WAN:
Ở WAN chỉ có duy nhất một khe cắm adapter và một loại stack đó là stack cho lte module (tùy loại module sẽ tương ứng với adapter có stakck id khác nhau, ví dụ stack id 001 là stack cho lte module của quectel, stack id 002 là stack cho lte module của simcom, v.v) logic thực hiện như sau:
1. app check stack id của WAN thông qua việc đọc config theo format trên
2. sau khi có stack id gửi command format dạng:
CFLT:MODEM_NAME:APN:USERNAME:PASSWORD:COMM_TYPE:AUTO_RECONNECT:RECONNECT_TIMEOUT:MAX_RECONNECT:PWR_PIN:RST_PIN
Example: CFLT:A7600C1:v-internet:user:pass:USB:true:30000:0:WK:PE
các thông số:
+ MODEM_NAME: tên modem lte (ví dụ: A7600C1, E3372, v.v), trong basic mode thông số này sẽ được đặt sẵn theo stack id nhận được tương ứng với loại modem lte nào trong basic mode (kg hiển thị trong basic mode), trong advance mode thông số này sẽ được người dùng nhập thủ công trong app.
+ APN: tên apn của sim lte đang sử dụng (ví dụ: v-internet, m-wap, v-internet, v-internet, etc), thông số này sẽ được người dùng nhập thủ công trong app trong cả basic mode và advance mode
+ USERNAME: username của sim lte (nếu có), thông số này sẽ được người dùng nhập thủ công trong app trong cả basic mode và advance mode, nếu sim lte kg có username thì để trống thông số này khi nhập trong app.
+ PASSWORD: password của sim lte (nếu có), thông số này sẽ được người dùng nhập thủ công trong app trong cả basic mode và advance mode, nếu sim lte kg có password thì để trống thông số này khi nhập trong app.
+ COMM_TYPE: loại cổng giao tiếp giữa modem lte và gateway (ví dụ: USB, UART), trong basic mode thông số này sẽ được đặt sẵn theo stack id nhận được tương ứng với loại modem lte nào trong basic mode (kg hiển thị trong basic mode), trong advance mode thông số này sẽ được người dùng nhập thủ công trong app.
+ AUTO_RECONNECT: chế độ tự động kết nối lại khi mất kết nối (true/false), basic mode (kg hiển thị) mặc đinh là true, advance mode người dùng có thể tùy chỉnh true hoặc false.
+ RECONNECT_TIMEOUT: thời gian chờ giữa các lần thử kết nối lại (tính bằng ms), basic mode (kg hiển thị) mặc định là 30000ms, advance mode người dùng có thể tùy chỉnh thời gian chờ này.
+ MAX_RECONNECT: số lần thử kết nối lại tối đa, basic mode (kg hiển thị) mặc định là 0 (không giới hạn), advance mode người dùng có thể tùy chỉnh số lần thử kết nối lại này.
+ PWR_PIN: chân pwr của module, basic mode (kg hiển thị) mặc định là theo config lưu sẵn dựa theo stack ID, advance mode người dùng có thể tùy chỉnh chân pwr này bằng cách chọn các option có sẵn trong app bao gồm "WK" (WAKE#), "PE" (PERST#), hoặc "01".."11" tương ứng với numbered GPIO pins 0-10.
+ RST_PIN: chân reset của module, basic mode (kg hiển thị) mặc định theo config lưu sẵn dựa theo stack ID, advance mode người dùng có thể tùy chỉnh chân reset này bằng cách chọn các option có sẵn trong app bao gồm "WK" (WAKE#), "PE" (PERST#), hoặc "01".."11" tương ứng với numbered GPIO pins 0-10.
+ cần một file json để lưu trữ các config tương ứng với từng stack id của lte module để có giá trị mặc định như đã nói ở trên.
- Các phần cần xóa bỏ:
+ LORA, CAN, RS485 trong phần config của advance mode vì các chức năng này sẽ được cập nhật lại, theo dạng hiển thị nếu có stack id tương ứng nói trên, chức năng và hiển thị của chúng cũng sẽ được cập nhật lại sau.
### Cập nhật lại config cho server:
- Cập nhật thêm server CoAP, HTTP/HTTPS, vào phần config của app, cụ thể mô tả sau.
- Trong config cả basic mode và advance mode các thông tin config của các kiểu server (MQTT, CoAP, HTTP/HTTPS) sẽ không hiển thị nếu người dùng kg chọn kiểu giao tiếp server đó, ví dụ khi vào giao diện, người dùng sẽ thấy một thanh tùy chọn kiểu server để kết nối (ví dụ: MQTT, CoAP, HTTP/HTTPS), nếu người dùng chọn MQTT thì chỉ có các trường thông tin config của MQTT mới hiển thị, các trường thông tin config của CoAP và HTTP/HTTPS sẽ được ẩn đi, nếu người dùng chọn CoAP thì chỉ có các trường thông tin config của CoAP mới hiển thị, các trường thông tin config của MQTT và HTTP/HTTPS sẽ được ẩn đi, nếu người dùng chọn HTTP/HTTPS thì chỉ có các trường thông tin config của HTTP/HTTPS mới hiển thị, các trường thông tin config của MQTT và CoAP sẽ được ẩn đi.

### Các phần cần làm:
1. ✅ thực hiện task 1
2. viết implementation plan cho task 2 theo đúng logic đã mô tả ở trên
3. viết implementation plan cho task 3 theo đúng logic đã mô tả ở trên, thiết kế thêm cho tôi cơ chế hoạt động của ble config (cả basic mode và advance mode) sao cho nó đảm bảo được chức năng để người dùng có thể scan thiết bị, thực hiện hiện các chức năng của ble (như các chức năng trong file json ble). cụ thể tham khảo các file đã gửi.

---

## IMPLEMENTATION PLAN — TASK 2: Gateway USB/UART Scan

### Mục tiêu
Thay thế cơ chế chọn port thủ công bằng cơ chế tự động scan, chỉ hiển thị port nào xác nhận là gateway.

### Bước 1 — Lọc port USB-Serial có thể là gateway (`serial/manager.py`)

Thêm method `list_gateway_candidate_ports()`:
- Dùng `serial.tools.list_ports.comports()` để liệt kê tất cả port.
- Lọc theo VID/PID của các chip USB-UART phổ biến:
  | Chip | VID | Note |
  |---|---|---|
  | CH340/CH341 | `0x1A86` | Phổ biến trên board giá rẻ |
  | CP2102/CP2104 | `0x10C4` | Silicon Labs |
  | FT232 | `0x0403` | FTDI |
  | ESP32 JTAG USB | `0x303A` | Native USB |
- Trả về `List[Tuple[str, str]]` (port_name, description) chỉ gồm port pass filter.

### Bước 2 — Probe từng port để xác nhận là gateway (`serial/manager.py`)

Thêm method `probe_gateway_port(port: str, baudrate: int = 115200, timeout: float = 2.0) -> bool`:
1. Mở port với timeout ngắn (2s).
2. Gửi lệnh `CFSC\r\n`.
3. Đọc response trong 2s.
4. Nếu response chứa `CFSC_RESP:START` → trả về `True`.
5. Đóng port, trả về `False` nếu timeout hoặc không đúng key.

Thêm method `scan_for_gateways(baudrate: int = 115200, progress_callback=None) -> List[Tuple[str, str]]`:
1. Gọi `list_gateway_candidate_ports()`.
2. Với mỗi candidate, gọi `probe_gateway_port()` trong thread riêng (parallel probe).
3. Gọi `progress_callback(current, total, port_name)` để cập nhật progress bar trong UI.
4. Trả về list `(port_name, description)` của các port xác nhận là gateway.

### Bước 3 — Cập nhật `ConnectionBar` (`ui/connection_bar.py`)

- Thêm button **"🔍 Scan Gateways"** bên cạnh Refresh.
- Khi nhấn Scan:
  1. Disable scan button, hiển thị `"Scanning..."`.
  2. Chạy `serial_manager.scan_for_gateways()` trong background thread.
  3. Hiển thị progress bar nhỏ (ttk.Progressbar) trong khi scan.
  4. Khi xong: populate combo chỉ với các port là gateway, hide progress bar, re-enable button.
  5. Nếu tìm được đúng 1 gateway → auto-select nó trong combo.
  6. Nếu không tìm thấy → hiển thị messagebox "No gateway found".
- `Refresh` button giữ nguyên (liệt kê tất cả port không lọc, để user có thể kết nối thủ công nếu cần).

### Bước 4 — Cập nhật `main.py`

- Pass `serial_manager` vào `ConnectionBar`.
- Sau khi scan xong, nếu gateway được tìm thấy: populate combo với các port tìm được, người dùng chọn cổng và nhấn **Connect** thủ công.
- Khi kết nối thành công → auto-send `CFSC` để tải config (flow tự động đã có sẵn).

### Sequence Diagram

```
User plug USB
     │
     ▼
[Click Scan Gateways]
     │
     ▼
list_gateway_candidate_ports()   ← filter by VID/PID descriptor
     │  (e.g. COM3 CH340, COM4 USB Serial Device (ESP32-S3 JTAG), COM5 CP2102)
     ▼
probe_gateway_port(COM3) ─────── open → send CFSC → wait 2s → CFSC_RESP:START? YES ✓
probe_gateway_port(COM4) ─────── open → send CFSC → wait 2s → CFSC_RESP:START? YES ✓
probe_gateway_port(COM5) ─────── open → send CFSC → wait 2s → timeout? NO ✗
     │
     ▼
Show COM3 and COM4 in dropdown (COM5 excluded — not a gateway)
User selects COM3 or COM4, clicks Connect manually
     │
     ▼
Auto-send CFSC → parse config → update UI panels
```

### Files cần thay đổi
| File | Thay đổi |
|---|---|
| `src/serial/manager.py` | Thêm `list_gateway_candidate_ports()`, `probe_gateway_port()`, `scan_for_gateways()` |
| `src/ui/connection_bar.py` | Thêm Scan button, progress bar, filter combo values |
| `main.py` | Pass serial_manager vào ConnectionBar |

---

## IMPLEMENTATION PLAN — TASK 3: Config Display & BLE Config

### 3.1 Cập nhật Data Model (`src/config/protocol.py`)

#### WanConfig — thêm fields mới
```python
lte_modem_name: str = ""
lte_pwr_pin: str = "WK"     # "WK", "PE", "01".."11"
lte_rst_pin: str = "PE"
stack_wan_id: str = "000"   # "000"=no adapter, "001"=Quectel, "002"=SIMCom, ...
```

#### LanConfig — thay LoraConfig/CanConfig bằng stack-based
```python
@dataclass
class LanStackInfo:
    stack1_id: str = "000"        # raw stack ID from gateway
    stack2_id: str = "000"
    rs485_baudrate: int = 115200
    stack1_json_len: int = 0      # 0 = no JSON stored on gateway
    stack2_json_len: int = 0
```

#### Stack ID → Type mapping (JSON file: `src/config/stack_id_map.json`)
```json
{
  "wan_stack_map": {
    "000": {"type": "NONE",    "modem": "",        "comm_type": "USB"},
    "001": {"type": "QUECTEL", "modem": "A7600C1", "comm_type": "USB", "pwr": "WK", "rst": "PE"},
    "002": {"type": "SIMCOM",  "modem": "SIM7600", "comm_type": "USB", "pwr": "WK", "rst": "PE"}
  },
  "lan_stack_map": {
    "000": {"type": "NONE"},
    "001": {"type": "ZIGBEE"},
    "002": {"type": "BLE"}
  }
}
```

#### ConfigParser — cập nhật `_set_config_value()`
- Map `stack1_id`, `stack2_id`, `stack1_json_len`, `stack2_json_len`, `rs485_baudrate` vào `LanStackInfo`.
- Map `stack_wan_id`, `lte_modem_name`, `lte_pwr_pin`, `lte_rst_pin` vào `WanConfig`.

### 3.2 Basic Panel — Logic hiển thị theo Stack ID

#### Tab "Interfaces" → Thay bằng tab động
- Sau khi `set_config()` được gọi:
  1. Query `stack1_id`, `stack2_id` từ config.
  2. Dùng `stack_id_map.json` để xác định type của từng stack.
  3. Ẩn/hiện tab tương ứng:
     - `"000"` → ẩn tab đó.
     - `"001"` (ZIGBEE) → hiện tab Zigbee (hiện chưa có → để trống "Coming soon").
     - `"002"` (BLE) → hiện tab BLE Basic.
  4. Tab WAN LTE:
     - `stack_wan_id == "000"` → ẩn toàn bộ fields LTE.
     - `stack_wan_id != "000"` → hiện LTE fields, điền defaults từ stack_id_map.

#### LTE Basic Mode — Logic gửi config
- Khi user nhấn "Set LTE":
  1. Load defaults từ `stack_id_map.json` theo `stack_wan_id`.
  2. Đính các giá trị user nhập (APN, username, password).
  3. Build command: `CFLT:MODEM:APN:USER:PASS:COMM_TYPE:true:30000:0:PWR_PIN:RST_PIN`.
  4. Send.

#### JSON Auto-send Logic (sau khi nhận CFSC response)
```
for stack in [stack1, stack2]:
    if stack.id != "000" and stack.json_len == 0:
        → mở file picker để chọn JSON file cho stack đó
        → send: CFBL:JSON:{stack_idx}:{json_content}  (nếu BLE, stack_idx = 0 hoặc 1)
        → (các type khác sẽ bổ sung sau)
```

### 3.3 Advanced Panel — Xóa LoRa/CAN/RS485, Thêm BLE tab

#### Xóa
- Xóa import và instantiation của `LoraTab`, `CanTab`, `Rs485Tab` trong `advanced_panel.py`.
- Xóa các file `lora_tab.py`, `can_tab.py`, `rs485_tab.py` (không xóa file, chỉ exclude khỏi notebook).

---

### 3.4 BLE TAB REFACTOR — THIẾT KẾ MỚI

> **Trạng thái: DUYỆT Ý TƯỞNG — chưa code**

#### Phân tích lỗi hiện tại (từ firmware LAN MCU)

Sau khi đọc kỹ code firmware (`config_handler_ble_commands.c`, `ble_handler.c`,
`ble_handler_task.c`), phát hiện **3 lỗi nghiêm trọng** trong `app_commands.json`:

**Lỗi 1: `gateway_command` dùng tên function thay vì AT command thật**

`ble_handler_execute_command_with_config()` gửi `cmd_req.command` (string từ app)
**trực tiếp qua UART** cho BLE module, KHÔNG dùng `func_config.command` từ JSON.

- Sai: App gửi `CFBL:0:MODULE_SW_RESET` → UART gửi `MODULE_SW_RESET\r\n` → module không hiểu!
- Đúng: App gửi `CFBL:0:AT+RESET` → UART gửi `AT+RESET\r\n` → module hiểu ✅

Ngoại lệ GPIO-only: `MODULE_WAKEUP` (command="" trong JSON) → firmware detect `is_gpio_only=true`
→ skip UART hoàn toàn, chỉ toggle GPIO + delay → dùng function name OK.

**Lỗi 2: Format command thừa dấu `:` giữa prefix và param**

- Sai: `CFBL:0:AT+CONNECT=:001122334455` (thừa `:` sau `=`)
- Đúng: `CFBL:0:AT+CONNECT=001122334455` (nối trực tiếp) ✅

**Lỗi 3: Có function không tồn tại trong config thật**

- `SET_COMM_CONFIG` / `AT+UART=` — không phải chức năng thật của BLE module → xóa
- `HW_RESET` — bỏ khỏi UI, tránh user vô tình toggle GPIO reset → xóa

---

#### Phân loại 18 function (từ `stack_002_config.json`, bỏ HW_RESET và SET_COMM_CONFIG)

**9 Button (nhấn 1 lần, gửi command cố định — không nhập gì):**

| # | function_name | Command gửi | Label | Group | Ghi chú |
|---|---|---|---|---|---|
| 1 | MODULE_SW_RESET | `AT+RESET` | SW Reset | system | |
| 2 | MODULE_FACTORY_RESET | `AT+RESTORE` | Factory Reset | system | |
| 3 | MODULE_ENTER_CMD_MODE | `AT+CMDMODE` | CMD Mode | system | |
| 4 | MODULE_ENTER_SLEEP | `AT+SLEEP` | Sleep | system | |
| 5 | MODULE_WAKEUP | `MODULE_WAKEUP` | Wakeup | system | GPIO-only, skip UART |
| 6 | MODULE_GET_INFO | `AT+VER` | Get Info | info | |
| 7 | MODULE_GET_CONNECTION_STATUS | `AT+LIST` | Get Status | info | |
| 8 | MODULE_START_BROADCAST | `AT+ADV=1` | Broadcast | broadcast | |
| 9 | MODULE_START_DISCOVERY | `AT+SCAN=5000` | Scan | scan | Duration mặc định trong JSON |

> ⚠️ SCAN label = "Scan" (không ghi duration). Duration mặc định `=5000` nằm trong JSON.

**9 Manual Entry (ô nhập param + nút Send):**

| # | function_name | AT Prefix | Example | param_hint | Group |
|---|---|---|---|---|---|
| 1 | MODULE_SET_NAME | `AT+NAME=` | `AT+NAME=MyBLEDevice` | `device_name` | config |
| 2 | MODULE_SET_RF_PARAMS | `AT+RF=` | `AT+RF=0,10` | `tx_power,channel` | config |
| 3 | MODULE_CONNECT | `AT+CONNECT=` | `AT+CONNECT=001122334455` | `MAC_address` | connection |
| 4 | MODULE_DISCONNECT | `AT+DISCONNECT=` | `AT+DISCONNECT=0` | `conn_handle` | connection |
| 5 | MODULE_ENTER_DATA_MODE | `AT+DATAMODE=` | `AT+DATAMODE=0` | `conn_handle` | connection |
| 6 | MODULE_DISCOVER_SERVICES | `AT+DISC=` | `AT+DISC=0` | `conn_handle` | discovery |
| 7 | MODULE_DISCOVER_CHARACTERISTICS | `AT+CHARS=` | `AT+CHARS=0` | `conn_handle` | discovery |
| 8 | MODULE_SEND_DATA | `AT+WRITE=` | `AT+WRITE=0,1,48656C6C6F` | `conn,char,hex_data` | data |
| 9 | MODULE_GET_DIAGNOSTICS | `AT+INFO=` | `AT+INFO=all` | `all hoặc conn_handle` | info |

> Manual entry: placeholder hiển thị `param_hint`, tooltip/label phụ hiển thị `example` đầy đủ.

---

#### Schema mới cho `app_commands.json`

```json
{
    "module_id": "002",
    "module_type": "BLE",
    "module_name": "STM32WB55 BLE",
    "cmd_prefix": "CFBL",

    "button_functions": [
        { "id": "SW_RESET",        "command": "AT+RESET",        "label": "SW Reset",     "group": "system" },
        { "id": "FACTORY_RESET",   "command": "AT+RESTORE",      "label": "Factory Reset","group": "system" },
        { "id": "ENTER_CMD_MODE",  "command": "AT+CMDMODE",      "label": "CMD Mode",     "group": "system" },
        { "id": "ENTER_SLEEP",     "command": "AT+SLEEP",        "label": "Sleep",        "group": "system" },
        { "id": "WAKEUP",          "command": "MODULE_WAKEUP",   "label": "Wakeup",       "group": "system" },
        { "id": "GET_INFO",        "command": "AT+VER",          "label": "Get Info",     "group": "info" },
        { "id": "GET_STATUS",      "command": "AT+LIST",         "label": "Get Status",   "group": "info" },
        { "id": "START_BROADCAST", "command": "AT+ADV=1",        "label": "Broadcast",    "group": "broadcast" },
        { "id": "SCAN",            "command": "AT+SCAN=5000",    "label": "Scan",         "group": "scan" }
    ],

    "manual_functions": [
        { "id": "SET_NAME",          "command_prefix": "AT+NAME=",       "label": "Set Name",        "group": "config",     "param_hint": "device_name",        "example": "AT+NAME=MyBLEDevice" },
        { "id": "SET_RF_PARAMS",     "command_prefix": "AT+RF=",         "label": "Set RF Params",   "group": "config",     "param_hint": "tx_power,channel",   "example": "AT+RF=0,10" },
        { "id": "CONNECT",           "command_prefix": "AT+CONNECT=",    "label": "Connect",         "group": "connection", "param_hint": "MAC_address",        "example": "AT+CONNECT=001122334455" },
        { "id": "DISCONNECT",        "command_prefix": "AT+DISCONNECT=",  "label": "Disconnect",     "group": "connection", "param_hint": "conn_handle",        "example": "AT+DISCONNECT=0" },
        { "id": "ENTER_DATA_MODE",   "command_prefix": "AT+DATAMODE=",   "label": "Data Mode",       "group": "connection", "param_hint": "conn_handle",        "example": "AT+DATAMODE=0" },
        { "id": "DISCOVER_SERVICES", "command_prefix": "AT+DISC=",       "label": "Disc Services",   "group": "discovery",  "param_hint": "conn_handle",        "example": "AT+DISC=0" },
        { "id": "DISCOVER_CHARS",    "command_prefix": "AT+CHARS=",      "label": "Disc Chars",      "group": "discovery",  "param_hint": "conn_handle",        "example": "AT+CHARS=0" },
        { "id": "SEND_DATA",         "command_prefix": "AT+WRITE=",      "label": "Send Data",       "group": "data",       "param_hint": "conn,char,hex_data", "example": "AT+WRITE=0,1,48656C6C6F" },
        { "id": "GET_DIAGNOSTICS",   "command_prefix": "AT+INFO=",       "label": "Get Diagnostics", "group": "info",       "param_hint": "all hoặc handle",    "example": "AT+INFO=all" }
    ],

    "response_patterns": {
        "ok":        "OK",
        "error":     "ERROR",
        "json_ok":   "PARSE_OK",
        "json_fail": "PARSE_FAIL"
    }
}
```

---

#### Command builder trong Python

**Button (command cố định):**
```python
f"CFML:{cmd_prefix}:{stack_idx}:{command}"
# Ví dụ: "CFML:CFBL:0:AT+RESET"
# Ví dụ: "CFML:CFBL:0:AT+SCAN=5000"
# Ví dụ: "CFML:CFBL:0:MODULE_WAKEUP"  (GPIO-only)
```

**Manual (prefix + user param — nối trực tiếp, KHÔNG có `:`):**
```python
f"CFML:{cmd_prefix}:{stack_idx}:{command_prefix}{user_input}"
# Ví dụ: "CFML:CFBL:0:AT+CONNECT=001122334455"
# Ví dụ: "CFML:CFBL:0:AT+WRITE=0,1,48656C6C6F"
```

---

#### UI Layout — Advanced Mode (`ble_tab.py`)

```
┌─────────────────────────────┬──────────────────────────┐
│ 🔄 System                   │ 📋 Response Log          │
│ [SW Reset][Factory Reset]   │                          │
│ [CMD Mode][Sleep][Wakeup]   │ ← AT+RESET               │
│                              │ ← OK                     │
│ ℹ️ Info                     │ ← AT+SCAN=5000           │
│ [Get Info][Get Status]      │ ← +SCAN:001122,dev1,-45  │
│                              │ ← +SCAN:AABBCC,dev2,-60  │
│ 📡 Broadcast                │ ← OK                     │
│ [Broadcast]                 │                          │
│                              │                          │
│ 🔍 Scan                     │                          │
│ [Scan]                      │                          │
│                              │                          │
│ ⚙️ Config                   │                          │
│ Set Name: [___hint___][Send]│                          │
│  example: AT+NAME=MyDevice  │                          │
│ Set RF:   [___hint___][Send]│                          │
│  example: AT+RF=0,10        │                          │
│                              │                          │
│ 🔗 Connection               │                          │
│ Connect:    [__MAC__][Send] │                          │
│  example: AT+CONNECT=AABB.. │                          │
│ Disconnect: [_handle][Send] │                          │
│ Data Mode:  [_handle][Send] │                          │
│                              │                          │
│ 🔎 Discovery                │                          │
│ Disc Svc:  [_handle][Send]  │                          │
│ Disc Char: [_handle][Send]  │                          │
│                              │                          │
│ 📨 Data                     │                          │
│ Send Data: [__hint__][Send] │                          │
│ Get Diag:  [__hint__][Send] │                          │
│                              │                          │
│ ℹ️ Info (manual)            │                          │
│ Get Diag:  [__hint__][Send] │                          │
│                              │                          │
│ 📤 JSON Config              │                          │
│ [Default][Custom][Send JSON]│                          │
│                              │                          │
│ 🖥️ Raw Command              │                          │
│ [________________][Send]    │                          │
└─────────────────────────────┴──────────────────────────┘
```

- Cột trái: scrollable, auto-generated từ JSON
- Cột phải: Response Log — full height, color-coded (OK=xanh, ERROR=đỏ)
- Entry placeholder = `param_hint` (mờ, xóa khi focus)
- Label phụ dưới mỗi manual entry = `example` (font nhỏ, màu xám)
- Không có scan table, handle spinner, service table — tất cả response hiện raw trong Log

---

#### UI Layout — Basic Mode (`ble_basic_tab.py`)

Basic mode: chỉ hiện chức năng cần thiết nhất, dùng nhanh cho người mới.

```
┌──────────────────────────────────────────────────────────────┐
│  🔷 BLE Stack {N}  (ID: 002 — STM32WB55 BLE)                │
├──────────────────────────────────────────────────────────────┤
│  📤 JSON Config                                              │
│  Status: [✅ Config loaded] / [⚠️ No JSON — please load]    │
│  [📋 Load Default]  [📂 Custom JSON]  [📤 Send]             │
├──────────────────────────────────────────────────────────────┤
│  ⚡ Quick Controls                                           │
│  [SW Reset]  [Get Info]  [Get Status]  [Broadcast]          │
├──────────────────────────────────────────────────────────────┤
│  🔍 Scan                                                     │
│  [Scan]                                                      │
├──────────────────────────────────────────────────────────────┤
│  🔗 Connection                                               │
│  Connect: [__MAC_address__][Send]                            │
│   example: AT+CONNECT=001122334455                           │
│  [Disconnect: handle] [___][Send]                            │
├──────────────────────────────────────────────────────────────┤
│  📋 Response                                                 │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ ← AT+SCAN=5000                                         │  │
│  │ ← +SCAN:AA:BB:CC:DD:EE:FF,DeviceName,-60              │  │
│  │ ← OK                                                   │  │
│  │ ← AT+CONNECT=AABBCCDDEEFF                              │  │
│  │ ← +CONNECTED:0                                         │  │
│  └────────────────────────────────────────────────────────┘  │
│  [🗑 Clear]                                                  │
└──────────────────────────────────────────────────────────────┘
```

**Khác biệt Basic vs Advanced:**

| Tính năng | Basic | Advanced |
|---|---|---|
| Quick Controls | SW Reset, Get Info, Get Status, Broadcast | Tất cả 9 button (bao gồm CMD Mode, Sleep, Wakeup) |
| Scan | Nút [Scan] | Nút [Scan] |
| Manual entries | Chỉ Connect + Disconnect | Tất cả 9 manual entries |
| JSON Config | Load Default + Custom + Send | Load Default + Custom + Send |
| Raw Command | ❌ Không có | ✅ Có |
| Response hiển thị | Ô nhỏ cuối trang | Cột phải full height |
| Example hints | Có | Có |

**Logic Basic:**
- Buttons: lọc `button_functions` theo group `system` (chỉ SW Reset), `info`, `broadcast`, `scan`
- Manual entries: lọc `manual_functions` theo group `connection` (chỉ Connect + Disconnect)
- Response area: nhỏ gọn, hiển thị raw text color-coded
- Không có Raw Command, không có Discovery, không có Data Transfer, không có Config (Set Name, Set RF)

---

#### Áp dụng cho cả stack 002 và 004

Cả hai stack hiện tại có cùng bộ function (đã verify `stack_002_config.json` và
`stack_004_config.json` giống nhau). Tuy nhiên:
- Mỗi stack có file `app_commands.json` riêng
- AT command có thể khác giữa các module (ví dụ `AT+RST` vs `AT+RESET`)
- Thêm stack mới: chỉ tạo 2 file JSON → app tự render UI, không sửa code Python

---

#### Response Patterns

App nhận raw UART lines từ gateway. Chỉ dùng `response_patterns` để color-code:

| Pattern | Match | Màu |
|---|---|---|
| `ok` = `"OK"` | exact match | 🟢 Xanh |
| `error` = `"ERROR"` | starts with | 🔴 Đỏ |
| `json_ok` = `"PARSE_OK"` | exact match | 🟢 Xanh + update JSON status |
| `json_fail` = `"PARSE_FAIL"` | starts with | 🔴 Đỏ + update JSON status |
| Tất cả còn lại | — | Mặc định (đen) — hiển thị raw trong Log |

> Không parse scan results thành table, không parse connection status thành widget.
> Mọi response đều hiển thị raw text — user đọc trực tiếp.

---

#### Files cần sửa

| File | Hành động | Chi tiết |
|---|---|---|
| `src/config/stack_002_app_commands.json` | **Viết lại** | Schema mới, 9 button + 9 manual, AT command thật |
| `src/config/stack_004_app_commands.json` | **Viết lại** | Tương tự 002 |
| `src/ui/advanced/ble_tab.py` | **Viết lại** | Command builder mới, bỏ `:` thừa, hiện example |
| `src/ui/basic/ble_basic_tab.py` | **Viết lại** | Basic mode theo thiết kế trên |
| `src/config/paths.py` | **Kiểm tra** | Đảm bảo `load_app_commands()` parse schema mới |

#### Thứ tự thực hiện

1. Viết lại `stack_002_app_commands.json`
2. Viết lại `stack_004_app_commands.json`
3. Viết lại `ble_tab.py` (advanced mode)
4. Viết lại `ble_basic_tab.py` (basic mode)
5. Test import + verify command format