# Hướng dẫn: Kết nối Gateway qua Ethernet với PC

Tài liệu này mô tả cách thiết lập kết nối **cáp Ethernet trực tiếp** giữa PC và gateway DA2 (W5500) trên **Windows** và **Ubuntu Linux**, bao gồm cả giao diện đồ hoạ (UI) và dòng lệnh (CLI).

## Kiến trúc kết nối

```
[Internet]
    |
[WiFi / adapter internet của PC]
    |
    |  (NAT / IP forwarding)
    |
[Ethernet port PC: 192.168.137.1] ── cáp Ethernet ── [W5500 Gateway: 192.168.137.2]
                                                             ↑
                                              Web Config: http://192.168.137.2/
```

> **Firmware đã dùng static IP:**  
> Gateway được cấu hình `ETH_USE_STATIC_IP = 1` trong `eth_connect.h` → W5500 luôn dùng IP cố định `192.168.137.2`, **không cần DHCP server** trên PC.  
> PC chỉ cần có IP `192.168.137.1` trên cổng Ethernet là đủ để truy cập web config.  
> Để gateway có internet qua PC, cần thêm bước enable NAT/IP forwarding (tùy chọn).

> **Python Config App (`DATN_config_app`)** giao tiếp qua **cổng COM (USB-UART serial)** — hoàn toàn độc lập với mạng Ethernet. Cắm cáp USB-UART là dùng được bất kể chế độ nào.

---

## 1. Chuẩn bị firmware

Đảm bảo gateway đã được set `internet_type = ETHERNET` (code `015`). Dùng Python config app qua COM port:

```
CFWN:015
```

Kiểm tra `eth_connect.h`:
```c
#define ETH_USE_STATIC_IP     1
#define ETH_STATIC_IP_ADDR    "192.168.137.2"
#define ETH_STATIC_GW         "192.168.137.1"
```

---

## 2. Thiết lập trên Windows

### 2.1 Thiết lập IP tĩnh cho Ethernet — Giao diện UI

1. Nhấn `Win + R` → gõ `ncpa.cpl` → Enter
2. **Right-click** adapter **Ethernet** (cổng cắm cáp vào gateway) → **Properties**
3. Double-click **Internet Protocol Version 4 (TCP/IPv4)**
4. Chọn **"Use the following IP address"** và điền:

   | Trường | Giá trị |
   |---|---|
   | IP address | `192.168.137.1` |
   | Subnet mask | `255.255.255.0` |
   | Default gateway | *(để trống)* |
   | Preferred DNS | *(để trống)* |

5. Click **OK** → **OK**

### 2.2 Thiết lập IP tĩnh cho Ethernet — Dòng lệnh (PowerShell Admin)

Mở PowerShell với quyền **Administrator** (`Win + X` → Terminal (Admin)):

```powershell
netsh interface ip set address name="Ethernet" source=static addr=192.168.137.1 mask=255.255.255.0
```

Kiểm tra kết quả:
```powershell
ipconfig | Select-String "Ethernet adapter Ethernet" -Context 0,4
```
Phải thấy `IPv4 Address: 192.168.137.1`.

> **Lưu ý tên adapter:** Nếu adapter không tên `"Ethernet"`, kiểm tra tên đúng bằng `ipconfig` rồi thay vào lệnh trên.

---

### 2.3 Bật Internet Sharing (NAT) — Giao diện UI

> Bước này chỉ cần nếu muốn **gateway truy cập internet qua PC**. Nếu chỉ cần web config thì bỏ qua.

1. `ncpa.cpl` → **Right-click adapter WiFi** (adapter đang có internet) → **Properties**
2. Tab **Sharing**
3. Tích ✅ **"Allow other network users to connect through this computer's Internet connection"**
4. **Home networking connection** → chọn **Ethernet**
5. Click **OK**

> ⚠️ **Lưu ý quan trọng:** Sau khi enable ICS, Windows có thể override IP của Ethernet adapter về `192.168.137.1` tự động. Nếu IP bị thay đổi, kiểm tra lại với `ipconfig`.  
> **Không dùng `Stop-Service SharedAccess` thủ công** — lệnh này reset toàn bộ ICS configuration.

### 2.4 Bật Internet Sharing (NAT) — Dòng lệnh (PowerShell Admin)

Thay `"Wi-Fi 2"` bằng tên adapter WiFi thực tế (xem trong `ipconfig`):

```powershell
# Bật ICS: chia sẻ từ WiFi ra Ethernet
$netShare = New-Object -ComObject HNetCfg.HNetShare

# Tìm đúng adapter theo tên
$allConns = @($netShare.EnumEveryConnection())
$wifi = $allConns | Where-Object { ($netShare.NetConnectionProps($_)).Name -like "*Wi-Fi*" } | Select-Object -First 1
$eth  = $allConns | Where-Object { ($netShare.NetConnectionProps($_)).Name -eq "Ethernet" } | Select-Object -First 1

# Enable sharing
($netShare.INetSharingConfigurationForINetConnection($wifi)).EnableSharing(0)  # 0 = public (internet source)
($netShare.INetSharingConfigurationForINetConnection($eth)).EnableSharing(1)   # 1 = private (home network)

Write-Host "ICS enabled" -ForegroundColor Green
```

Kiểm tra ICS đang hoạt động:
```powershell
# Port 67 phải có entry nếu ICS DHCP đang chạy
netstat -ano | Select-String ":67 "

# Kiểm tra ICS config
$netShare = New-Object -ComObject HNetCfg.HNetShare
$netShare.EnumEveryConnection | ForEach-Object {
    $p = $netShare.NetConnectionProps($_)
    $c = $netShare.INetSharingConfigurationForINetConnection($_)
    if ($c.SharingEnabled) { Write-Host "$($p.Name) — sharing enabled" }
}
```

---

## 3. Thiết lập trên Ubuntu Linux

### 3.1 Tìm tên interface Ethernet

```bash
ip link show
```

Ethernet thường có tên dạng `eth0`, `enp3s0`, `eno1`, `enx...` (USB Ethernet).  
Thay `<ETH>` bằng tên thực tế trong tất cả lệnh bên dưới.

---

### 3.2 Thiết lập IP tĩnh — Giao diện UI (GNOME NetworkManager)

1. **Settings → Network → Wired**
2. Click biểu tượng **bánh răng** (⚙) bên cạnh connection
3. Tab **IPv4**
4. **Method** → chọn **Manual**
5. Nhấn **Add** và điền:

   | Trường | Giá trị |
   |---|---|
   | Address | `192.168.137.1` |
   | Netmask | `255.255.255.0` |
   | Gateway | *(để trống)* |

6. **DNS** → để trống (hoặc tắt Automatic DNS)
7. Click **Apply** → toggle Off/On connection để áp dụng

---

### 3.3 Thiết lập IP tĩnh — Dòng lệnh

**Cách A — `nmcli` (NetworkManager, persistent qua reboot):**

```bash
# Tạo connection mới với IP tĩnh
sudo nmcli con add type ethernet ifname <ETH> con-name "gateway-eth" \
    ipv4.method manual \
    ipv4.addresses 192.168.137.1/24

# Kích hoạt connection
sudo nmcli con up "gateway-eth"

# Kiểm tra
ip addr show <ETH>
```

Để xoá và làm lại nếu cần:
```bash
sudo nmcli con delete "gateway-eth"
```

**Cách B — `ip` (tạm thời, mất sau reboot):**

```bash
sudo ip addr flush dev <ETH>
sudo ip addr add 192.168.137.1/24 dev <ETH>
sudo ip link set <ETH> up

# Kiểm tra
ip addr show <ETH>
```

---

### 3.4 Bật Internet Sharing (NAT) — Giao diện UI

> Bước này chỉ cần nếu muốn **gateway truy cập internet qua PC**.

**Dùng NetworkManager "Shared" mode:**

1. **Settings → Network → Wired → ⚙**
2. Tab **IPv4** → **Method** → chọn **"Shared to other computers"**
3. Click **Apply**

NetworkManager sẽ tự động:
- Set IP `10.42.0.1/24` cho Ethernet adapter
- Bật DHCP server (dnsmasq) trên Ethernet
- Bật IP forwarding và NAT qua iptables

> ⚠️ **Lưu ý:** Shared mode dùng subnet `10.42.0.x` thay vì `192.168.137.x`. Nếu muốn giữ `192.168.137.x` (để khớp với firmware gateway), dùng cách CLI bên dưới.

---

### 3.5 Bật Internet Sharing (NAT) — Dòng lệnh

Thay `<ETH>` = interface Ethernet (ví dụ `enp3s0`) và `<WIFI>` = interface WiFi có internet (ví dụ `wlan0`):

```bash
# 1. Set IP tĩnh cho Ethernet (nếu chưa set)
sudo ip addr flush dev <ETH>
sudo ip addr add 192.168.137.1/24 dev <ETH>
sudo ip link set <ETH> up

# 2. Bật IP forwarding
echo 1 | sudo tee /proc/sys/net/ipv4/ip_forward

# 3. Bật NAT: packets từ Ethernet ra WiFi được masquerade
sudo iptables -t nat -A POSTROUTING -o <WIFI> -j MASQUERADE

# 4. Cho phép forward từ Ethernet → WiFi
sudo iptables -A FORWARD -i <ETH> -o <WIFI> -j ACCEPT

# 5. Cho phép forward chiều về (established connections)
sudo iptables -A FORWARD -i <WIFI> -o <ETH> -m state --state RELATED,ESTABLISHED -j ACCEPT
```

**Kiểm tra:**
```bash
# Xem rule NAT
sudo iptables -t nat -L POSTROUTING -v

# Xem IP forwarding đang bật
cat /proc/sys/net/ipv4/ip_forward   # phải ra "1"
```

**Để persistent qua reboot:**

```bash
# IP forwarding persistent
echo "net.ipv4.ip_forward=1" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p

# iptables persistent
sudo apt install iptables-persistent -y
sudo netfilter-persistent save
```

---

## 4. Khởi động và kiểm tra kết nối

1. Cắm cáp Ethernet: PC ↔ RJ45 của W5500 trên gateway
2. Power on gateway → đợi ~10 giây
3. Kiểm tra log serial (COM port):
   ```
   I (xxxx) ETH_CONNECT: Ethernet link up
   I (xxxx) ETH_CONNECT: Static IP configured: 192.168.137.2 gw=192.168.137.1
   I (xxxx) ETH_CONNECT: Static IP active: 192.168.137.2
   I (xxxx) web_server: Web config server started (mode=STA)
   ```

4. **Ping từ PC:**

   Windows:
   ```cmd
   ping 192.168.137.2
   ```
   Ubuntu:
   ```bash
   ping -c 4 192.168.137.2
   ```

5. **Truy cập Web Config:**

   | URL | Ghi chú |
   |---|---|
   | `http://192.168.137.2/` | Luôn hoạt động |
   | `http://gateway.local/` | Cần mDNS — xem lưu ý bên dưới |

---

## 5. Chế độ CONFIG (WiFi AP)

Khi nhấn nút **BOOT (GPIO0)** hoặc gửi lệnh `CONFIG` qua UART, gateway chuyển sang:
- WiFi AP: SSID **`DA2-Gateway-Config`** / password **`datn1234`**
- Web config tại `http://192.168.4.1/`

Ethernet **không dùng được** ở CONFIG mode. Kết nối WiFi AP từ PC:

**Windows:** Settings → Wi-Fi → `DA2-Gateway-Config` → Connect → nhập `datn1234`  
**Ubuntu:** `nmcli dev wifi connect "DA2-Gateway-Config" password "datn1234"`

Sau khi config xong → **Reboot** → gateway boot lại NORMAL mode.

---

## 6. Tóm tắt nhanh

| Thao tác | Windows (Admin PowerShell) | Ubuntu (Terminal) |
|---|---|---|
| Set IP Ethernet | `netsh interface ip set address name="Ethernet" source=static addr=192.168.137.1 mask=255.255.255.0` | `sudo ip addr add 192.168.137.1/24 dev <ETH>` |
| Bật IP forward | *(ICS tự làm)* | `echo 1 \| sudo tee /proc/sys/net/ipv4/ip_forward` |
| Bật NAT | *(ICS tự làm)* | `sudo iptables -t nat -A POSTROUTING -o <WIFI> -j MASQUERADE` |
| Ping gateway | `ping 192.168.137.2` | `ping -c 4 192.168.137.2` |
| Truy cập web config | `http://192.168.137.2/` | `http://192.168.137.2/` |

---

## 7. Troubleshooting

### Ping 192.168.137.2 không thành công

- Kiểm tra cáp Ethernet đã cắm đúng chưa — đèn link trên W5500 phải sáng.
- Kiểm tra PC có IP `192.168.137.1` trên đúng Ethernet adapter chưa (`ipconfig` / `ip addr`).
- Kiểm tra log serial gateway có dòng `Ethernet link up` và `Static IP active` chưa.
- **Windows:** Tắt Windows Firewall tạm thời để kiểm tra: `netsh advfirewall set allprofiles state off` (nhớ bật lại sau: `on`)
- **Ubuntu:** Kiểm tra ufw: `sudo ufw status` — nếu active, cho phép: `sudo ufw allow from 192.168.137.0/24`

### `http://gateway.local/` không resolve

- Dùng IP trực tiếp: `http://192.168.137.2/`
- **Windows:** Thêm firewall rule cho mDNS:
  ```cmd
  netsh advfirewall firewall add rule name="mDNS-UDP" dir=in action=allow protocol=UDP localport=5353
  ```
- **Ubuntu:** mDNS thường hoạt động mặc định với Avahi. Kiểm tra: `avahi-resolve --name gateway.local`

### Gateway có link up nhưng không có internet

- Xác nhận bước NAT đã được cấu hình (Windows ICS hoặc iptables MASQUERADE trên Ubuntu).
- **Windows:** Kiểm tra ICS còn enable không — vào `ncpa.cpl` → Wi-Fi Properties → Sharing tab.
- **Ubuntu:** Kiểm tra `cat /proc/sys/net/ipv4/ip_forward` phải là `1`, và `sudo iptables -t nat -L` có rule MASQUERADE chưa.
- Firmware gateway dùng DNS `8.8.8.8` (cấu hình trong `ETH_STATIC_DNS1`) — nếu PC block port 53 outbound thì DNS sẽ fail.

### Windows ICS reset sau khi restart SharedAccess service

- **Không dùng `Stop-Service SharedAccess`** — lệnh này xoá toàn bộ ICS config.
- Nếu đã bị reset: vào `ncpa.cpl` → Wi-Fi Properties → Sharing → re-enable lại thủ công.
- Sau khi re-enable, kiểm tra: `ipconfig` — Ethernet phải có `192.168.137.1`.

### Không thấy WiFi AP `DA2-Gateway-Config`

- Nhấn nút BOOT >3 giây hoặc gửi lệnh `CONFIG` qua UART.
- LED phải nhấp nháy **xanh lam** khi ở CONFIG mode.
- **Ubuntu:** `nmcli dev wifi list` để scan lại.

### Python App không tìm thấy COM port

- **Windows:** Kiểm tra Device Manager — cần driver CH340 / CP210x / FTDI.
- **Ubuntu:** User cần thuộc group `dialout`: `sudo usermod -aG dialout $USER` (logout/login lại để có hiệu lực). Port thường là `/dev/ttyUSB0` hoặc `/dev/ttyACM0`.
