# TJC Editor Setup Guide -- TJC3224K024_011 (Single Blank Page)

> Display: TJC3224K024_011 -- 2.4" TFT, native 240x320, mounted LANDSCAPE (rotated 90 deg)
> Canvas: 320(W) x 240(H)
> Firmware: DA2_esp (ESP32-S3), UART2 TX=GPIO41 RX=GPIO42, 115200 baud
> Approach: TJC project chi giu 1 page `home` nen trang. Toan bo noi dung hien thi duoc ESP32 ve bang `xstr`, `fill`, `line`.

---

## Layout firmware ve len man hinh

```
      +--------------------------------------------------+
      |                 DATN_GATEWAY                     |
      +--------------------------------------------------+
      |              27/05/2026  14:52:09                |
      +--------------------------------------------------+
      | BATTERY   [====================]           93%   |
      | 4012 mV | Charging                              |
      +--------------------------------------------------+
      | INTERNET  WIFI | ONLINE                         |
      +--------------------------------------------------+
      | SERVER    MQTT | CONNECTED                      |
      +--------------------------------------------------+
      | CONFIG    http://gateway.local/                 |
      |           AP fallback: 192.168.4.1              |
      +--------------------------------------------------+
```

Khong them button, khong them text object, khong them page phu. Neu muon doi bo cuc, sua firmware trong `hmi_display.c`, khong sua layout bang component TJC.

---

## 1. Cai TJC Editor

1. Tai TJC USART HMI Editor tu trang TJC.
2. Cai dat va mo len.
3. Neu can doi ngon ngu: menu `She Zhi` -> `Yu Yan` -> `English` -> restart.

---

## 2. Them font bat buoc

Mac du page khong co Text component tinh, firmware van dung lenh `xstr` voi font index `0`.

1. Mo Font panel.
2. Chon `Add Font` hoac `File -> Import Resource`.
3. Import file `font_ascii_16.zi` trong thu muc `HMI_Project/`.
4. Kiem tra font nay nam o index `0`.

Neu khong co font `0`, firmware gui `xstr ... ,0,...` se khong hien dung noi dung.

---

## 3. Tao project moi

`File -> New`

| Truong | Gia tri |
|---|---|
| Device Series | `K-series` |
| Device Model | `TJC3224K024_011` |
| Orientation | `Landscape (90 degrees)` |
| Baud Rate | `115200` |

Canvas sau khi tao phai la `320 x 240`.

---

## 4. Tao dung 1 page

Chi de lai duy nhat page sau:

| Index | Ten |
|---|---|
| 0 | `home` |

Yeu cau cho page `home`:

- `bco = 65535` de nen trang
- Khong them `Button`
- Khong them `Text`
- Khong them `Picture`
- Khong them event touch

Day chinh la "blank white page" de firmware toan quyen ve giao dien.

---

## 5. Nhung thu tuyet doi khong lam

- Khong tao them `pgWifi`, `pgLTE`, `pgKB`
- Khong tao `b_wifi_cfg`, `b_lte_cfg`, `b_back`
- Khong tao text label tinh cho battery, internet, server, URL
- Khong doi ten page `home`
- Khong doi baud rate khoi `115200`

Neu them lai component/page cu, firmware van chay nhung design se quay lai kieu kho kiem soat ma ban da bo.

---

## 6. Build va nap `.tft`

### Build

1. Save project.
2. Chon `File -> Compile` hoac `Ctrl+B`.
3. Lay file `.tft` sinh ra trong thu muc output cua project.

### Nap qua microSD

1. Format the microSD thanh `FAT32`.
2. Copy duy nhat 1 file `.tft` vao root card.
3. Tat nguon module TJC.
4. Cam the microSD vao man hinh.
5. Cap nguon 5V on dinh cho man hinh.
6. Cho den khi update xong va man hinh reboot.
7. Rut the microSD.

Khong nap bang nguon 3.3V yeu.

---

## 7. Kiem tra voi firmware ESP32

Sau khi flash man hinh va boot firmware, man hinh phai hien:

- `DATN_GATEWAY`
- ngay gio
- pin `%` + `mV` + charging/idle
- loai ket noi internet + online/offline
- loai server + connected/disconnected
- URL web config

Log mong doi:

```text
I HMI_TASK: HMI mode active
I HMI_DISP: goto_page home
I HMI_DISP: refresh bat=93% inet=WIFI/1 server=MQTT/1 time=27/05/2026 14:52:09
```

Neu man hinh chi nen trang khong co text:

- kiem tra font index `0`
- kiem tra page ten dung la `home`
- kiem tra baud `115200`
- kiem tra firmware da vao `hmi_task_enter_mode()`
