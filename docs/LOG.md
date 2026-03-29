I (16497) WAN_DL: Sending DQ command (attempt 1/10)
I (16497) WAN_COMM_MASTER: Frame added to DMA buffer: 4 bytes (4/8192 used, 1 frames)
I (16497) WAN_COMM_MASTER: Flushing DMA buffer: 4 bytes, 1 frames
I (16507) WAN_COMM_MASTER: 0x3fcec52c   43 46 44 51                                       |CFDQ|
I (16517) WAN_COMM_MASTER: Added 1020 bytes padding for DMA alignment
I (16517) WAN_COMM_MASTER: DMA buffer flushed successfully (flush #17)
I (16527) WAN_COMM_MASTER: SPI TX: CF 4 bytes (total=17)
I (16557) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
I (16577) WAN_COMM_MASTER: SPI RX: DQ 8192 bytes (xfer=8192)
I (16577) WAN_DL: Invalid response [0]=0x52 [1]=0x54, retry 1/10
I (16577) WAN_DL: Sending DQ command (attempt 2/10)
I (16587) WAN_COMM_MASTER: Frame added to DMA buffer: 4 bytes (4/8192 used, 1 frames)
I (16587) WAN_COMM_MASTER: Flushing DMA buffer: 4 bytes, 1 frames
I (16597) WAN_COMM_MASTER: 0x3fcec52c   43 46 44 51                                       |CFDQ|
I (16607) WAN_COMM_MASTER: Added 1020 bytes padding for DMA alignment
I (16617) WAN_COMM_MASTER: DMA buffer flushed successfully (flush #18)
I (16617) WAN_COMM_MASTER: SPI TX: CF 4 bytes (total=18)
I (16677) WAN_COMM_MASTER: SPI RX: DQ 8192 bytes (xfer=8192)
I (16677) WAN_DL: === CONFIG PACKET RECEIVED ===
I (16677) WAN_DL:   Header : [0x43 0x46] = 'CF'
I (16677) WAN_DL:   config_len field (rx[2..3]): 0x10 0x2B = 4139 bytes
I (16687) WAN_DL:   is_fota : 0
I (16687) WAN_DL:   buffer_size available: 8192 bytes
I (16697) config_handler: Config callback: queued config command, type=6, len=4139, is_fota=0
I (16697) config_handler: Received config command, type: 6, len: 4139I (16707) WAN_DL: DQ success in 210ms (total=2)

I (16717) WAN_DL: SPI bus released
I (16717) ble_commands: Stack ID: 0, JSON length: 4127 bytes
I (16717) WAN_COMM_MASTER: Frame added to DMA buffer: 4 bytes (4/8192 used, 1 frames)
I (16727) MODULE_MONITOR: Config enqueued for Stack 0 (4127 bytes)
I (16727) WAN_COMM_MASTER: I (16737) ble_commands: I (16727) MODULE_MONITOR: BLE JSON config forwarded to module_monitor_task
Flushing DMA buffer: 4 bytes, 1 frames
I (16747) config_handler: BLE JSON config loaded from WAN MCU
I (16747) WAN_COMM_MASTER: Received config for Stack 0 (4127 bytes)0x3fcec52c   43 46 52 54                                       |CFRT|

I (16767) WAN_COMM_MASTER: Added 1020 bytes padding for DMA alignment
I (16777) WAN_COMM_MASTER: DMA buffer flushed successfully (flush #19)
I (16777) WAN_COMM_MASTER: SPI TX: CF 4 bytes (total=19)
I (16787) config_global: Stack 1 JSON config saved (4127 bytes)
I (16787) WAN_COMM_MASTER: I (16787) MODULE_MONITOR: Config parsed for Stack 0: type=1
DMA buffer empty, nothing to flush
I (16817) CONFIG_NVS: Module JSON saved to NVS for Stack 0 (4127 bytes)
I (16817) MODULE_MONITOR: Starting BLE handler for Stack 0
I (16817) BLE_HANDLER: BLE handler initializing...
I (16817) BLE_HANDLER: BLE handler initialized successfully
I (16827) BLE_TASK: [Stack 0] BLE uplink task started
I (16827) BLE_TASK: [Stack 0] BLE downlink task started
I (16837) BLE_TASK: [Stack 0] BLE listener task started
I (16837) BLE_TASK: [Stack 0] BLE handler tasks started
I (16847) BLE_TASK: [Stack 0] Loading JSON config (4127 bytes)
I (16847) BLE_HANDLER: Loading BLE config for stack 0 (4127 bytes)
I (16857) JSON_PARSER: Parsing JSON metadata: length=4127
I (16857) JSON_PARSER: JSON start: {"module_id":"002","module_type":"BLE","module_name":"STM32WB_BLE_Gateway","module_communication":{"
I (16867) JSON_PARSER: JSON end: ...rol":[],"delay_start":0,"expect_response":"OK","timeout":1000,"gpio_end_control":[],"delay_end":0}]}
I (16887) JSON_PARSER: Port type: uart
I (16887) JSON_PARSER: UART: baudrate=115200, parity=0, stopbit=1
I (16897) JSON_PARSER: Metadata parsed: id=002, type=BLE, name=STM32WB_BLE_Gateway
I (16907) WAN_COMM_MASTER: SPI RX: DQ 32 bytes (xfer=1024)
I (16907) WAN_UL: RTC: 03/03/2026-21:01:57, Internet: OFFLINE
I (16907) BLE_PARSER: Parsed function: MODULE_HW_RESET (ID=0)
I (16907) WAN_UL: RTC and Internet status updated
I (16917) BLE_PARSER: Parsed function: MODULE_SW_RESET (ID=1)
I (16927) BLE_PARSER: Parsed function: MODULE_FACTORY_RESET (ID=2)
I (16937) BLE_PARSER: Parsed function: MODULE_ENTER_CMD_MODE (ID=7)
I (16937) BLE_PARSER: Parsed function: MODULE_ENTER_SLEEP (ID=13)
I (16947) BLE_PARSER: Parsed function: MODULE_WAKEUP (ID=14)
I (16947) BLE_PARSER: Parsed function: MODULE_START_BROADCAST (ID=9)
I (16957) BLE_PARSER: Parsed function: MODULE_GET_INFO (ID=3)
I (16957) BLE_PARSER: Parsed function: MODULE_GET_CONNECTION_STATUS (ID=12)
I (16967) BLE_PARSER: Parsed function: MODULE_GET_DIAGNOSTICS (ID=17)
I (16977) BLE_PARSER: Parsed function: MODULE_SET_NAME (ID=4)
I (16977) BLE_PARSER: Parsed function: MODULE_SET_COMM_CONFIG (ID=5)
I (16987) BLE_PARSER: Parsed function: MODULE_SET_RF_PARAMS (ID=6)
I (16987) BLE_PARSER: Parsed function: MODULE_START_DISCOVERY (ID=15)
I (16997) BLE_PARSER: Parsed function: MODULE_DISCOVER_SERVICES (ID=18)
I (17007) BLE_PARSER: Parsed function: MODULE_DISCOVER_CHARACTERISTICS (ID=19)
I (17007) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
I (17007) BLE_PARSER: Parsed function: MODULE_CONNECT (ID=10)
I (17017) BLE_PARSER: Parsed function: MODULE_DISCONNECT (ID=11)
I (17027) BLE_PARSER: Parsed function: MODULE_ENTER_DATA_MODE (ID=8)
I (17037) BLE_PARSER: Parsed function: MODULE_SEND_DATA (ID=16)
I (17037) BLE_PARSER: BLE config parsed successfully: 20 functions
I (17047) MOD_CTRL: Module config controller initialized
I (17047) MOD_CTRL: Initializing UART for stack 0
I (17057) MODULE_UART: Initializing UART for Stack0: port=2, TX=17, RX=18
I (17057) uart: queue free spaces: 10
I (17067) MODULE_UART: UART2 initialized for Stack0: TX=17, RX=18, baud=115200
I (17067) MOD_CTRL: UART initialized for stack 0: baudrate=115200, parity=0
I (17077) BLE_HANDLER: BLE config loaded for stack 0
I (17087) BLE_TASK: [Stack 0] Configuration loaded successfully
I (17087) MOD_CTRL: GPIO write: stack=0, pin=01, state=0
I (17197) BLE_HANDLER: GPIO-only function 0 - no command/response expected
I (17197) MOD_CTRL: GPIO write: stack=0, pin=01, state=1
I (17507) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
I (17687) WAN_COMM_MASTER: Frame added to DMA buffer: 4 bytes (4/8192 used, 1 frames)
I (17687) WAN_COMM_MASTER: Flushing DMA buffer: 4 bytes, 1 frames
I (17687) WAN_COMM_MASTER: 0x3fcec52c   43 46 52 54                                       |CFRT|
I (17697) WAN_COMM_MASTER: Added 1020 bytes padding for DMA alignment
I (17707) WAN_COMM_MASTER: DMA buffer flushed successfully (flush #20)
I (17707) WAN_COMM_MASTER: SPI TX: CF 4 bytes (total=20)
I (17717) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
I (17817) WAN_COMM_MASTER: SPI RX: DQ 32 bytes (xfer=1024)
I (17817) WAN_UL: RTC: 03/03/2026-21:01:57, Internet: ONLINE
I (17817) WAN_UL: RTC and Internet status updated
I (18007) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
I (18197) BLE_HANDLER: GPIO-only function 0 completed on stack 0 (took 1110 ms)
I (18197) BLE_HANDLER: Hardware reset executed on stack 0
I (18507) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
I (18527) BLE_HANDLER: Function 7 executed successfully on stack 0 (took 230 ms)
I (18527) BLE_HANDLER: Entered CMD mode on stack 0
I (18527) MODULE_MONITOR: Handler started and BLE config loaded for Stack 0
I (18527) WAN_UL: Uplink queued from handler BLE: 12 bytes
I (18537) WAN_UL: Processing uplink from handler BLE: 12 bytes
I (18537) WAN_UL: Transmit attempt 1/3
I (18547) WAN_COMM_MASTER: Frame added to DMA buffer: 38 bytes (38/8192 used, 1 frames)
I (18557) WAN_COMM_MASTER: Flushing DMA buffer: 38 bytes, 1 frames
I (18557) WAN_COMM_MASTER: 0x3fcec52c   44 54 42 4c 45 00 1f 30  33 2f 30 33 2f 32 30 32  |DTBLE..03/03/202|
I (18567) WAN_COMM_MASTER: 0x3fcec53c   36 2d 32 31 3a 30 31 3a  35 37 43 46 42 4c 3a 4a  |6-21:01:57CFBL:J|
I (18577) WAN_COMM_MASTER: 0x3fcec54c   53 4f 4e 3a 4f 4b                                 |SON:OK|
I (18587) WAN_COMM_MASTER: Added 986 bytes padding for DMA alignment
I (18597) WAN_COMM_MASTER: DMA buffer flushed successfully (flush #21)
I (18597) WAN_COMM_MASTER: SPI TX: DT 38 bytes (total=21)
I (18607) WAN_COMM_MASTER: SPI RX: DQ 8 bytes (xfer=1024)
I (18607) WAN_COMM_MASTER: SPI RX: DQ 8 bytes (xfer=1024)
I (18617) WAN_COMM_MASTER: SPI RX: DQ 8 bytes (xfer=1024)
I (18617) WAN_COMM_MASTER: SPI RX: DQ 8 bytes (xfer=1024)
I (18627) WAN_COMM_MASTER: SPI RX: DQ 8 bytes (xfer=1024)
I (18627) WAN_COMM_MASTER: SPI RX: DQ 8 bytes (xfer=1024)
I (18637) WAN_COMM_MASTER: SPI RX: DQ 8 bytes (xfer=1024)
I (18637) WAN_COMM_MASTER: SPI RX: DQ 8 bytes (xfer=1024)
I (18647) WAN_COMM_MASTER: SPI RX: DQ 8 bytes (xfer=1024)
I (18647) WAN_UL: ACK received: NO_INTERNET
I (18687) WAN_COMM_MASTER: Frame added to DMA buffer: 4 bytes (4/8192 used, 1 frames)
I (18687) WAN_COMM_MASTER: Flushing DMA buffer: 4 bytes, 1 frames
I (18687) WAN_COMM_MASTER: 0x3fcec52c   43 46 52 54                                       |CFRT|
I (18697) WAN_COMM_MASTER: Added 1020 bytes padding for DMA alignment
I (18707) WAN_COMM_MASTER: DMA buffer flushed successfully (flush #22)
I (18707) WAN_COMM_MASTER: SPI TX: CF 4 bytes (total=22)
I (18717) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
I (18817) WAN_COMM_MASTER: SPI RX: DQ 32 bytes (xfer=1024)
I (18817) WAN_UL: RTC: 03/03/2026-21:01:58, Internet: ONLINE
I (18817) WAN_UL: RTC and Internet status updated
I (19007) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
I (19507) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
I (19687) WAN_COMM_MASTER: Frame added to DMA buffer: 4 bytes (4/8192 used, 1 frames)
I (19687) WAN_COMM_MASTER: Flushing DMA buffer: 4 bytes, 1 frames
I (19687) WAN_COMM_MASTER: 0x3fcec52c   43 46 52 54                                       |CFRT|
I (19697) WAN_COMM_MASTER: Added 1020 bytes padding for DMA alignment
I (19707) WAN_COMM_MASTER: DMA buffer flushed successfully (flush #23)
I (19707) WAN_COMM_MASTER: SPI TX: CF 4 bytes (total=23)
I (19717) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
I (19817) WAN_COMM_MASTER: SPI RX: DQ 32 bytes (xfer=1024)
I (19817) WAN_UL: RTC: 03/03/2026-21:01:59, Internet: ONLINE
I (19817) WAN_UL: RTC and Internet status updated
I (20007) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
I (20507) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
I (20687) WAN_COMM_MASTER: Frame added to DMA buffer: 4 bytes (4/8192 used, 1 frames)
I (20687) WAN_COMM_MASTER: Flushing DMA buffer: 4 bytes, 1 frames
I (20687) WAN_COMM_MASTER: 0x3fcec52c   43 46 52 54                                       |CFRT|
I (20697) WAN_COMM_MASTER: Added 1020 bytes padding for DMA alignment
I (20707) WAN_COMM_MASTER: DMA buffer flushed successfully (flush #24)
I (20707) WAN_COMM_MASTER: SPI TX: CF 4 bytes (total=24)
I (20717) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
I (20817) WAN_COMM_MASTER: SPI RX: DQ 32 bytes (xfer=1024)
I (20817) WAN_UL: RTC: 03/03/2026-21:02:00, Internet: ONLINE
I (20817) WAN_UL: RTC and Internet status updated
I (21007) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
I (21507) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
I (21687) WAN_COMM_MASTER: Frame added to DMA buffer: 4 bytes (4/8192 used, 1 frames)
I (21687) WAN_COMM_MASTER: Flushing DMA buffer: 4 bytes, 1 frames
I (21687) WAN_COMM_MASTER: 0x3fcec52c   43 46 52 54                                       |CFRT|
I (21697) WAN_COMM_MASTER: Added 1020 bytes padding for DMA alignment
I (21707) WAN_COMM_MASTER: DMA buffer flushed successfully (flush #25)
I (21707) WAN_COMM_MASTER: SPI TX: CF 4 bytes (total=25)
I (21717) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
I (21817) WAN_COMM_MASTER: SPI RX: DQ 32 bytes (xfer=1024)
I (21817) WAN_UL: RTC: 03/03/2026-21:02:01, Internet: ONLINE
I (21817) WAN_UL: RTC and Internet status updated
I (22007) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
I (22507) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
I (22687) WAN_COMM_MASTER: Frame added to DMA buffer: 4 bytes (4/8192 used, 1 frames)
I (22687) WAN_COMM_MASTER: Flushing DMA buffer: 4 bytes, 1 frames
I (22687) WAN_COMM_MASTER: 0x3fcec52c   43 46 52 54                                       |CFRT|
I (22697) WAN_COMM_MASTER: Added 1020 bytes padding for DMA alignment
I (22707) WAN_COMM_MASTER: DMA buffer flushed successfully (flush #26)
I (22707) WAN_COMM_MASTER: SPI TX: CF 4 bytes (total=26)
I (22717) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
I (22817) WAN_COMM_MASTER: SPI RX: DQ 32 bytes (xfer=1024)
I (22817) WAN_UL: RTC: 03/03/2026-21:02:02, Internet: ONLINE
I (22817) WAN_UL: RTC and Internet status updated
I (23007) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
I (23507) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
I (23687) WAN_COMM_MASTER: Frame added to DMA buffer: 4 bytes (4/8192 used, 1 frames)
I (23687) WAN_COMM_MASTER: Flushing DMA buffer: 4 bytes, 1 frames
I (23687) WAN_COMM_MASTER: 0x3fcec52c   43 46 52 54                                       |CFRT|
I (23697) WAN_COMM_MASTER: Added 1020 bytes padding for DMA alignment
I (23707) WAN_COMM_MASTER: DMA buffer flushed successfully (flush #27)
I (23707) WAN_COMM_MASTER: SPI TX: CF 4 bytes (total=27)
I (23717) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
I (23817) WAN_COMM_MASTER: SPI RX: DQ 32 bytes (xfer=1024)
I (23817) WAN_UL: RTC: 03/03/2026-21:02:03, Internet: ONLINE
I (23817) WAN_UL: RTC and Internet status updated
I (24007) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
I (24507) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
I (24687) WAN_COMM_MASTER: Frame added to DMA buffer: 4 bytes (4/8192 used, 1 frames)
I (24687) WAN_COMM_MASTER: Flushing DMA buffer: 4 bytes, 1 frames
I (24687) WAN_COMM_MASTER: 0x3fcec52c   43 46 52 54                                       |CFRT|
I (24697) WAN_COMM_MASTER: Added 1020 bytes padding for DMA alignment
I (24707) WAN_COMM_MASTER: DMA buffer flushed successfully (flush #28)
I (24707) WAN_COMM_MASTER: SPI TX: CF 4 bytes (total=28)
I (24717) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
I (24817) WAN_COMM_MASTER: SPI RX: DQ 32 bytes (xfer=1024)
I (24817) WAN_UL: RTC: 03/03/2026-21:02:04, Internet: ONLINE
I (24817) WAN_UL: RTC and Internet status updated
I (25007) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
I (25507) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
I (25687) WAN_COMM_MASTER: Frame added to DMA buffer: 4 bytes (4/8192 used, 1 frames)
I (25687) WAN_COMM_MASTER: Flushing DMA buffer: 4 bytes, 1 frames
I (25687) WAN_COMM_MASTER: 0x3fcec52c   43 46 52 54                                       |CFRT|
I (25697) WAN_COMM_MASTER: Added 1020 bytes padding for DMA alignment
I (25707) WAN_COMM_MASTER: DMA buffer flushed successfully (flush #29)
I (25707) WAN_COMM_MASTER: SPI TX: CF 4 bytes (total=29)
I (25717) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
I (25817) WAN_COMM_MASTER: SPI RX: DQ 32 bytes (xfer=1024)
I (25817) WAN_UL: RTC: 03/03/2026-21:02:05, Internet: ONLINE
I (25817) WAN_UL: RTC and Internet status updated
I (26007) WAN_COMM_MASTER: DMA buffer empty, nothing to flush
��I (25) boot: ESP-IDF v6.0-beta1-1452-g48e7e0618d-dir 2nd stage bootloader
I (25) boot: compile time Feb 11 2026 14:19:51
I (25) boot: Multicore bootloader
I (27) boot: chip revision: v0.2
I (30) boot: efuse block revision: v1.3
I (34) boot.esp32s3: Boot SPI Speed : 80MHz
I (37) boot.esp32s3: SPI Mode       : DIO
I (41) boot.esp32s3: SPI Flash Size : 16MB
I (45) boot: Enabling RNG early entropy source...
I (50) boot: Partition Table:
I (52) boot: ## Label            Usage          Type ST Offset   Length
I (58) boot:  0 nvs              WiFi data        01 02 00009000 00100000
I (65) boot:  1 otadata          OTA data         01 00 00109000 00002000
I (72) boot:  2 phy_init         RF data          01 01 0010b000 00001000
I (78) boot:  3 ota_0            OTA app          00 10 00110000 00700000
I (85) boot:  4 ota_1            OTA app          00 11 00810000 00700000
I (91) boot: End of partition table
I (94) esp_image: segment 0: paddr=00110020 vaddr=3c0a0020 size=3c858h (247896) map
I (146) esp_image: segment 1: paddr=0014c880 vaddr=3fc97000 size=03418h ( 13336) load
I (149) esp_image: segment 2: paddr=0014fca0 vaddr=40374000 size=00378h (   888) load
I (150) esp_image: segment 3: paddr=00150020 vaddr=42000020 size=90798h (591768) map
I (264) esp_image: segment 4: paddr=001e07c0 vaddr=40374378 size=12c48h ( 76872) load
I (281) esp_image: segment 5: paddr=001f3410 vaddr=50000000 size=00024h (    36) load
I (289) boot: Loaded app from partition at offset 0x110000
I (289) boot: Disabling RNG early entropy source...
I (299) octal_psram: vendor id    : 0x0d (AP)
I (300) octal_psram: dev id       : 0x02 (generation 3)
I (300) octal_psram: density      : 0x03 (64 Mbit)
I (302) octal_psram: good-die     : 0x01 (Pass)
I (306) octal_psram: Latency      : 0x01 (Fixed)
I (310) octal_psram: VCC          : 0x01 (3V)
I (314) octal_psram: SRF          : 0x01 (Fast Refresh)
I (319) octal_psram: BurstType    : 0x01 (Hybrid Wrap)
I (324) octal_psram: BurstLen     : 0x01 (32 Byte)
I (329) octal_psram: Readlatency  : 0x02 (10 cycles@Fixed)
I (334) octal_psram: DriveStrength: 0x00 (1/1)
I (338) esp_psram: Found 8MB PSRAM device
I (342) esp_psram: Speed: 40MHz
I (345) cpu_start: Multicore app
I (1079) esp_psram: SPI SRAM memory test OK
I (1087) cpu_start: GPIO 16 and 15 are used as console UART I/O pins
I (1088) cpu_start: Pro cpu start user code
I (1088) cpu_start: cpu freq: 240000000 Hz
I (1090) app_init: Application information:
I (1094) app_init: Project name:     DA2_esp_LAN
I (1098) app_init: App version:      7d99a68-dirty
I (1103) app_init: Compile time:     Mar 22 2026 22:49:32
I (1108) app_init: ELF file SHA256:  7efa70ebc...
I (1112) app_init: ESP-IDF:          v6.0-beta1-1452-g48e7e0618d-dir
I (1118) efuse_init: Min chip rev:     v0.0
I (1122) efuse_init: Max chip rev:     v0.99 
I (1126) efuse_init: Chip rev:         v0.2
I (1130) heap_init: Initializing. RAM available for dynamic allocation:
I (1137) heap_init: At 3FCA6A98 len 00042C78 (267 KiB): RAM
I (1142) heap_init: At 3FCE9710 len 00005724 (21 KiB): RAM
I (1147) heap_init: At 3FCF0000 len 00008000 (32 KiB): DRAM
I (1152) heap_init: At 600FE000 len 00001FE8 (7 KiB): RTCRAM
I (1158) esp_psram: Adding pool of 8185K of PSRAM memory to heap allocator
I (1165) spi_flash: detected chip: winbond
I (1168) spi_flash: flash io: dio
I (1172) sleep_gpio: Configure to isolate all GPIO pins in sleep state
I (1178) sleep_gpio: Enable automatic switching of GPIO sleep configuration
I (1184) coexist: coex firmware version: 093e3d2
I (1189) coexist: coexist rom version e7ae62f
I (1193) main_task: Started on CPU0
I (1203) esp_psram: Reserving pool of 32K of internal memory for DMA/internal allocations
I (1203) main_task: Calling app_main()
I (1203) MAIN APP: LAN MCU Application Starting... V1.0.1
I (1423) I2C_SUPPORT: Initializing I2C Master on port 0 (SDA=2, SCL=1)
I (1423) I2C_SUPPORT: I2C Master initialized successfully
I (1423) TCA6424A: Initializing TCA6424A at address 0x22
I (1433) I2C_SUPPORT: Device 0x22 added successfully
I (1433) TCA6424A: Performing hardware reset
I (1643) TCA6424A: TCA6424A responding OK - Config0: 0xFF
I (1643) TCA6424A: TCA6424A initialized successfully (INT=21, RESET=47)
I (1643) STACK_HANDLER: Initializing stack handler
I (1643) TCA6424A: TCA6424A responding OK - Config0: 0xFF
I (1653) STACK_HANDLER: Stack handler initialized
I (1653) STACK_HANDLER:   Stack 1 (LAN1): GPIO1-9=P21-P25,P13-P16 | WAKE#=P17 | PERST#=P20
I (1663) STACK_HANDLER:   Stack 2 (LAN2): GPIO1-9=P06,P07,P10-P12,P00-P03 | WAKE#=P04 | PERST#=P05
I (1673) MAIN APP: Stack handler initialized
I (1673) CONFIG_NVS: Initializing LAN MCU configuration system (Module Base Setting trial)...
I (1683) CONFIG_NVS: Loading existing configuration
I (1683) CONFIG_NVS: Loading configurations from NVS...
I (1693) CONFIG_NVS: Loading RS485 baud rate from NVS...
I (1693) CONFIG_NVS: RS485 baud rate loaded: 9600
I (1703) CONFIG_NVS: Loading global config from NVS...
I (1703) config_global: Stack 1 ID set to: 002
I (1713) config_global: Stack 2 ID set to: 000
I (1713) CONFIG_NVS: Global config loaded: stack1_id=002, stack2_id=000
I (1723) CONFIG_NVS: Configuration loading complete
I (1723) WAN_UL: Config callback registered
I (1733) config_handler: Config LAN handler task started
I (1733) config_handler: Config LAN handler task created
I (1743) MAIN APP: Config handler started
I (1743) STACK_HANDLER: Stack 0 module ID: 002 (BLE STM32WB)
I (1753) STACK_HANDLER: Stack 1 module ID: 000 (No module)
I (1753) CONFIG_NVS: Loading global config from NVS...
I (1763) config_global: Stack 1 ID set to: 002
I (1763) config_global: Stack 2 ID set to: 000
I (1763) CONFIG_NVS: Global config loaded: stack1_id=002, stack2_id=000
I (1773) MODULE_MONITOR: Stack 0 module unchanged: '002'
I (1783) MODULE_MONITOR: Stack 1 module unchanged: '000'
I (1783) config_global: Stack 1 ID set to: 002
I (1783) config_global: Stack 2 ID set to: 000
I (1793) CONFIG_NVS: Saving global config to NVS...
I (1793) CONFIG_NVS: Global config saved: stack1_id=002, stack2_id=000
I (1803) MODULE_MONITOR: Module IDs: Stack_1=002, Stack_2=000
I (1813) CONFIG_NVS: Module JSON loaded from NVS for Stack 0 (4127 bytes)
I (1813) MODULE_MONITOR: Loaded saved config for Stack 0 from NVS
I (1823) config_global: Stack 1 JSON config saved (4127 bytes)
I (1823) MODULE_MONITOR: Config parsed for Stack 0: type=1
I (1833) MODULE_MONITOR: Starting BLE handler for Stack 0
I (1833) BLE_HANDLER: BLE handler initializing...
I (1843) BLE_HANDLER: BLE handler initialized successfully
I (1843) BLE_TASK: [Stack 0] BLE uplink task started
I (1853) BLE_TASK: [Stack 0] BLE downlink task started
I (1853) BLE_TASK: [Stack 0] BLE listener task started
I (1863) BLE_TASK: [Stack 0] BLE handler tasks started
I (1863) MODULE_MONITOR: Handler auto-started for Stack 0 (NVS restore)
I (1873) BLE_TASK: [Stack 0] Loading JSON config (4127 bytes)
I (1873) BLE_HANDLER: Loading BLE config for stack 0 (4127 bytes)
I (1883) JSON_PARSER: Parsing JSON metadata: length=4127
I (1883) JSON_PARSER: JSON start: {"module_id":"002","module_type":"BLE","module_name":"STM32WB_BLE_Gateway","module_communication":{"
I (1903) JSON_PARSER: JSON end: ...rol":[],"delay_start":0,"expect_response":"OK","timeout":1000,"gpio_end_control":[],"delay_end":0}]}
I (1913) JSON_PARSER: Port type: uart
I (1913) JSON_PARSER: UART: baudrate=115200, parity=0, stopbit=1
I (1923) JSON_PARSER: Metadata parsed: id=002, type=BLE, name=STM32WB_BLE_Gateway
I (1933) BLE_PARSER: Parsed function: MODULE_HW_RESET (ID=0)
I (1933) BLE_PARSER: Parsed function: MODULE_SW_RESET (ID=1)
I (1943) BLE_PARSER: Parsed function: MODULE_FACTORY_RESET (ID=2)
I (1943) BLE_PARSER: Parsed function: MODULE_ENTER_CMD_MODE (ID=7)
I (1953) BLE_PARSER: Parsed function: MODULE_ENTER_SLEEP (ID=13)
I (1953) BLE_PARSER: Parsed function: MODULE_WAKEUP (ID=14)
I (1963) BLE_PARSER: Parsed function: MODULE_START_BROADCAST (ID=9)
I (1963) BLE_PARSER: Parsed function: MODULE_GET_INFO (ID=3)
I (1973) BLE_PARSER: Parsed function: MODULE_GET_CONNECTION_STATUS (ID=12)
I (1983) BLE_PARSER: Parsed function: MODULE_GET_DIAGNOSTICS (ID=17)
I (1983) BLE_PARSER: Parsed function: MODULE_SET_NAME (ID=4)
I (1993) BLE_PARSER: Parsed function: MODULE_SET_COMM_CONFIG (ID=5)
I (1993) BLE_PARSER: Parsed function: MODULE_SET_RF_PARAMS (ID=6)
I (2003) BLE_PARSER: Parsed function: MODULE_START_DISCOVERY (ID=15)
I (2013) BLE_PARSER: Parsed function: MODULE_DISCOVER_SERVICES (ID=18)
I (2013) BLE_PARSER: Parsed function: MODULE_DISCOVER_CHARACTERISTICS (ID=19)
I (2023) BLE_PARSER: Parsed function: MODULE_CONNECT (ID=10)
I (2023) BLE_PARSER: Parsed function: MODULE_DISCONNECT (ID=11)
I (2033) BLE_PARSER: Parsed function: MODULE_ENTER_DATA_MODE (ID=8)
I (2043) BLE_PARSER: Parsed function: MODULE_SEND_DATA (ID=16)
I (2043) BLE_PARSER: BLE config parsed successfully: 20 functions
I (2053) MOD_CTRL: Module config controller initialized
I (2053) MOD_CTRL: Initializing UART for stack 0
E (2063) MOD_CTRL: UART not initialized for stack 0
I (2063) MODULE_UART: Initializing UART for Stack0: port=2, TX=17, RX=18
I (2073) uart: queue free spaces: 10
I (2073) MODULE_UART: UART2 initialized for Stack0: TX=17, RX=18, baud=115200
E (2083) MOD_CTRL: UART not initialized for stack 0
I (2083) MOD_CTRL: UART initialized for stack 0: baudrate=115200, parity=0
I (2093) BLE_HANDLER: BLE config loaded for stack 0
I (2093) BLE_TASK: [Stack 0] Configuration loaded successfully
I (2103) MOD_CTRL: GPIO write: stack=0, pin=01, state=0
I (2213) BLE_HANDLER: GPIO-only function 0 - no command/response expected
I (2213) MOD_CTRL: GPIO write: stack=0, pin=01, state=1
I (3213) BLE_HANDLER: GPIO-only function 0 completed on stack 0 (took 1110 ms)
I (3213) BLE_HANDLER: Hardware reset executed on stack 0
I (3543) BLE_HANDLER: Function 7 executed successfully on stack 0 (took 230 ms)
I (3543) BLE_HANDLER: Entered CMD mode on stack 0
I (3543) MODULE_MONITOR: BLE handler config loaded after NVS restore (Stack 0)
I (3543) MODULE_MONITOR: Monitor task running
I (3553) MODULE_MONITOR: Module monitor task started
I (3553) MAIN APP: Module Monitor Task started (Module Base Setting enabled)
I (3563) WAN_UL: Starting MCU WAN Handler (SPI Split Architecture)
I (3563) WAN_COMM_MASTER: ============================================
I (3573) WAN_COMM_MASTER: SPI Master Initialization (LAN MCU)
I (3583) WAN_COMM_MASTER: ============================================
W (3583) WAN_COMM_MASTER: Clock speed 10000000 Hz differs from default (40 MHz)
I (3593) WAN_COMM_MASTER: Buffer Configuration:
I (3593) WAN_COMM_MASTER:   DMA TX: 8192 bytes (fixed, buffered)
I (3603) WAN_COMM_MASTER:   RX: 16384 -> 16384 bytes aligned, 5 DMA descriptors
I (3613) WAN_COMM_MASTER:   Fixed transfer length: 1024 bytes
I (3613) WAN_COMM_MASTER: DMA Buffers Allocated:
I (3623) WAN_COMM_MASTER:   TX: static buffer (4KB, accumulation)
I (3623) WAN_COMM_MASTER:   RX: 0x3fcc8d6c (4-byte aligned)
I (3633) WAN_COMM_MASTER: SPI Master Configuration:
I (3633) WAN_COMM_MASTER:   Host: SPI2, Mode: 0, Queue Size: 7
I (3643) WAN_COMM_MASTER:   GPIO: CLK=12, CS=10, IO0=11, IO1=13
I (3643) WAN_COMM_MASTER:   Clock: 10000000 Hz (10.0 MHz)
I (3653) WAN_COMM_MASTER: ============================================
I (3653) WAN_COMM_MASTER: SPI Master Ready - Driving 40 MHz Clock
I (3663) WAN_COMM_MASTER: ============================================
I (3673) WAN_COMM_MASTER: Theoretical Throughput: 10 Mbps (1.2 MB/s)
I (3673) WAN_COMM_MASTER: Expected Practical: depends on payload and timing
I (3683) WAN_COMM_MASTER: Timing: ACK=200ms, DQ retry=50ms×10
E (3683) gpio: gpio_install_isr_service(533): GPIO isr service already installed
I (3693) WAN_COMM_MASTER: GPIO46 ISR configured (rising edge, <5ms response)
I (3703) WAN_COMM_MASTER: Data-Ready ISR:
I (3703) WAN_COMM_MASTER:   Pin: GPIO46, Trigger: Rising Edge, Latency: <5ms
I (3713) SDCard_COMM: Initializing SD card via SDMMC
I (3713) SDCard_COMM: GPIO pins: CLK=7 CMD=6 D0=8 D1=3 D2=4 D3=5
W (4803) SD_HOST: input line delay not supported, fallback to 0 delay
Name: SF064
Type: SDHC
Speed: 20.00 MHz (limit: 20.00 MHz)
Size: 59024MB
CSD: ver=2, sector_size=512, capacity=120881152 read_bl_len=9
SSR: bus_width=1
I (4813) SDCard_COMM: No existing files found
I (4823) SDCard_COMM: SD card initialized successfully. Files in queue: 0
I (4823) SDCard_COMM: Testing write capability...
I (4873) SDCard_COMM: ✓ Write test PASSED
I (4883) STORAGE: Storage handler initialized: 5KB batch buffer with 500ms flush timer
I (4883) STORAGE: Buffer allocated from: PSRAM
I (4883) WAN_DL: ============================================
I (4893) WAN_DL: Starting Downlink Poll Task (Priority 7)
I (4893) WAN_DL: ============================================
I (4903) WAN_COMM_MASTER: Data-ready callback registered
I (4903) WAN_DL: Downlink Poll Task started (Priority 7)
I (4913) WAN_DL: Downlink task started - waiting for GPIO ISR
I (4913) WAN_UL: ============================================
I (4923) WAN_UL: Starting Uplink Handler Task (Priority 5)
I (4923) WAN_UL: ============================================
E (4933) WAN_UL: Failed to create uplink queue
E (4933) WAN_UL: Failed to start uplink task
I (4943) WAN_DL: Downlink task stopped
I (4943) WAN_DL: Statistics: ISR=0, DQ_OK=0, DQ_FAIL=0
I (4953) WAN_COMM_MASTER: Deinitializing SPI master
I (4953) WAN_COMM_MASTER: GPIO46 ISR handler removed
I (4963) WAN_COMM_MASTER: Final Statistics:
I (4963) WAN_COMM_MASTER:   Packets TX: 0, DMA Flushes: 0, Errors: 0
I (4973) WAN_COMM_MASTER: SPI master deinitialized
I (4973) MAIN APP: MCU WAN handler started (stuct here)