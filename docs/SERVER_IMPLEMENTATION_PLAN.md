# Server Multi-Protocol Implementation Plan
**Các giao thức mục tiêu:** MQTT (hiện có) · HTTP/HTTPS · CoAP  
**Phạm vi:** WAN MCU firmware (`DA2_esp`) + Config App (`DATN_config_app`)

---

## 1. Hiện trạng

| Thành phần | Hiện trạng |
|---|---|
| `mqtt_handler.c/h` | Có, nhưng broker/token hardcode tại top-of-file |
| `config_handler.h` | Đã có `CONFIG_SERVERTYPE_COAP`, `CONFIG_SERVERTYPE_HTTP` nhưng chưa có struct/handler |
| `config_handler.c` | `CONFIG_TYPE_SERVER` / prefix `SV` đã parse nhưng chưa dispatch CoAP/HTTP |
| `server_tab.py` (advanced) | Combobox chỉ có `["MQTT"]`; CoAP/HTTP bị ẩn nhưng chưa implement |
| `basic_panel.py` | Chỉ có MQTT fields, không có server-type selector |

---

## 2. Phạm vi công việc

```
Task 1  ── Firmware: cấu trúc dữ liệu & NVS                     [config_handler.h/.c]
Task 2  ── Firmware: HTTP/HTTPS handler                          [http_handler.h/.c]
Task 3  ── Firmware: CoAP handler                                [coap_handler.h/.c]
Task 4  ── Firmware: config_handler – parse & dispatch           [config_handler.c]
Task 5  ── Firmware: mcu_lan_handler – switch logic              [mcu_lan_handler_uplink.c]
Task 6  ── App: protocol constants & command builder             [src/config/protocol.py]
Task 7  ── App: Advanced server_tab.py – show/hide per type      [server_tab.py]
Task 8  ── App: Basic basic_panel.py – server section rework     [basic_panel.py]
```

---

## 3. Task 1 – Firmware: cấu trúc dữ liệu & NVS

### 3.1 Thêm vào `config_handler.h`

```c
// HTTP/HTTPS configuration structure
typedef struct {
    char url[256];          // Base URL, e.g. "https://api.example.com/telemetry"
    char auth_token[128];   // Bearer token / API key (empty = no auth)
    char ca_cert_path[64];  // Path in SPIFFS (empty = skip TLS verify)
    uint16_t port;          // 80 / 443 / custom; 0 = infer from URL scheme
    uint16_t timeout_ms;    // HTTP request timeout (default 10000)
    bool use_tls;           // True when URL starts with https://
    bool verify_server;     // False = skip cert check (dev mode)
} http_config_data_t;

// CoAP configuration structure
typedef struct {
    char host[128];         // CoAP server hostname/IP
    char resource_path[128];// e.g. "/api/v1/{TOKEN}/telemetry"
    char token[65];         // Device auth token (substituted into resource_path)
    uint16_t port;          // Default 5683 (UDP) or 5684 (DTLS)
    bool use_dtls;          // True = CoAP over DTLS (port 5684)
    uint16_t ack_timeout_ms;// CON message retransmit timeout (default 2000)
    uint8_t max_retransmit; // CON retransmits (default 4, per RFC 7252)
} coap_config_data_t;
```

Thêm vào `config_type_t` enum:
```c
CONFIG_TYPE_HTTP  = 7,   // "HP" - HTTP/HTTPS configuration
CONFIG_TYPE_COAP  = 8,   // "CP" - CoAP configuration
```

Thêm vào `config_handler.h` (queue & global):
```c
extern QueueHandle_t g_http_config_queue;
extern QueueHandle_t g_coap_config_queue;

extern http_config_data_t  g_http_cfg;   // active HTTP config (NVS-backed)
extern coap_config_data_t  g_coap_cfg;   // active CoAP config (NVS-backed)
```

### 3.2 NVS keys (`config_load_save.c`)

| Key (max 15 chars) | Field |
|---|---|
| `hp_url` | HTTP URL |
| `hp_auth_token` | HTTP auth token |
| `hp_port` | HTTP port |
| `hp_use_tls` | TLS flag |
| `hp_verify_srv` | TLS verify flag |
| `hp_timeout_ms` | timeout |
| `cp_host` | CoAP host |
| `cp_resource` | resource path |
| `cp_token` | device token |
| `cp_port` | port |
| `cp_use_dtls` | DTLS flag |
| `cp_ack_to` | ack timeout |
| `cp_max_rtx` | max retransmit |

Thêm 2 hàm mới:
```c
esp_err_t save_http_config_to_nvs(void);
esp_err_t load_http_config_from_nvs(void);
esp_err_t save_coap_config_to_nvs(void);
esp_err_t load_coap_config_from_nvs(void);
```

---

## 4. Task 2 – Firmware: HTTP/HTTPS Handler

**File mới:** `DA2_esp/Application/Server_Communication_Handler/http_handler/`
```
include/
    http_handler.h
src/
    http_handler.c
```

### 4.1 `http_handler.h`
```c
#ifndef HTTP_HANDLER_H
#define HTTP_HANDLER_H

#include "esp_http_client.h"
#include "freertos/queue.h"
#include <stdint.h>
#include <stdbool.h>

// Publish data item (same layout as mqtt_publish_data_t for compatibility)
typedef struct {
    uint8_t *data;
    size_t   length;
} http_publish_data_t;

extern QueueHandle_t g_http_publish_queue;

void http_handler_task_start(void);
void http_handler_task_stop(void);
bool http_enqueue_telemetry(const uint8_t *data, size_t data_len);
void http_handler_apply_config(void);   // Re-apply config without restart

#endif // HTTP_HANDLER_H
```

### 4.2 `http_handler.c` – key logic (no hardcodes)

```c
// All config read from g_http_cfg (set by config_handler)
// Config fields used:
//   g_http_cfg.url           — POST endpoint
//   g_http_cfg.auth_token    — Authorization: Bearer <token>
//   g_http_cfg.timeout_ms    — esp_http_client timeout
//   g_http_cfg.use_tls       — HTTPS vs HTTP
//   g_http_cfg.verify_server — skip_cert_common_name_check

static void http_publish_task(void *arg) {
    http_publish_data_t item;
    while (!http_task_close) {
        if (xQueueReceive(g_http_publish_queue, &item, portMAX_DELAY) == pdTRUE) {
            esp_http_client_config_t cfg = {
                .url             = g_http_cfg.url,
                .timeout_ms      = g_http_cfg.timeout_ms,
                .skip_cert_common_name_check = !g_http_cfg.verify_server,
            };
            esp_http_client_handle_t client = esp_http_client_init(&cfg);
            if (strlen(g_http_cfg.auth_token) > 0) {
                char auth_hdr[160];
                snprintf(auth_hdr, sizeof(auth_hdr),
                         "Bearer %s", g_http_cfg.auth_token);
                esp_http_client_set_header(client, "Authorization", auth_hdr);
            }
            esp_http_client_set_header(client, "Content-Type", "application/json");
            esp_http_client_set_method(client, HTTP_METHOD_POST);
            esp_http_client_set_post_field(client,
                                           (const char *)item.data, item.length);
            esp_err_t err = esp_http_client_perform(client);
            // log response code
            esp_http_client_cleanup(client);
            free(item.data);
        }
    }
}
```

---

## 5. Task 3 – Firmware: CoAP Handler

**File mới:** `DA2_esp/Application/Server_Communication_Handler/coap_handler/`
```
include/
    coap_handler.h
src/
    coap_handler.c
```

ESP-IDF component cần thêm vào `CMakeLists.txt`: `coap`

### 5.1 `coap_handler.h`
```c
#ifndef COAP_HANDLER_H
#define COAP_HANDLER_H

#include "freertos/queue.h"
#include <stdint.h>
#include <stdbool.h>

typedef struct {
    uint8_t *data;
    size_t   length;
} coap_publish_data_t;

extern QueueHandle_t g_coap_publish_queue;

void coap_handler_task_start(void);
void coap_handler_task_stop(void);
bool coap_enqueue_telemetry(const uint8_t *data, size_t data_len);
void coap_handler_apply_config(void);

#endif // COAP_HANDLER_H
```

### 5.2 `coap_handler.c` – key logic
```c
// Config from g_coap_cfg (no hardcodes):
//   g_coap_cfg.host           — DNS/IP
//   g_coap_cfg.port           — 5683 default
//   g_coap_cfg.resource_path  — "/api/v1/{token}/telemetry" template
//   g_coap_cfg.token          — substituted into resource_path if {token} present
//   g_coap_cfg.use_dtls       — enable DTLS session
//   g_coap_cfg.ack_timeout_ms
//   g_coap_cfg.max_retransmit

static void build_resource_uri(char *out, size_t out_max) {
    // Replace "{token}" placeholder in resource_path with g_coap_cfg.token
    const char *tmpl = g_coap_cfg.resource_path;
    const char *tok  = strstr(tmpl, "{token}");
    if (tok) {
        size_t prefix_len = tok - tmpl;
        snprintf(out, out_max, "%.*s%s%s",
                 (int)prefix_len, tmpl,
                 g_coap_cfg.token,
                 tok + 7);
    } else {
        strlcpy(out, tmpl, out_max);
    }
}
```

---

## 6. Task 4 – Firmware: config_handler – parse & dispatch

### 6.1 `config_parse_type()` – thêm prefix mới
```c
} else if (cmd[0] == 'H' && cmd[1] == 'P') {
    return CONFIG_TYPE_HTTP;
} else if (cmd[0] == 'C' && cmd[1] == 'P') {
    return CONFIG_TYPE_COAP;
}
```

### 6.2 Parse functions (format giao thức từ App)

**HTTP command** – `HP:URL|AUTH_TOKEN|PORT|USE_TLS|VERIFY|TIMEOUT_MS`
```c
static esp_err_t config_parse_http(const char *data, uint16_t len,
                                    http_config_data_t *cfg) {
    // fields: url | auth_token | port | use_tls | verify_server | timeout_ms
}
```

**CoAP command** – `CP:HOST|RESOURCE_PATH|TOKEN|PORT|USE_DTLS|ACK_TIMEOUT|MAX_RTX`
```c
static esp_err_t config_parse_coap(const char *data, uint16_t len,
                                    coap_config_data_t *cfg) {
    // fields: host | resource_path | token | port | use_dtls | ack_timeout_ms | max_retransmit
}
```

### 6.3 Dispatch trong main task loop

```c
case CONFIG_TYPE_HTTP: {
    http_config_data_t http_cfg = {0};
    if (config_parse_http(cmd.raw_data + 3, cmd.data_len - 3, &http_cfg) == ESP_OK) {
        memcpy(&g_http_cfg, &http_cfg, sizeof(http_cfg));
        save_http_config_to_nvs();
        http_handler_apply_config();
        ESP_LOGI(TAG, "HTTP config updated: %s", g_http_cfg.url);
    }
    break;
}
case CONFIG_TYPE_COAP: {
    coap_config_data_t coap_cfg = {0};
    if (config_parse_coap(cmd.raw_data + 3, cmd.data_len - 3, &coap_cfg) == ESP_OK) {
        memcpy(&g_coap_cfg, &coap_cfg, sizeof(coap_cfg));
        save_coap_config_to_nvs();
        coap_handler_apply_config();
        ESP_LOGI(TAG, "CoAP config updated: %s:%d", g_coap_cfg.host, g_coap_cfg.port);
    }
    break;
}
```

---

## 7. Task 5 – Firmware: mcu_lan_handler – routing theo server type

Trong `process_data_from_lan()` hoặc hàm publish chung, thay vì hardcode `mqtt_enqueue_telemetry`:

```c
// Unified publish — routes to active server handler
static bool server_enqueue_telemetry(const uint8_t *data, size_t len) {
    switch (g_server_type) {
        case CONFIG_SERVERTYPE_MQTT:
            return mqtt_enqueue_telemetry(data, len);
        case CONFIG_SERVERTYPE_HTTP:
            return http_enqueue_telemetry(data, len);
        case CONFIG_SERVERTYPE_COAP:
            return coap_enqueue_telemetry(data, len);
        default:
            ESP_LOGW(TAG, "Unknown server type %d", g_server_type);
            return false;
    }
}
```

---

## 8. Task 6 – App: protocol constants & command builder

**File:** `DATN_config_app/src/config/protocol.py`

Thêm:
```python
# Server type codes (matches config_server_type_t in firmware)
SERVER_TYPE_MQTT  = 0
SERVER_TYPE_COAP  = 1
SERVER_TYPE_HTTP  = 2

SERVER_TYPE_LABELS = {
    SERVER_TYPE_MQTT: "MQTT",
    SERVER_TYPE_COAP: "CoAP",
    SERVER_TYPE_HTTP: "HTTP/HTTPS",
}
SERVER_TYPE_FROM_LABEL = {v: k for k, v in SERVER_TYPE_LABELS.items()}

def build_server_type_cmd(server_type: int) -> str:
    """CFSV:<type_code>"""
    return f"CFSV:{server_type}"

def build_mqtt_cmd(broker: str, token: str,
                   sub: str, pub: str, attr: str) -> str:
    """CFMQ:BROKER|TOKEN|SUB|PUB|ATTR"""
    return f"CFMQ:{broker}|{token}|{sub}|{pub}|{attr}"

def build_http_cmd(url: str, auth_token: str, port: int,
                   use_tls: bool, verify: bool, timeout_ms: int) -> str:
    """CFHP:URL|AUTH_TOKEN|PORT|USE_TLS|VERIFY|TIMEOUT_MS"""
    return (f"CFHP:{url}|{auth_token}|{port}"
            f"|{1 if use_tls else 0}|{1 if verify else 0}|{timeout_ms}")

def build_coap_cmd(host: str, resource_path: str, token: str,
                   port: int, use_dtls: bool,
                   ack_timeout_ms: int, max_retransmit: int) -> str:
    """CFCP:HOST|RESOURCE|TOKEN|PORT|USE_DTLS|ACK_TO|MAX_RTX"""
    return (f"CFCP:{host}|{resource_path}|{token}|{port}"
            f"|{1 if use_dtls else 0}|{ack_timeout_ms}|{max_retransmit}")
```

---

## 9. Task 7 – App: Advanced `server_tab.py` rework

### Mục tiêu
- Combobox type: `["MQTT", "CoAP", "HTTP/HTTPS"]`
- Mỗi loại có `LabelFrame` riêng; chỉ frame của type đang chọn được `pack()`, các frame kia `pack_forget()`
- Nút "Set" gửi `CFSV:X` + command riêng của type

### Cấu trúc widget mới
```
container
├── type_frame          "Server Type"
│   └── type_combo      ["MQTT", "CoAP", "HTTP/HTTPS"]
│
├── mqtt_frame          "MQTT Settings"   (ẩn/hiện động)
│   ├── broker_uri
│   ├── device_token
│   └── topics_frame    "MQTT Topics"
│       ├── sub_topic
│       ├── pub_topic
│       └── attr_topic
│
├── http_frame          "HTTP/HTTPS Settings"  (ẩn/hiện động)
│   ├── url             e.g. https://api.example.com/api/v1/telemetry
│   ├── auth_token      Bearer token
│   ├── port            (default 443 for https, 80 for http)
│   ├── timeout_ms      (default 10000)
│   ├── use_tls         Checkbutton (tự động detect từ URL "https://")
│   └── verify_server   Checkbutton  
│
└── coap_frame          "CoAP Settings"   (ẩn/hiện động)
    ├── host            IP or hostname
    ├── resource_path   e.g. /api/v1/{token}/telemetry
    ├── token           Device token
    ├── port            (default 5683)
    ├── use_dtls        Checkbutton (auto-set port to 5684)
    ├── ack_timeout_ms  (default 2000)
    └── max_retransmit  (default 4)
```

### Logic `_on_type_change()`
```python
def _on_type_change(self, event=None):
    t = self.type_var.get()
    # hide all
    for frame in (self.mqtt_frame, self.http_frame, self.coap_frame):
        frame.pack_forget()
    # show selected
    if t == "MQTT":
        self.mqtt_frame.pack(fill=tk.X, pady=5)
    elif t == "HTTP/HTTPS":
        self.http_frame.pack(fill=tk.X, pady=5)
    elif t == "CoAP":
        self.coap_frame.pack(fill=tk.X, pady=5)
```

### Logic `_set_server_config()`
```python
def _set_server_config(self):
    t = self.type_var.get()
    type_code = SERVER_TYPE_FROM_LABEL[t]
    self._send_command(build_server_type_cmd(type_code), f"Server type = {t}")

    # Chỉ gửi config của server type đang được chọn.
    # Config của các type khác KHÔNG gửi để tránh ghi đè NVS không cần thiết.
    if t == "MQTT":
        cmd = build_mqtt_cmd(
            self.broker_var.get().strip(),
            self.token_var.get().strip(),
            self.sub_topic_var.get().strip(),
            self.pub_topic_var.get().strip(),
            self.attr_topic_var.get().strip(),
        )
        self._send_command(cmd, "MQTT config")

    elif t == "HTTP/HTTPS":
        cmd = build_http_cmd(
            self.http_url_var.get().strip(),
            self.http_auth_var.get().strip(),
            int(self.http_port_var.get() or 443),
            self.http_tls_var.get(),
            self.http_verify_var.get(),
            int(self.http_timeout_var.get() or 10000),
        )
        self._send_command(cmd, "HTTP config")

    elif t == "CoAP":
        cmd = build_coap_cmd(
            self.coap_host_var.get().strip(),
            self.coap_resource_var.get().strip(),
            self.coap_token_var.get().strip(),
            int(self.coap_port_var.get() or 5683),
            self.coap_dtls_var.get(),
            int(self.coap_ack_var.get() or 2000),
            int(self.coap_rtx_var.get() or 4),
        )
        self._send_command(cmd, "CoAP config")
```

## 10. Task 8 – App: Basic `basic_panel.py` server section rework

### Mục tiêu
- Thêm server-type selector (Radiobutton hoặc Combobox) vào đầu tab Server
- Các frame MQTT / HTTP / CoAP ẩn/hiện giống Advanced

### Cấu trúc widget mới trong `_create_server_tab()`
```
tab (Server)
├── type_frame          "Server Type"
│   └── type_combo      ["MQTT", "CoAP", "HTTP/HTTPS"]
│
├── mqtt_frame          "MQTT Settings"   (ẩn/hiện)
│   ├── broker          (đơn giản, không cần full URI)
│   └── token           (masked)
│
├── http_frame          "HTTP/HTTPS Settings"  (ẩn/hiện)
│   ├── url
│   └── auth_token      (masked)
│
└── coap_frame          "CoAP Settings"   (ẩn/hiện)
    ├── host
    ├── resource_path
    └── token           (masked)
└── btn_frame           "✅ Set Server Config"
```

Basic mode chỉ hiển thị các trường thiết yếu (không có advanced options như timeout, retransmit).  
Advanced options vẫn giữ default firmware.

---

## 11. Thứ tự thực hiện

```
[Week 1]
  Task 1  config_handler.h – thêm struct, enum, extern
  Task 1  config_load_save.c – NVS save/load cho HTTP + CoAP
  Task 4  config_handler.c – prefix HP/CP, parse functions, dispatch
  Task 6  protocol.py – constants + command builders

[Week 2]
  Task 2  http_handler.h + http_handler.c (POST, TLS, auth header)
  Task 3  coap_handler.h + coap_handler.c (UDP/DTLS, CON msg, {token} substitution)
  Task 5  mcu_lan_handler_uplink.c – server_enqueue_telemetry router

[Week 3]
  Task 7  server_tab.py – advanced UI rework (full 3-frame show/hide)
  Task 8  basic_panel.py – basic UI server section rework
  Testing end-to-end: MQTT → HTTP → CoAP send telemetry từ LAN MCU lên server
```

---

## 12. Các điểm cần chú ý

| Vấn đề | Giải pháp |
|---|---|
| HTTP blocking | Dùng task FreeRTOS riêng, timeout bắt buộc |
| CoAP UDP fire-and-forget | Dùng CON message để đảm bảo delivery, set `max_retransmit` |
| TLS certificate | Nhúng server CA cert vào SPIFFS hoặc build-time embed; `verify_server = false` cho dev |
| COAP component | Thêm `coap` vào `REQUIRES` trong `CMakeLists.txt` |
| NVS key length | Tất cả key ≤ 15 ký tự (giới hạn ESP-IDF NVS) |
| `g_server_type` race | Đọc trong task context, bảo vệ bằng mutex nếu runtime-switchable |
| App – `get_config()` / `set_config()` | Cập nhật cả hai method trong `server_tab.py` và `basic_panel.py` để load/save toàn bộ 3 loại |
| **Chỉ gửi config của type đang chọn** | App chỉ gửi lệnh `CFMQ`/`CFHP`/`CFCP` tương ứng với type hiện tại; config của 2 type còn lại không được gửi để tránh ghi đè NVS không cần thiết |
| **Default server type = MQTT** | Firmware: `g_server_type` khởi tạo `CONFIG_SERVERTYPE_MQTT`; NVS load lúc boot — nếu key chưa tồn tại thì giữ MQTT; App: combobox mặc định chọn `"MQTT"` khi mở |

---

## 13. Ghi chú bổ sung

### 13.1 Chỉ gửi config của server type đang chọn (App)

Quy tắc áp dụng cho cả Advanced (`server_tab.py`) lẫn Basic (`basic_panel.py`):

```
User bấm "Set Server Config"
  ├── Luôn gửi: CFSV:<type_code>          (thông báo firmware đổi active type)
  └── Chỉ gửi thêm 1 lệnh config tương ứng:
        MQTT      → CFMQ:...
        HTTP/HTTPS → CFHP:...
        CoAP      → CFCP:...
```

Lý do:
- Tránh ghi đè NVS với dữ liệu rỗng/placeholder khi user chưa điền
- Giảm số lệnh serial cần gửi
- Firmware chỉ cần restart/reinit handler của type vừa được cấu hình

### 13.2 Default server type = MQTT (Firmware)

**`config_handler.c`** — giá trị khởi tạo:
```c
config_server_type_t g_server_type = CONFIG_SERVERTYPE_MQTT;  // đã có, giữ nguyên
```

**`config_load_save.c`** — khi load NVS lúc boot:
```c
esp_err_t load_server_config_from_nvs(void) {
    nvs_handle_t h;
    esp_err_t err = nvs_open("server_cfg", NVS_READONLY, &h);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        // NVS chưa có — giữ default MQTT, không báo lỗi
        ESP_LOGI(TAG, "No server config in NVS, using default MQTT");
        return ESP_OK;
    }
    if (err != ESP_OK) return err;

    uint8_t type = CONFIG_SERVERTYPE_MQTT;   // fallback nếu key thiếu
    nvs_get_u8(h, "sv_type", &type);         // lỗi get → giữ fallback
    g_server_type = (config_server_type_t)type;
    // ... load mqtt/http/coap fields ...
    nvs_close(h);
    return ESP_OK;
}
```

**App** — khi mở tab Server, combobox luôn hiển thị `"MQTT"` nếu chưa load config từ gateway:
```python
# server_tab.py / basic_panel.py
self.type_var = tk.StringVar(value="MQTT")   # default = MQTT
self._on_type_change()                        # ẩn frame HTTP/CoAP ngay khi khởi tạo
```
