# Hướng dẫn FOTA qua ThingsBoard

## Tổng quan

Gateway DA2 hỗ trợ cập nhật firmware (FOTA) trực tiếp từ server ThingsBoard. Có hai chế độ:

| Chế độ | Server | Giao thức | Config |
|--------|--------|-----------|--------|
| Local Raspberry Pi | `192.168.x.x:8080` | HTTP | `USE_HTTPS=0` |
| Cloud demo | `demo.thingsboard.io` | HTTPS | `USE_HTTPS=1` |

---

## Cài đặt trên ThingsBoard

### Bước 1 — Upload firmware package

1. Đăng nhập ThingsBoard Web UI
2. Vào **OTA Updates** (menu bên trái)
3. Nhấn **"+"** để thêm package mới
4. Điền thông tin:
   - **Title**: `DA2_esp_WAN` (cho WAN MCU) hoặc `DA2_esp_LAN` (cho LAN MCU)
   - **Version**: ví dụ `V0.0.2` (phải khác với version đang chạy trên thiết bị)
   - **Device type**: ESP32 (hoặc tuỳ chọn bạn đặt)
   - **Type**: Firmware
5. Upload file `.bin`:
   - WAN MCU: `DA2_esp/build/DA2_esp.bin`
   - LAN MCU: `DA2_esp_LAN/build/DA2_esp_LAN.bin`

### Bước 2 — Gán firmware cho Device Profile

1. Vào **Device Profiles** → chọn profile của thiết bị
2. Tab **Device profile details** → tìm mục **OTA updates**
3. Chọn firmware package vừa upload cho **Firmware**
4. Lưu lại

> ℹ️ Tất cả thiết bị thuộc profile này sẽ được thông báo cập nhật firmware mới.

### Bước 3 — Lấy Device Access Token

1. Vào **Devices** → chọn thiết bị của bạn
2. Tab **Credentials** → Copy **Access Token**
3. Điền token này vào config của firmware (xem phần bên dưới)

---

## Cấu hình firmware

### WAN MCU — `DA2_esp/Application/FOTA/include/fota_config.h`

```c
/* ---- THAY ĐỔI CÁC DÒNG NÀY ---- */

/* 0 = Raspberry Pi local (HTTP), 1 = demo.thingsboard.io (HTTPS) */
#define FOTA_CONFIG_TB_USE_HTTPS        0

/* IP hoặc hostname của ThingsBoard server */
#define FOTA_CONFIG_TB_HOST             "192.168.1.6"

/* Port: 8080 cho local HTTP, 443 cho HTTPS cloud */
#define FOTA_CONFIG_TB_PORT             8080

/* Device Access Token lấy từ ThingsBoard */
#define FOTA_CONFIG_TB_DEVICE_TOKEN     "PASTE_TOKEN_HERE"

/* 1 = bỏ qua kiểm tra cert (dùng khi server có self-signed cert)
 * 0 = kiểm tra cert đầy đủ (dùng cho demo.thingsboard.io) */
#define FOTA_CONFIG_TB_SKIP_CERT_VERIFY 1
```

### LAN MCU — `DA2_esp_LAN/Application/FOTA_LAN/include/fota_lan_config.h`

```c
/* ---- THAY ĐỔI CÁC DÒNG NÀY ---- */

#define FOTA_CONFIG_LAN_TB_USE_HTTPS        0
#define FOTA_CONFIG_LAN_TB_HOST             "192.168.1.6"
#define FOTA_CONFIG_LAN_TB_PORT             8080
#define FOTA_CONFIG_LAN_TB_DEVICE_TOKEN     "PASTE_TOKEN_HERE"
#define FOTA_CONFIG_LAN_TB_SKIP_CERT_VERIFY 1
```

---

## Chuyển sang demo.thingsboard.io

Chỉnh sửa các macro trong config file của MCU tương ứng:

```c
#define FOTA_CONFIG_TB_USE_HTTPS        1          // Bật HTTPS
#define FOTA_CONFIG_TB_HOST             "demo.thingsboard.io"
#define FOTA_CONFIG_TB_PORT             443
#define FOTA_CONFIG_TB_DEVICE_TOKEN     "TOKEN_TU_CLOUD"
#define FOTA_CONFIG_TB_SKIP_CERT_VERIFY 0          // Cloud dùng cert hợp lệ
```

> **Lưu ý:** `demo.thingsboard.io` sử dụng TLS với CA hợp lệ (DigiCert), nên đặt
> `SKIP_CERT_VERIFY = 0` để bảo mật. Certificate bundle của ESP-IDF tự động xử lý.

---

## URL API ThingsBoard

Firmware được tải về qua endpoint HTTP này:

```
GET http://{HOST}:{PORT}/api/v1/{DEVICE_TOKEN}/firmware
```

ThingsBoard trả về file `.bin` trực tiếp với header `Content-Length`. Thiết bị sẽ tự
động nhận diện và flash vào partition OTA tiếp theo.

---

## Quy trình FOTA tự động

Khi thiết bị khởi động và có kết nối mạng (PPP với WAN MCU), `fota_lan_handler_task_start()` được gọi:

```
Khởi động
    ↓
ble_disable_sync()       — tắt BLE để giải phóng RAM
    ↓
internet_reachable()     — kiểm tra TCP đến ThingsBoard host:port
    ↓ (thành công)
manual_ota_download()    — HTTP GET /api/v1/{token}/firmware
    ↓
esp_ota_write()          — flash từng chunk vào OTA partition
    ↓
esp_ota_end() + esp_ota_set_boot_partition()
    ↓
esp_restart()            — reboot vào firmware mới
```

Nếu thất bại, thiết bị thử lại **5 lần** với khoảng cách 30 giây giữa các lần, rồi reboot.

---

## Troubleshooting

### Lỗi HTTP 404
- Kiểm tra `FOTA_CONFIG_TB_DEVICE_TOKEN` có đúng không
- Kiểm tra đã gán firmware package cho device profile chưa
- ThingsBoard endpoint: `http://HOST:PORT/api/v1/TOKEN/firmware`

### Lỗi "ThingsBoard not reachable"
- Kiểm tra kết nối PPP giữa LAN MCU và WAN MCU
- Kiểm tra IP của Raspberry Pi (`FOTA_CONFIG_TB_HOST`)
- Thử ping từ WAN MCU đến Raspberry Pi

### Lỗi TLS (khi USE_HTTPS=1)
- Nếu server dùng self-signed cert: đặt `SKIP_CERT_VERIFY = 1`
- Nếu dùng demo.thingsboard.io: đặt `SKIP_CERT_VERIFY = 0`, `USE_CERT_BUNDLE` tự bật

### Lỗi OTA validate (corrupted image)
- Kiểm tra file `.bin` upload lên ThingsBoard có đúng không (không bị corrupt)
- Đảm bảo đúng MCU: WAN binary cho WAN MCU, LAN binary cho LAN MCU

### Version check
- Firmware mới phải có version string **khác** với version đang chạy
- Version được khai báo trong CMakeLists.txt: `set(PROJECT_VER "V0.0.x")`

---

## Build & Upload thủ công

```bash
# Build WAN MCU firmware
cd DA2_esp
./build.sh

# Build LAN MCU firmware  
cd DA2_esp_LAN
./build.sh
```

File `.bin` sau khi build:
- WAN: `DA2_esp/build/DA2_esp.bin`
- LAN: `DA2_esp_LAN/build/DA2_esp_LAN.bin`

Upload lên ThingsBoard qua Web UI (OTA Updates → chọn package → nút Upload).

---

## So sánh các config

| Tham số | Local RPi (HTTP) | Cloud (HTTPS) |
|---------|-------------------|---------------|
| `USE_HTTPS` | `0` | `1` |
| `HOST` | `"192.168.1.6"` | `"demo.thingsboard.io"` |
| `PORT` | `8080` | `443` |
| `SKIP_CERT_VERIFY` | `1` | `0` |
| `USE_CERT_BUNDLE` | auto `0` | auto `1` |
