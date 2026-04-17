# TJC Editor Setup Guide -- TJC3224K024_011 (Component-Based)

> **Display**: TJC3224K024_011 -- 2.4" TFT, native 240x320, mounted **LANDSCAPE (rotated 90 deg)**
> **Canvas**: 320(W) x 240(H)
> **Firmware**: DA2_esp (ESP32-S3), UART2 TX=GPIO41 RX=GPIO42, 115200 baud
> **Approach**: Named Text components + Buttons. Static labels set in TJC Editor.
>              Dynamic fields updated by ESP32 via `comp.txt="..."` / `comp.pco=N`.

---

## Layout toa do (320 x 240 landscape)

```
x:  0        88     162        220     319
    +------------------------------------------+  y=0
    |DA2 GW   [========] 93%   Idle/Chrg       |  y=0..23   Title bar
    +------------------------------------------+  y=24 (line -- ve boi ESP32)
    |WiFi           |||  LTE                   |  y=26..47  Header labels (CYAN)
    |  * Connected  |||   * Connected          |  y=50..71  dot + status
    |  HomeNet      |||   m-wap           |  y=74..91  SSID / APN
    |  -65dBm PERS  |||   A7600C1 18/31       |  y=94..111 detail (gray)
    +------------------------------------------+  y=116 (line -- ve boi ESP32)
    |ETH:  * Connected    192.168.1.50         |  y=119..137 ETH row
    +------------------------------------------+  y=141 (line -- ve boi ESP32)
    |                                          |  y=142..171 (gap)
    |  [    WiFi    ]      [    LTE    ]       |  y=172..207 TJC buttons
    +------------------------------------------+  y=239
```

Battery bar: x=88..161 (74px), y=6..17 -- khu vuc nay de trong trong TJC Editor,
             ESP32 tu ve bang lenh fill.
Separator lines: ESP32 tu ve bang lenh line sau moi lan chuyen sang home page.

---

## Muc luc

1. [Cai TJC Editor va chuyen sang tieng Anh](#1-cai-tjc-editor)
2. [Them Font](#2-them-font)
3. [Tao project moi -- Landscape](#3-tao-project-moi)
4. [Tao 4 Page](#4-tao-4-page)
5. [Page home -- danh sach component](#5-page-home)
6. [Page pgWifi -- 1 button](#6-page-pgwifi)
7. [Page pgLTE -- 1 button](#7-page-pglte)
8. [Page pgKB -- trong](#8-page-pgkb)
9. [Build va nap .tft](#9-build-va-nap-tft)
10. [Kiem tra voi ESP32](#10-kiem-tra)

---

## 1. Cai TJC Editor

- Tai tai: https://www.tjc1111.com/ -> Download -> TJC USART HMI Editor
- Cai dat, mo len.
- **Doi ngon ngu**: Menu bar -> **She Zhi** (menu thu 5) -> **Yu Yan** -> **English** -> restart.

Ten menu tham khao: Wen Jian=File | Bian Yi=Compile | Xin Jian=New | Da Kai=Open

---

## 2. Them Font

**Phai them font TRUOC KHI them bat ky component Text nao.**

1. Panel duoi cung (Font panel) -> click icon **Add Font** (hinh cai but/A)
2. Hoac: **File -> Import Resource** -> chon file `font_ascii_16.zi` tu thu muc `HMI_Project/`
3. Font se xuat hien voi index **0** trong Font panel.

> **Luu y**: Neu khong them font, tat ca Text component se bi loi khi compile.

---

## 3. Tao project moi

**File -> New (Xin Jian)**

| Truong | Gia tri |
|---|---|
| Device Series | **K-series** |
| Device Model | **TJC3224K024_011** |
| **Orientation** | **Landscape (90 degrees)** |
| Baud Rate | **115200** |

Canvas sau khi tao: **320 x 240** (ngang).

---

## 4. Tao 4 Page

Panel trai -> **Page** -> right-click -> **Add Page** -> dat ten chinh xac:

| Index | Ten |
|---|---|
| 0 | `home` |
| 1 | `pgWifi` |
| 2 | `pgLTE` |
| 3 | `pgKB` |

Voi moi page: Click page -> **Attribute panel** -> Background Color (bco) = **0** (black).

---

## 5. Page home

Click page `home`. Them cac component theo trinh tu sau.

### QUAN TRONG: Thu tu them quyet dinh comp ID

TJC gan comp ID tu dong tang dan (1, 2, 3...). Code ESP32 dung ID de nhan biet nut bam.
**Them b_wifi_cfg TRUOC TIEN (ID=1), b_lte_cfg thu hai (ID=2)**, roi them cac component khac.

Sau khi them, click tung component -> kiem tra attribute `id` trong panel phai.
Neu sai: phai xoa va them lai theo dung thu tu.

---

### 5.1 Buttons (them TRUOC TIEN)

Keo **Button** tu toolbar xuong canvas:

| Thu tu | Ten (objname) | x | y | w | h | Label (txt) | Touch Release |
|---|---|---|---|---|---|---|---|
| **1** | `b_wifi_cfg` | 4 | 172 | 150 | 36 | `WiFi` | `page pgWifi` |
| **2** | `b_lte_cfg` | 166 | 172 | 150 | 36 | `LTE` | `page pgLTE` |

**Cach dat Touch Release**: Click component -> tab **Touch** (hoac **Event**) -> **Touch Release** -> go `page pgWifi`

---

### 5.2 Static Text (them sau buttons -- ESP32 khong cap nhat)

Keo **Text** tu toolbar. Dat cac thuoc tinh sau cho **moi** static text component:

| Thuoc tinh | Gia tri | Ghi chu |
|---|---|---|
| font | 0 | Font vua them |
| **sta** | **1** | **BAT BUOC: solid background** |
| bco | 0 | Nen den |
| ycen | 1 | Can giua doc |
| xcen | 0 | Can trai |

Danh sach static text:

| Ten (objname) | x | y | w | h | txt | pco (text color) |
|---|---|---|---|---|---|---|
| `t_title` | 2 | 2 | 82 | 20 | `DA2 GW` | 65535 (white) |
| `t_wifi_hdr` | 4 | 27 | 70 | 20 | `WiFi` | 2047 (cyan) |
| `t_lte_hdr` | 162 | 27 | 70 | 20 | `LTE` | 2047 (cyan) |
| `t_eth_lbl` | 4 | 120 | 40 | 18 | `ETH:` | 2047 (cyan) |

---

### 5.3 Dynamic Text (them sau -- ESP32 cap nhat qua UART)

**Tat ca dynamic text components PHAI co sta=1 va bco=0** (nen den solid).
Neu de sta=0 man se bao loi "invalid picture" va khong hien text.

Thuoc tinh chung cho DU cac dynamic text:

| Thuoc tinh | Gia tri |
|---|---|
| font | 0 |
| **sta** | **1** |
| bco | 0 |
| xcen | 0 |
| ycen | 1 |

Danh sach dynamic text:

| Ten (objname) | x | y | w | h | txt (default) | pco (default) | Mo ta |
|---|---|---|---|---|---|---|---|
| `t_bat_pct` | 166 | 2 | 50 | 20 | `0%` | 2016 (green) | Battery % |
| `t_bat_chrg` | 220 | 2 | 70 | 20 | `Idle` | 33808 (gray) | Chrg/Idle |
| `t_wifi_dot` | 4 | 51 | 14 | 20 | `*` | 63488 (red) | WiFi indicator |
| `t_wifi_st` | 20 | 51 | 92 | 20 | `No WiFi` | 63488 (red) | WiFi status |
| `t_wifi_ssid` | 4 | 75 | 150 | 18 | `---` | 65535 (white) | SSID |
| `t_wifi_det` | 4 | 97 | 150 | 18 | ` ` | 33808 (gray) | Signal/Auth |
| `t_lte_dot` | 166 | 51 | 14 | 20 | `*` | 63488 (red) | LTE indicator |
| `t_lte_st` | 182 | 51 | 92 | 20 | `No LTE` | 63488 (red) | LTE status |
| `t_lte_apn` | 166 | 75 | 150 | 18 | `---` | 65535 (white) | APN |
| `t_lte_det` | 166 | 97 | 150 | 18 | ` ` | 33808 (gray) | Modem/CSQ |
| `t_eth_dot` | 48 | 120 | 14 | 18 | `*` | 63488 (red) | ETH indicator |
| `t_eth_st` | 64 | 120 | 90 | 18 | `No ETH` | 63488 (red) | ETH status |
| `t_eth_ip` | 158 | 120 | 148 | 18 | ` ` | 65535 (white) | IP address |

> **Vung de trong** (khong them component): x=88..161, y=6..17 -- day la vung battery bar,
> se duoc ve tu ESP32 bang lenh fill.

---

### 5.4 Kiem tra comp ID sau khi them

Sau khi them xong tat ca component tren home page:
- Click `b_wifi_cfg` -> kiem tra `id` = **1**
- Click `b_lte_cfg` -> kiem tra `id` = **2**

Neu ID sai, update hang sau trong `hmi_display.h`:
```c
#define HMI_HOME_COMP_WIFI_BTN   <ID thuc te cua b_wifi_cfg>
#define HMI_HOME_COMP_LTE_BTN    <ID thuc te cua b_lte_cfg>
```

---

## 6. Page pgWifi

Click page `pgWifi`. Chi can **1 button**:

| Ten | x | y | w | h | txt | Touch Release |
|---|---|---|---|---|---|---|
| `b_back` | 4 | 196 | 312 | 36 | `Back` | `page home` |

> Phan con lai cua trang (WiFi status, SSID, signal) duoc ESP32 ve bang lenh xstr.
> Khong can them them bat ky Text component nao.

---

## 7. Page pgLTE

Click page `pgLTE`. Tuong tu pgWifi, chi 1 button:

| Ten | x | y | w | h | txt | Touch Release |
|---|---|---|---|---|---|---|
| `b_back` | 4 | 196 | 312 | 36 | `Back` | `page home` |

---

## 8. Page pgKB

De trong. Khong them component.

---

## 9. Build va nap .tft

### Build

**File -> Compile** (hoac Ctrl+B).
File `.tft` duoc tao trong thu muc project (vi du `output/DA2_gateway.tft`).

### Nap qua microSD (khuyen dung)

1. Copy file `.tft` vao the microSD FAT32 -- **chi duy nhat 1 file `.tft`** o root `/`.
2. Tat nguon module TJC (rut day 5V).
3. Cam the vao slot microSD tren module.
4. Bat nguon -- LED nhap nhay ~10-15 giay -> flash xong -> module reboot.
5. Rut the microSD.

> Module can **nguon 5V** rieng. Khong dung 3.3V GPIO de cap nguon.

---

## 10. Kiem tra voi ESP32

Ket noi:

| Pin ESP32-S3 | Pin TJC3224K024_011 |
|---|---|
| GPIO41 (TX) | RX (qua FSUSB42UMX-TP switch GPIO46=HIGH) |
| GPIO42 (RX) | TX |
| 5V | VCC |
| GND | GND |

Flash firmware ESP32 va mo Serial Monitor (115200 baud). Log mong doi:

```
I HMI_BSP:  UART2 BSP init OK (TX=41 RX=42 115200 baud)
I HMI_TASK: Display init commands sent (bkcmd=0, recmod=0)
I HMI_TASK: HMI mode active
I HMI_DISP: goto_page 0 (home)
I HMI_DISP: refresh bat=93% wifi=0 lte=0 eth=0
  ... (component attribute commands)
```

Sau 5 giay:
```
I HMI_DISP: refresh bat=93% wifi=1 lte=0 eth=0
```

Nhan nut WiFi tren man hinh:
```
I HMI_DISP: Touch page=0 comp=1
I HMI_DISP: goto_page 1 (pgWifi)
```

Nhan nut Back:
```
I HMI_DISP: Touch page=1 comp=1
I HMI_DISP: goto_page 0 (home)
```

---

## Mau sac RGB565 tham khao

| Mau | Decimal | Hex | Dung cho |
|---|---|---|---|
| White | 65535 | 0xFFFF | Text chinh |
| Gray | 33808 | 0x8410 | Text phu, Idle |
| Cyan | 2047 | 0x07FF | Headers |
| Green | 2016 | 0x07E0 | Connected, Chrg |
| Red | 63488 | 0xF800 | Disconnected |
| Yellow | 65504 | 0xFFE0 | Battery 20-49% |
| Orange | 64512 | 0xFC00 | Battery 10-19% |
| Black | 0 | 0x0000 | Background |

---

## Ghi chu quan trong

1. **sta=1 la bat buoc** cho moi Text component. sta=0 yeu cau background picture --
   TJC se tra ve error 0x04 va khong hien text.

2. **Comp ID cua buttons** quyet dinh touch routing trong firmware. Them b_wifi_cfg
   truoc tien de dam bao ID=1.

3. **Ten component phai chinh xac** (case-sensitive): `t_wifi_st` khac `t_Wifi_St`.
   ESP32 gui `t_wifi_st.txt="..."` -- neu ten sai man khong cap nhat.

4. **Font phai duoc them truoc** khi them component Text. Neu thieu font, compile se loi.

5. Battery bar area (x=88..161, y=6..17) **de trong** -- khong them component TJC vao day.
   ESP32 ve bang `fill` command.
