# RS485 Sensor Reader Widget

## Giao dien hien tai

- Da tach thanh 2 widget:
  - `RS485 Sensor Reader` (Control): gui lenh, polling, cau hinh sensor.
  - `RS485 Monitor`: hien thi AIN0..AIN3 + log telemetry.
- `Sensor Settings` va `Advanced MODBUS` duoc dong gon mac dinh de tranh roi mat.
- Hau het thao tac thong thuong dung `select` va `button`; phan nhap tay chi con o khu debug nang cao.

## Cach dung nhanh

1. Tao 1 widget `Control` va dan 3 file:
	- `rs485_sensor_reader_widget.html`
	- `rs485_sensor_reader_widget.css`
	- `rs485_sensor_reader_widget.js`
2. Tao 1 widget `Monitor` (Latest Values) va dan 3 file:
	- `rs485_monitor_widget.html`
	- `rs485_monitor_widget.css`
	- `rs485_monitor_widget.js`
3. O widget Monitor, datasource phai map key telemetry `data` cua gateway device.
4. O widget Control, gan target device dung gateway can gui RPC.
5. Tai Control: chon `RS485 Slot`, `Gateway Baud`, `Slave` -> bam `Prepare Gateway` -> bam `Refresh All`.
6. Gia tri AIN0..AIN3 se hien thi o Monitor widget.
7. Control widget nhan `last data value` tu Monitor qua `CustomEvent` + `localStorage` de xu ly frame response.

## Luu y

- Widget da bind su kien bang JavaScript thay vi phu thuoc vao `onclick` inline.
- Truoc moi lenh gui, widget se doc lai gia tri tu UI va co gang resolve lai target device/telemetry neu can.
- Gateway ACK di qua RPC response, con frame MODBUS that di qua telemetry key `data`.
- Neu `telemetryWsService.subscribe` tren Control bi loi schema, Control van co the nhan frame qua bridge tu Monitor.
- Polling khong tu chay khi mo lai widget.