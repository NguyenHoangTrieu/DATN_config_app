# EBYTE HEX Frame Builder Specification
## E180-ZG120B — HEX Native Mode (stack_011)

> **Mục đích**: Tài liệu này cho PC App (JS/Python) khi build hoặc parse chuỗi HEX giao tiếp với module Zigbee E180-ZG120B qua Gateway DA2 (Firmware ESP32 chỉ là Transparent Bridge).

---

## 1. Cấu trúc Frame tiêu chuẩn

```
[Header 0x55] [Length] [Type] [Code] [Data...] [Checksum]
     1 byte     1 byte  1 byte 1 byte  N bytes    1 byte
```

| Field      | Size   | Mô tả |
|------------|--------|--------|
| `Header`   | 1 byte | Luôn `0x55` |
| `Length`   | 1 byte | = 1(Type) + 1(Code) + N(Data) + 1(Checksum) = **N + 3** |
| `Type`     | 1 byte | Phân loại command (xem bảng Type bên dưới) |
| `Code`     | 1 byte | Mã lệnh cụ thể |
| `Data`     | N bytes| Tham số lệnh (có thể rỗng, N=0) |
| `Checksum` | 1 byte | XOR của tất cả: `Type ^ Code ^ Data[0] ^ Data[1] ^ ... ^ Data[N-1]` |

### 1.1 Công thức tính nhanh

```python
def build_frame(type_byte, code_byte, data_bytes):
    payload = [type_byte, code_byte] + list(data_bytes)
    checksum = 0
    for b in payload:
        checksum ^= b
    length = len(payload) + 1  # +1 for checksum
    return bytes([0x55, length] + payload + [checksum])
```

```javascript
function buildFrame(typeByte, codeByte, dataBytes = []) {
    const payload = [typeByte, codeByte, ...dataBytes];
    const checksum = payload.reduce((xor, b) => xor ^ b, 0);
    const length = payload.length + 1; // +1 for checksum
    return new Uint8Array([0x55, length, ...payload, checksum]);
}
```

### 1.2 Bảng Command Type

| Type Value | Tên               | Hướng           | Mô tả |
|------------|-------------------|-----------------|-------|
| `0x00`     | `TYPE_CFG`        | Input/Feedback  | Lệnh cấu hình cục bộ |
| `0x01`     | `TYPE_ZDO_REQ`    | Input/Feedback  | Lệnh quản lý mạng ZDO |
| `0x02`     | `TYPE_ZCL_SEND`   | Input/Feedback  | Lệnh gửi ZCL |
| `0x80`     | `TYPE_NOTIFY`     | Async (RX only) | Thông báo hệ thống |
| `0x81`     | `TYPE_ZDO_RSP`    | Async (RX only) | Phản hồi lệnh ZDO |
| `0x82`     | `TYPE_ZCL_IND`    | Async (RX only) | Nhận ZCL |
| `0x8F`     | `TYPE_SEND_CNF`   | Async (RX only) | Xác nhận gửi |

### 1.3 Endian

> ⚠️ **Tất cả** các trường địa chỉ và ID trong Data đều là **Little-Endian (LE)**.  
> Ví dụ: Short Address `0x1234` → bytes `[0x34, 0x12]`  
> Cluster ID `0x0006` → bytes `[0x06, 0x00]`  
> PANID `0xABCD` → bytes `[0xCD, 0xAB]`

---

## 2. NHÓM 1 — Static Commands (`is_prefix: false`)

> **Quy tắc**: PC App **KHÔNG CẦN TÍNH TOÁN HEX** cho các hàm này.  
> Chỉ cần gọi RPC với `function_name` tương ứng. Firmware C đã có sẵn chuỗi HEX hoàn chỉnh được lưu trong `command` field của config JSON và sẽ tự gửi ra UART.

| # | function_name              | TX Frame (hex)                        | Expected RX (prefix)   | Ghi chú |
|---|----------------------------|---------------------------------------|------------------------|---------|
| 1 | `MODULE_HW_RESET`          | *(không có UART TX)*                  | —                      | GPIO toggle: pin05 LOW 100ms → HIGH |
| 2 | `MODULE_SW_RESET`          | `55 07 00 04 00 FF FF 00 04`          | `55 80 00`             | Soft reset, mode=0, PANID=0xFFFF, CH=0 |
| 3 | `MODULE_FACTORY_RESET`     | `55 07 00 04 02 FF FF 00 06`          | `55 80 00`             | Factory reset, mode=2 |
| 4 | `MODULE_GET_INFO`          | `55 03 00 00 00`                      | `55 2A 00 00`          | Query status, resp = 42 bytes payload |
| 5 | `MODULE_ENTER_BOOTLOADER`  | *(không có UART TX)*                  | —                      | GPIO: pin02 HIGH 50ms, pin01 LOW |
| 6 | `MODULE_START_NETWORK`     | `55 04 00 02 00 02`                   | `55 04 00 02 00 02`    | Open network, default mode=0x00 |
| 7 | `MODULE_STOP_NETWORK`      | `55 03 00 03 03`                      | `55 00 03`             | Close network |
| 8 | `MODULE_LEAVE_NETWORK`     | `55 07 00 04 01 FF FF 00 05`          | `55 00 04`             | Leave network, mode=1 |
| 9 | `MODULE_GET_NET_STATUS`    | `55 00 00` *(3 bytes: hdr+len+chk)*   | `55 00 00`             | ⚠️ Frame đặc biệt: Length=0, chỉ có Header+Length+Checksum=0x00 |
|10 | `MODULE_SET_PERMIT_JOIN`   | `55 00 02` *(xem ghi chú)*            | `55 00 02`             | Thực ra: `55 04 00 02 00 02` — dùng frame MODULE_START_NETWORK |
|11 | `MODULE_AUTO_FIND_TARGET`  | `55 00 14` *(xem ghi chú)*            | `55 00 14`             | ⚠️ Frame ngắn: Type=0x00, Code=0x14, no data, chk=0x14 |
|12 | `MODULE_ENTER_SLEEP`       | *(không có UART TX)*                  | —                      | GPIO-only hoặc firmware handle |
|13 | `MODULE_WAKEUP`            | *(không có UART TX)*                  | —                      | GPIO: pin03 LOW 10ms → HIGH |
|14 | `MODULE_ENTER_HEX_MODE`    | `AT+EXIT\r\n` *(ASCII, is_hex=false)* | —                      | Gửi text AT command, timeout 100ms |
|15 | `MODULE_ENTER_AT_MODE`     | `55 03 00 16 16` *(xem ghi chú)*      | —                      | Type=0x00, Code=0x16, no data |
|16 | `MODULE_EXIT_SEND_MODE`    | `+++` *(ASCII, is_hex=false)*         | —                      | Escape sequence |

> **Ghi chú quan trọng cho MODULE_GET_NET_STATUS và MODULE_AUTO_FIND_TARGET**:
> Frame 3 bytes `55 XX YY` = Header(0x55) + Length(1 byte) + single-byte payload (Checksum chính là Code khi Data=empty và Type XOR Code = Code nếu Type=0x00).  
> Cụ thể: `55 00 00` = Hdr + Len(0→invalid) — thực ra đây là frame `55 + len=01 + code=0x00 + chk=0x00` nên phải đọc là: Hdr=55, Len=0x00... 
> ⚠️ **QUAN TRỌNG**: Frame `55 00 00` trong JSON là chuỗi 3 bytes chính xác được hardcode — đây là frame đặc biệt theo đúng spec E180 (Length field = 0 means no payload, Checksum=0x00). Không cần tính lại.

---

## 3. NHÓM 2 — Dynamic Commands (`is_prefix: true`)

> **Quy tắc**: PC App **BẮT BUỘC TỰ ĐÓNG GÓI CHUỖI HEX TỪ A-Z** cho các hàm này.  
> Firmware C khi nhận `command=""` + `is_prefix=true` sẽ ghép `"" + <chuỗi PC App truyền xuống>` = dùng nguyên chuỗi PC App gửi.

---

### 3.1 `MODULE_SET_CHANNEL`

- **Type**: `0x00` (TYPE_CFG) | **Code**: `0x06` (CFG_CHANNEL)
- **Expected RX prefix**: `55 00 06`

**Cấu trúc Data**:
| Byte | Field    | Mô tả |
|------|----------|--------|
| 0    | Settings | `0x01` = enable channel, `0x00` = disable, `0x02` = override |
| 1..N | Channels | Danh sách channel cần enable/disable (giá trị 11–26) |

**Ví dụ** — Set channel 15 (enable):
```
Type=0x00, Code=0x06, Data=[0x01, 0x0F]
Length = 1+1+2+1 = 5
Checksum = 0x00 ^ 0x06 ^ 0x01 ^ 0x0F = 0x08
Frame: 55 05 00 06 01 0F 08
```

---

### 3.2 `MODULE_SET_PANID`

- **Type**: `0x00` (TYPE_CFG) | **Code**: `0x08` (CFG_SET_PANID)
- **Expected RX prefix**: `55 00 08`

**Cấu trúc Data**:
| Byte | Field | Mô tả |
|------|-------|--------|
| 0–1  | PANID | 2 bytes Little-Endian. VD: PANID=0x1A2B → `[0x2B, 0x1A]` |

**Ví dụ** — Set PANID = 0x1234:
```
Type=0x00, Code=0x08, Data=[0x34, 0x12]
Length = 1+1+2+1 = 5
Checksum = 0x00 ^ 0x08 ^ 0x34 ^ 0x12 = 0x3E
Frame: 55 05 00 08 34 12 3E
```

---

### 3.3 `MODULE_SET_TX_POWER`

- **Type**: `0x00` (TYPE_CFG) | **Code**: `0x0D` (CFG_TX_POWER)
- **Expected RX prefix**: `55 00 0D`

**Cấu trúc Data**:
| Byte | Field | Mô tả |
|------|-------|--------|
| 0    | Mode  | `0x00` = query, `0x01` = set |
| 1    | Power | Power level. E180-ZG120 range: `0x00`–`0x14` |

**Ví dụ** — Set power = 20 (0x14):
```
Type=0x00, Code=0x0D, Data=[0x01, 0x14]
Checksum = 0x00 ^ 0x0D ^ 0x01 ^ 0x14 = 0x18
Frame: 55 05 00 0D 01 14 18
```

---

### 3.4 `MODULE_SET_DEVICE_TYPE`

- **Type**: `0x00` (TYPE_CFG) | **Code**: `0x05` (CFG_NODE_TYPE)
- **Expected RX prefix**: `55 00 05`

**Cấu trúc Data**:
| Byte | Field       | Mô tả |
|------|-------------|--------|
| 0    | Device Type | `0x00`=Coordinator, `0x01`=Router, `0x02`=End Node, `0x03`=Sleeping End Node |

**Ví dụ** — Set as Coordinator:
```
Type=0x00, Code=0x05, Data=[0x00]
Checksum = 0x00 ^ 0x05 ^ 0x00 = 0x05
Frame: 55 04 00 05 00 05
```

---

### 3.5 `MODULE_SET_COMM_CONFIG`

- **Type**: `0x00` (TYPE_CFG) | **Code**: `0x22` (CFG_GET_ADDRTAB / set comm)
- **Expected RX prefix**: `55 00 22`

**Cấu trúc Data**: Xem spec Ebyte section 2.1.21 — truyền Address Number (2B) + Query Mode (1B).

| Byte | Field          | Mô tả |
|------|----------------|--------|
| 0–1  | Address Number | 2 bytes LE, địa chỉ cần query (0x0000–0x00FE) |
| 2    | Query Mode     | `0x00` = normal query |

---

### 3.6 `MODULE_QUERY_SHORT_ADDR`

- **Type**: `0x01` (TYPE_ZDO_REQ) | **Code**: `0x00` (ZDO_NWK_ADDR_REQ)
- **Expected RX prefix**: `55 81 00` (TYPE_ZDO_RSP, Code=0x00)

**Cấu trúc ZDO Command** (xem unified header format section 3.2.1):
```
Frame: [0x55][Length][0x01][0x00][ShortAddr 2B LE][MacAddr 8B][Checksum]
```
> Theo spec: Short address trong header = `0xFD 0xFF` (broadcast 0xFFFD), MacAddr = IEEE address cần query.

| Byte | Field       | Mô tả |
|------|-------------|--------|
| 0–1  | ShortAddr   | `0xFD 0xFF` (broadcast ZDO: 0xFFFD) |
| 2–9  | MAC Address | 8 bytes IEEE address cần query (LE) |

**Ví dụ** — Query short address của MAC `AA BB CC DD EE FF 01 02`:
```
Type=0x01, Code=0x00, Data=[0xFD, 0xFF, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x01, 0x02]
Length = 1+1+10+1 = 13 = 0x0D
Checksum = 0x01 ^ 0x00 ^ 0xFD ^ 0xFF ^ 0xAA ^ 0xBB ^ 0xCC ^ 0xDD ^ 0xEE ^ 0xFF ^ 0x01 ^ 0x02
Frame: 55 0D 01 00 FD FF AA BB CC DD EE FF 01 02 [chk]
```

---

### 3.7 `MODULE_QUERY_IEEE_ADDR`

- **Type**: `0x01` (TYPE_ZDO_REQ) | **Code**: `0x01` (ZDO_IEEE_ADDR_REQ)
- **Expected RX prefix**: `55 81 01`

**Cấu trúc Data**:
| Byte | Field      | Mô tả |
|------|------------|--------|
| 0–1  | ShortAddr  | Short address của node cần query (LE) |

**Ví dụ** — Query IEEE của node 0x1234:
```
Type=0x01, Code=0x01, Data=[0x34, 0x12]
Checksum = 0x01 ^ 0x01 ^ 0x34 ^ 0x12 = 0x26
Frame: 55 05 01 01 34 12 26
```

---

### 3.8 `MODULE_QUERY_NODE_PORT_INFO`

- **Type**: `0x01` (TYPE_ZDO_REQ) | **Code**: `0x04` (ZDO_SIMPLE_DESC_REQ)
- **Expected RX prefix**: `55 81 04`

**Cấu trúc Data**:
| Byte | Field      | Mô tả |
|------|------------|--------|
| 0–1  | ShortAddr  | Short address của node (LE) |
| 2    | Port Number| Endpoint/port number cần query (1–240) |

**Ví dụ** — Query port 0x01 của node 0x1234:
```
Type=0x01, Code=0x04, Data=[0x34, 0x12, 0x01]
Checksum = 0x01 ^ 0x04 ^ 0x34 ^ 0x12 ^ 0x01 = 0x22
Frame: 55 06 01 04 34 12 01 22
```

---

### 3.9 `MODULE_DELETE_NODE`

- **Type**: `0x01` (TYPE_ZDO_REQ) | **Code**: `0x34` (ZDO_MGMT_LEAVE_REQ)
- **Expected RX prefix**: `55 81 36` (ZDO_MGMT_LEAVE_RSP)

**Cấu trúc Data**:
| Byte | Field            | Mô tả |
|------|------------------|--------|
| 0–1  | ShortAddr        | Short address của parent node (LE). Với End Node dùng parent node addr. |
| 2–9  | MAC Address      | IEEE MAC của node cần xóa (8 bytes LE) |
| 10   | Re-entry network | `0x00` (mặc định) |
| 11   | Delete child     | `0x00` (mặc định) |

**Ví dụ** — Delete node MAC `AA BB CC DD EE FF 01 02`, parent short addr 0x0000:
```
Type=0x01, Code=0x34, Data=[0x00, 0x00, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x01, 0x02, 0x00, 0x00]
Length = 1+1+12+1 = 15 = 0x0F
Frame: 55 0F 01 34 00 00 AA BB CC DD EE FF 01 02 00 00 [chk]
```

---

### 3.10 `MODULE_ZCL_READ_ATTR`

- **Type**: `0x02` (TYPE_ZCL_SEND) | **Code**: `0x00` (ZCL_READ_ATTR_REQ)
- **Expected RX prefix**: `55 82 00` (ZCL_READ_ATTR_RSP via TYPE_ZCL_IND)

**ZCL Unified Header** (11 bytes trước extended data):
```
[NativePort(1B)] [TxMode(1B)] [TargetShortAddr(2B LE)] [TargetPort(1B)]
[FrameSeq(1B)] [Direction(1B)] [ClusterID(2B LE)] [ManuCode(2B LE)] [RespMode(1B)]
```

| Byte | Field           | Mô tả |
|------|-----------------|--------|
| 0    | NativePort      | `0x00` (default port 0) |
| 1    | TxMode          | `0x00` = normal unicast |
| 2–3  | TargetShortAddr | 2 bytes LE |
| 4    | TargetPort      | Endpoint của target (thường `0x01`) |
| 5    | FrameSeq        | Frame sequence number (tự tăng, 0–255) |
| 6    | Direction       | `0x00` = C2S (Client to Server) |
| 7–8  | ClusterID       | 2 bytes LE. VD: On/Off=`0x06 0x00` |
| 9–10 | ManuCode        | `0x00 0x00` (standard), hoặc `0x00 0x20` cho Ebyte custom |
| 11   | RespMode        | `0x00` = Default Response |

**Extended Data** cho Read Attr:
| Byte | Field           | Mô tả |
|------|-----------------|--------|
| 0    | NumAttributes   | Số lượng attribute cần đọc |
| 1..N | AttrID list     | Mỗi AttrID là 2 bytes LE |

**Ví dụ** — Đọc On/Off status (AttrID=0x0000) từ node 0x1234, EP=01, Cluster=0x0006:
```
Type=0x02, Code=0x00
Data = [0x00,           // NativePort
        0x00,           // TxMode
        0x34, 0x12,     // TargetAddr 0x1234 LE
        0x01,           // TargetPort EP1
        0x01,           // FrameSeq=1
        0x00,           // Direction C2S
        0x06, 0x00,     // ClusterID 0x0006 LE
        0x00, 0x00,     // ManuCode = none
        0x00,           // RespMode = default resp
        0x01,           // NumAttr = 1
        0x00, 0x00]     // AttrID 0x0000 LE
Length = 1+1+14+1 = 17 = 0x11
Checksum = XOR of all payload bytes
Frame: 55 11 02 00 00 00 34 12 01 01 00 06 00 00 00 00 01 00 00 [chk]
```

---

### 3.11 `MODULE_ZCL_WRITE_ATTR`

- **Type**: `0x02` | **Code**: `0x01` (ZCL_WRTIE_ATTR_REQ)
- **Expected RX prefix**: `55 82 01`

**Extended Data** (sau ZCL Unified Header 11 bytes):
| Byte | Field        | Mô tả |
|------|--------------|--------|
| 0    | NumAttr      | Số attribute cần ghi |
| per-attr | AttrID (2B LE) + DataType (1B) + DataValue (NB) | |

**Ví dụ** — Ghi On/Off = ON (AttrID=0x0000, Type=bool 0x10, Value=0x01):
```
Extended = [0x01,           // NumAttr
            0x00, 0x00,     // AttrID 0x0000
            0x10,           // DataType bool
            0x01]           // Value = ON
```

---

### 3.12 `MODULE_ZCL_SEND_CONTROL_CMD`

- **Type**: `0x02` | **Code**: `0x0F` (ZCL_CMD)
- **Expected RX prefix**: `55 02 0F` (send feedback) + `55 8F 02` (send confirm async)

**Extended Data** (sau ZCL Unified Header 11 bytes):
| Byte | Field             | Mô tả |
|------|-------------------|--------|
| 0    | CmdID             | Command ID trong cluster. VD: On/Off cluster: `0x01`=On, `0x00`=Off, `0x02`=Toggle |
| 1..N | CmdParams         | Tham số lệnh, phụ thuộc CmdID và Cluster |

**Bảng CmdID quan trọng**:

| Cluster        | CmdID | Tên      | Params |
|----------------|-------|----------|--------|
| `0x0006` On/Off| `0x00`| Off      | none |
| `0x0006` On/Off| `0x01`| On       | none |
| `0x0006` On/Off| `0x02`| Toggle   | none |
| `0x0008` Level | `0x00`| MoveToLevel | uint8 level + uint16 transTime |
| `0x0008` Level | `0x04`| MoveToLevel+OnOff | uint8 level + uint16 transTime |
| `0x0003` Identify| `0x00`| Identify | uint16 IdentifyTime |

**Ví dụ** — Gửi ON cho node 0x1234, EP=01 (Cluster 0x0006):
```
Type=0x02, Code=0x0F
Data = [ZCL Header 11 bytes với ClusterID=0x0006 0x00] + [CmdID=0x01]
Frame example:
55 10 02 0F 00 00 34 12 01 02 00 06 00 00 00 00 01 0D
(FrameSeq=2, Direction=0, RespMode=0, CmdID=0x01)
```

---

### 3.13 `MODULE_ZCL_SET_REPORT_RULE`

- **Type**: `0x02` | **Code**: `0x03` (ZCL_WRITE_REPORT_REQ)
- **Expected RX prefix**: `55 82 03`

**Extended Data** (sau ZCL Unified Header 11 bytes):
| Byte | Field      | Mô tả |
|------|------------|--------|
| 0    | NumAttr    | Số attribute cần set rule |
| per-attr | AttrID(2B LE) + MinTime(2B LE) + MaxTime(2B LE) + DataType(1B) + DeltaValue(NB aligned) | |

> **Ghi chú**: DeltaValue alignment theo bảng ZCL Data Type (4-byte aligned cho uint/int). Nếu alignment=0 (bool, enum), bỏ qua trường DeltaValue.

**Ví dụ** — Set report rule cho Temperature (AttrID=0x0000, Cluster=0x0402), min=30s, max=300s, delta=50 (int16):
```
AttrID=0x0000, MinTime=0x001E, MaxTime=0x012C, DataType=0x29(int16), Delta=0x0032(50) + 0x0000 padding
Extended = [0x01, 0x00,0x00, 0x1E,0x00, 0x2C,0x01, 0x29, 0x32,0x00,0x00,0x00]
```

---

### 3.14 `MODULE_ZCL_DISCOVER_ATTR`

- **Type**: `0x02` | **Code**: `0x04` (ZCL_DISC_ATTR_REQ)
- **Expected RX prefix**: `55 82 04`

**Extended Data**:
| Byte | Field              | Mô tả |
|------|--------------------|--------|
| 0    | NumAttr            | Số lượng attr muốn discover |
| 1–2  | StartAttrID        | Starting Attribute ID (2B LE), thường `0x00 0x00` |

---

### 3.15 `MODULE_ZCL_IDENTIFY`

- **Type**: `0x02` | **Code**: `0x0F` (ZCL_CMD) với Cluster=0x0003
- **Expected RX prefix**: `55 02 0F`

**Extended Data** = ZCL Header (ClusterID=`0x03 0x00`) + CmdID=`0x00` + Params:
| Byte | Field        | Mô tả |
|------|--------------|--------|
| 0    | CmdID        | `0x00` (Identify) |
| 1–2  | IdentifyTime | uint16 LE — thời gian identify (giây). `0x00FF` = max |

---

### 3.16 `MODULE_ZCL_BIND`

- **Type**: `0x01` (TYPE_ZDO_REQ) | **Code**: `0x21` (ZDO_BIND_REQ)
- **Expected RX prefix**: `55 81 21`

**Cấu trúc Data** (ZDO Bind):
| Byte | Field          | Mô tả |
|------|----------------|--------|
| 0–1  | ShortAddr      | Short address của node nguồn (LE) |
| 2–10 | Source SN      | Virtual SN = PortNumber(1B) + IEEE(8B LE) |
| 11–12| ClusterID      | 2 bytes LE |
| 13–21| Target SN      | Virtual SN = PortNumber(1B) + IEEE(8B LE) |

> **Virtual SN format**: `[port(1B)] [IEEE[0]] [IEEE[1]] ... [IEEE[7]]`  
> Nếu target là coordinator: điền `0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00`

---

### 3.17 `MODULE_ZCL_UNBIND`

- **Type**: `0x01` | **Code**: `0x22` (ZDO_UNBIND_REQ)
- **Expected RX prefix**: `55 81 22`
- **Cấu trúc Data**: Giống hệt MODULE_ZCL_BIND

---

### 3.18 `MODULE_ZCL_GET_BIND_TABLE`

- **Type**: `0x01` | **Code**: `0x33` (ZDO_MGMT_BIND_REQ)
- **Expected RX prefix**: `55 81 33`

**Cấu trúc Data**:
| Byte | Field      | Mô tả |
|------|------------|--------|
| 0–1  | ShortAddr  | Short addr của node cần xem binding (LE) |
| 2    | StartIndex | Chỉ số bắt đầu (0x00 để lấy từ đầu) |

---

### 3.19 `MODULE_SEND_UNICAST`

- **Type**: `0x02` (TYPE_ZCL_SEND) | **Code**: `0x0F` (ZCL_CMD)
- **Expected RX prefix**: `55 8F 02` (send confirm async)

> Đây là ZCL data transparent transmission (Cluster=0xFC08, ManuCode=0x2000, CmdID=0x00 UartSend).

**Full Frame Structure**:
```
ZCL Header (11 bytes):
  NativePort=0x00, TxMode=0x00
  TargetShortAddr (2B LE)
  TargetPort = 0x01 (EP1)
  FrameSeq (1B, tự tăng)
  Direction = 0x00 (C2S)
  ClusterID = 0x08 0xFC  (0xFC08 LE)
  ManuCode  = 0x00 0x20  (0x2000 LE)
  RespMode  = 0x02 (no reply, high speed)
Extended Data:
  CmdID = 0x00 (UartSend)
  Data bytes... (payload cần gửi)
```

---

### 3.20 `MODULE_SEND_BROADCAST`

- Giống `MODULE_SEND_UNICAST` nhưng TargetShortAddr = `0xFF 0xFF` (0xFFFF broadcast) hoặc `0xFD 0xFF` (0xFFFD)
- TxMode bit: `0x00` normal

---

### 3.21 `MODULE_SEND_MULTICAST`

- Giống `MODULE_SEND_UNICAST` nhưng TargetShortAddr = Group Address, TargetPort = `0xFF` (multicast port)

---

### 3.22 `MODULE_ENTER_TRANSPARENT_MODE`

- **Type**: `0x00` | **Code**: `0x11` (CFG_WRITE_ATTR local)
- **Expected RX prefix**: `55 00 11`

**Cấu trúc Data**: Local attribute write — Set `sendMode` (AttrID=0x0003) = `TRUE (0x01)`:
| Byte | Field       | Mô tả |
|------|-------------|--------|
| 0    | PortIndex   | `0x00` |
| 1–2  | AttrID      | `0x03 0x00` (sendMode) |
| 3..N | AttrData    | `0x01` (bool TRUE = transparent mode) |

---

### 3.23 `MODULE_SET_DEST_ADDR`

- **Type**: `0x00` | **Code**: `0x11`
- **Expected RX prefix**: `55 00 11`

**Cấu trúc Data**: Local attr write — Set `targetAddr` (AttrID=0x0001):
| Byte | Field    | Mô tả |
|------|----------|--------|
| 0    | PortIndex| `0x00` |
| 1–2  | AttrID   | `0x01 0x00` (targetAddr) |
| 3–4  | ShortAddr| uint16 LE — destination short address |

---

### 3.24 `MODULE_SET_DEST_EP`

- **Type**: `0x00` | **Code**: `0x11`
- **Expected RX prefix**: `55 00 11`

**Cấu trúc Data**: Local attr write — Set `targetEP` (AttrID=0x0002):
| Byte | Field    | Mô tả |
|------|----------|--------|
| 0    | PortIndex| `0x00` |
| 1–2  | AttrID   | `0x02 0x00` (targetEP) |
| 3    | EP       | uint8 — destination endpoint (thường `0x01`) |

---

### 3.25 `MODULE_SET_LP_LEVEL`

- **Type**: `0x00` | **Code**: `0x11`
- **Expected RX prefix**: `55 00 11`

**Cấu trúc Data**: Local attr write — Set `LP Level` (AttrID=0x0004):
| Byte | Field    | Mô tả |
|------|----------|--------|
| 0    | PortIndex| `0x00` |
| 1–2  | AttrID   | `0x04 0x00` (LP Level) |
| 3    | Level    | enum8: `0x00`=1s wake/2min heartbeat, `0x01`=3s/4min, `0x02`=5s/6min, `0x03`=always sleep |

---

## 4. NHÓM 3 — Async Events / Parser (`is_async_event: true`)

> **Quy tắc**: PC App phải **lắng nghe liên tục** các frame đến từ telemetry (qua MQTT ThingsBoard).  
> Khi nhận được chuỗi HEX, parse theo format: `[0x55][Length][Type][Code][Data...][Checksum]`  
> Xác định loại event bằng cặp `(Type, Code)`.

### 4.1 Bảng tất cả Async Events

| # | function_name               | Type   | Code   | Frame Prefix    | Mô tả |
|---|-----------------------------|--------|--------|-----------------|--------|
| 1 | `MODULE_BOOT_NOTIFY`        | `0x80` | `0x00` | `55 .. 80 00`   | Module khởi động — chứa Reset Mode, Version, MAC |
| 2 | `MODULE_NET_STATUS_NOTIFY`  | `0x80` | `0x01` | `55 .. 80 01`   | Trạng thái mạng thay đổi (join/leave) |
| 3 | `MODULE_NODE_JOIN_NOTIFY`   | `0x80` | `0x03` | `55 .. 80 03`   | Phát hiện node mới join network |
| 4 | `MODULE_NODE_ANNOUNCE_NOTIFY`| `0x80`| `0x05` | `55 .. 80 05`   | Thông tin chi tiết node (DevSN, clusters) |
| 5 | `MODULE_NODE_LEAVE_NOTIFY`  | `0x80` | `0x06` | `55 .. 80 06`   | Node rời mạng |
| 6 | `MODULE_FIND_BIND_NOTIFY`   | `0x80` | `0x10` | `55 .. 80 10`   | Kết quả Auto Find & Bind |
| 7 | `MODULE_ZCL_RECV_ATTR_REPORT`| `0x82`| `0x0A` | `55 .. 82 0A`  | Attribute report từ device (cảm biến, on/off...) |
| 8 | `MODULE_ZCL_RECV_CONTROL_CMD`| `0x82`| `0x0F` | `55 .. 82 0F`  | Nhận control command từ device |
| 9 | `MODULE_ZCL_DEFAULT_RSP`    | `0x82` | `0x0B` | `55 .. 82 0B`   | Default response (ack/nak cho lệnh đã gửi) |
|10 | `MODULE_SEND_CONFIRM`       | `0x8F` | `0x02` | `55 .. 8F 02`   | Xác nhận gửi wireless (kết quả TX) |

---

### 4.2 Chi tiết Parser từng Event

#### 4.2.1 `MODULE_BOOT_NOTIFY` — Type=0x80, Code=0x00

```
Data layout: [ResetMode(1B)] [Version(1B)] [MAC(8B LE)]
Total Data = 10 bytes
```
```javascript
function parseBootNotify(data) {
    return {
        resetMode: data[0],
        version:   data[1],
        mac:       data.slice(2, 10).reverse().map(b => b.toString(16).padStart(2,'0')).join(':')
    };
}
```

---

#### 4.2.2 `MODULE_NET_STATUS_NOTIFY` — Type=0x80, Code=0x01

```
Data layout:
  [NetworkStatus(1B)] [MAC(8B)] [Channel(1B)] [PANID(2B LE)] 
  [ShortAddr(2B LE)] [ExtPANID(8B)] [NetworkKey(16B? — see spec)]
```
- `NetworkStatus`: `0x00`=not networked, `0x01`=networked, `0x02`=network config mode

---

#### 4.2.3 `MODULE_NODE_JOIN_NOTIFY` — Type=0x80, Code=0x03

```
Data layout:
  [MAC(8B LE)] [ShortAddr(2B LE)] [ParentAddr(2B LE)] [AccessMode(1B)]
```
- `AccessMode`: `0x00`=first join, `0x01`=re-join, `0x02`=re-join+resync key

```javascript
function parseNodeJoin(data) {
    return {
        mac:        toHexStr(data.slice(0,8)),
        shortAddr:  (data[9]<<8 | data[8]).toString(16).toUpperCase().padStart(4,'0'),
        parentAddr: (data[11]<<8 | data[10]).toString(16).toUpperCase().padStart(4,'0'),
        accessMode: data[12]
    };
}
```

---

#### 4.2.4 `MODULE_NODE_ANNOUNCE_NOTIFY` — Type=0x80, Code=0x05

> Quan trọng nhất — cung cấp toàn bộ thông tin device khi join lần đầu.

```
Data layout (per port, may repeat):
  [TermFlag(1B)] [DevSN(9B)] [ShortAddr(2B LE)] [PortNum(1B)] 
  [PortProfile(2B LE)] [DeviceID(2B LE)] [InputClusters: count(1B) + list(2*N bytes)]
  [OutputClusters: count(1B) + list(2*N bytes)]
```
- `TermFlag=1` = này là port cuối cùng của node
- `DevSN` = `[port(1B)] + [IEEE 8B LE]`

---

#### 4.2.5 `MODULE_NODE_LEAVE_NOTIFY` — Type=0x80, Code=0x06

```
Data layout: [MAC(8B LE)]
```

---

#### 4.2.6 `MODULE_FIND_BIND_NOTIFY` — Type=0x80, Code=0x10

```
Data layout: [TargetShortAddr(2B LE)] [TargetPort(1B)] [ClusterID(2B LE)]
```
- `ClusterID=0xFC08` → transparent link thành công
- `ClusterID=0x0006` → On/Off control binding
- `ClusterID=0x0008` → Level control binding

---

#### 4.2.7 `MODULE_ZCL_RECV_ATTR_REPORT` — Type=0x82, Code=0x0A ⭐ QUAN TRỌNG NHẤT

> Đây là event quan trọng nhất cho monitor dashboard — thiết bị tự động report attribute.

```
ZCL Header (11 bytes):
  [TxMode(1B)] [SrcShortAddr(2B LE)] [SrcPort(1B)] [FrameSeq(1B)]
  [Direction(1B)] [ClusterID(2B LE)] [ManuCode(2B LE)] [SignalStrength(1B)]
Extended Data:
  [NumAttr(1B)] [AttrID(2B LE)] [DataType(1B)] [DataValue(NB)] ...
```

```javascript
function parseAttrReport(frame) {
    // frame = raw bytes array starting from Type byte
    // Skip ZCL header 11 bytes (after Type+Code)
    const hdrOffset = 2; // skip Type, Code
    const srcAddr = (frame[hdrOffset+2] << 8) | frame[hdrOffset+1];
    const clusterId = (frame[hdrOffset+8] << 8) | frame[hdrOffset+7];
    const extOffset = hdrOffset + 11;
    const numAttr = frame[extOffset];
    const attrs = [];
    let pos = extOffset + 1;
    for (let i = 0; i < numAttr; i++) {
        const attrId = (frame[pos+1] << 8) | frame[pos];
        const dataType = frame[pos+2];
        const value = parseAttrValue(frame, pos+3, dataType);
        attrs.push({ attrId, dataType, value });
        pos += 2 + 1 + getDataTypeSize(dataType);
    }
    return { srcAddr, clusterId, attrs };
}
```

**Known Cluster/Attr pairs** (từ monitor widget):

| Cluster  | AttrID   | Tên           | Type     | Cách parse |
|----------|----------|---------------|----------|------------|
| `0x0006` | `0x0000` | On/Off        | bool 0x10| `0x00`=OFF, `0x01`=ON |
| `0x0008` | `0x0000` | Current Level | uint8 0x20| `value/254*100`% |
| `0x0402` | `0x0000` | Temperature   | int16 0x29| `int16(value) * 0.01` °C |
| `0x0300` | `0x0000` | Hue           | uint8 0x20| `value/254*360`° |
| `0x0300` | `0x0001` | Saturation    | uint8 0x20| `value/254*100`% |
| `0x0300` | `0x0007` | Color X       | uint16 0x21| CIE 1931 x |
| `0x0300` | `0x0008` | Color Y       | uint16 0x21| CIE 1931 y |

---

#### 4.2.8 `MODULE_ZCL_RECV_CONTROL_CMD` — Type=0x82, Code=0x0F

> Nhận lệnh điều khiển từ device (device chủ động gửi lên coordinator).

```
ZCL Header (11 bytes) + Extended:
  [CmdID(1B)] [CmdParams(NB)]
```
Giống cấu trúc SEND_CONTROL_CMD nhưng chiều ngược lại.

---

#### 4.2.9 `MODULE_ZCL_DEFAULT_RSP` — Type=0x82, Code=0x0B

```
ZCL Header (11 bytes) + Extended:
  [CmdID(1B)] [ZCLStatus(1B)]
```
- `ZCLStatus=0x00` → OK
- `ZCLStatus=0x81` → Command not supported
- Dùng `FrameSeq` trong ZCL Header để map với lệnh đã gửi

---

#### 4.2.10 `MODULE_SEND_CONFIRM` — Type=0x8F, Code=0x02

```
Data layout:
  [TxMode(1B)] [TargetShortAddr(2B LE)] [TargetPort(1B)] 
  [FrameSeq(1B)] [Direction(1B)] [SendResult(1B)]
```
- `SendResult=0x00` → TX success
- `SendResult=0x01` → TX failed
- `SendResult=0x66` → E180 send data failed (Silabs error)

---

## 5. Pseudocode Helper Functions

```javascript
// Build any command frame
function buildEbyteFrame(type, code, data = []) {
    const payload = [type, code, ...data];
    const checksum = payload.reduce((xor, b) => xor ^ b, 0);
    const length = payload.length + 1;
    return [0x55, length, ...payload, checksum];
}

// Build ZCL command with unified header
function buildZclFrame(code, targetAddr, targetPort, clusterID, manuCode,
                       frameSeq, direction, respMode, extendedData) {
    const zclHeader = [
        0x00,                          // NativePort
        0x00,                          // TxMode
        targetAddr & 0xFF,             // ShortAddr LE
        (targetAddr >> 8) & 0xFF,
        targetPort,                    // TargetPort
        frameSeq & 0xFF,               // FrameSeq
        direction,                     // 0=C2S, 1=S2C
        clusterID & 0xFF,              // ClusterID LE
        (clusterID >> 8) & 0xFF,
        manuCode & 0xFF,               // ManuCode LE
        (manuCode >> 8) & 0xFF,
        respMode                       // RespMode
    ];
    return buildEbyteFrame(0x02, code, [...zclHeader, ...extendedData]);
}

// Parse incoming frame — check prefix
function parseFrame(bytes) {
    if (bytes[0] !== 0x55) return null;
    const length = bytes[1];
    const type   = bytes[2];
    const code   = bytes[3];
    const data   = bytes.slice(4, 2 + length);
    const chkRcv = bytes[2 + length];
    const chkCalc = bytes.slice(2, 2 + length).reduce((x,b) => x^b, 0);
    if (chkRcv !== chkCalc) return null; // checksum mismatch
    return { type, code, data };
}

// ZDO frame builder
function buildZdoFrame(code, shortAddr, cmdParams) {
    const data = [
        shortAddr & 0xFF,
        (shortAddr >> 8) & 0xFF,
        ...cmdParams
    ];
    return buildEbyteFrame(0x01, code, data);
}
```

---

## 6. Quick Reference — RPC → Frame Mapping

| RPC function_name           | Cách gọi từ PC App |
|-----------------------------|---------------------|
| Static (Nhóm 1)             | Gửi RPC với `function_name`, firmware tự gửi frame |
| `MODULE_SET_CHANNEL`        | `buildEbyteFrame(0x00, 0x06, [mode, ...channels])` |
| `MODULE_SET_PANID`          | `buildEbyteFrame(0x00, 0x08, [panidLo, panidHi])` |
| `MODULE_SET_TX_POWER`       | `buildEbyteFrame(0x00, 0x0D, [0x01, power])` |
| `MODULE_SET_DEVICE_TYPE`    | `buildEbyteFrame(0x00, 0x05, [devType])` |
| `MODULE_QUERY_IEEE_ADDR`    | `buildZdoFrame(0x01, shortAddr, [])` |
| `MODULE_QUERY_SHORT_ADDR`   | `buildZdoFrame(0x00, 0xFFFD, [mac8bytes])` |
| `MODULE_QUERY_NODE_PORT_INFO`| `buildZdoFrame(0x04, shortAddr, [portNum])` |
| `MODULE_DELETE_NODE`        | `buildZdoFrame(0x34, parentAddr, [mac8B, 0x00, 0x00])` |
| `MODULE_ZCL_READ_ATTR`      | `buildZclFrame(0x00, addr, ep, cluster, 0, seq, 0, 0, [nAttr, ...attrIds])` |
| `MODULE_ZCL_WRITE_ATTR`     | `buildZclFrame(0x01, addr, ep, cluster, 0, seq, 0, 0, [nAttr, ...attrStructs])` |
| `MODULE_ZCL_SEND_CONTROL_CMD`| `buildZclFrame(0x0F, addr, ep, cluster, manu, seq, dir, resp, [cmdId, ...params])` |
| `MODULE_ZCL_SET_REPORT_RULE`| `buildZclFrame(0x03, addr, ep, cluster, 0, seq, 0, 0, [nAttr, ...ruleStructs])` |
| `MODULE_SEND_UNICAST`       | `buildZclFrame(0x0F, addr, 0x01, 0xFC08, 0x2000, seq, 0, 0x02, [0x00, ...payload])` |
| Async Events (Nhóm 3)       | Parse frame bằng `parseFrame()` → dispatch theo `(type, code)` |
