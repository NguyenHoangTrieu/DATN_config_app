# Module Base Setting - Build & Deploy Guide

## Overview

Module Base Setting là kiến trúc mới cho phép Gateway tự động detect và configure module (BLE/Zigbee/LoRa) mà không cần hardcode module type trong firmware.

## Architecture Components

### 1. **LAN MCU (DA2_esp_LAN)**
- **Module Monitor Task**: Core component quản lý lifecycle của module handlers
- **Stack Handler**: Detect module ID qua I2C
- **Config Handler**: Parse JSON config từ WAN MCU
- **BLE Handler Task**: BLE module communication (implemented)
- **Zigbee Handler Task**: Zigbee module (stub - future)
- **LoRa Handler Task**: LoRa module (stub - future)

### 2. **WAN MCU (DA2_esp)**
- **MCU LAN Handler**: Communication với LAN MCU
- **Config Handler**: Forward JSON config từ server/PC app
- **Server Communication**: MQTT/HTTP connection

## Build Instructions

### Prerequisites
```bash
# ESP-IDF v5.x
. ~/esp/esp-idf/export.sh  # Linux/Mac
# OR
%userprofile%\esp\esp-idf\export.bat  # Windows

# Verify ESP-IDF
idf.py --version
```

### Build DA2_esp_LAN (LAN MCU)

```bash
cd c:/embedded/DATN_Workspace/DA2_esp_LAN

# Clean build (recommended for first build)
idf.py fullclean

# Configure
idf.py menuconfig
# Verify: Component config -> ESP32S3 -> [check settings]

# Build
idf.py build

# Flash
idf.py -p COM3 flash monitor
# Replace COM3 with your serial port
```

### Build DA2_esp (WAN MCU)

```bash
cd c:/embedded/DATN_Workspace/DA2_esp

# Clean build
idf.py fullclean

# Build
idf.py build

# Flash
idf.py -p COM4 flash monitor
```

## Startup Sequence

### LAN MCU Boot Flow
```
1. NVS Init
2. Event Loop Init
3. LED Strip Init
4. I2C Init + TCA Init
5. Stack Handler Init → Detect module IDs
6. Config Init → Load global configs
7. Config Handler Start → Listen for JSON configs
8. Module Monitor Task Start → Check NVS for saved configs
9. MCU WAN Handler Start → Communication with WAN MCU
```

### Module Monitor Task Flow
```
1. Init module_info[2] structs (Stack 0, Stack 1)
2. Call stack_handler_get_module_id(0) → Save to g_stack_1_id
3. Call stack_handler_get_module_id(1) → Save to g_stack_2_id
4. Try load JSON configs from NVS for each stack
5. If config found → Parse JSON → Auto-start handler
6. Enter main loop → Listen for new configs via queue
7. On new config:
   - Parse "module_type" field (BLE/ZIGBEE/LORA)
   - Save to NVS
   - Auto-start appropriate handler task
```

## Expected Boot Logs

### Successful Boot (with BLE module on Stack 0)
```
I (456) MAIN APP: LAN MCU Application Starting... V1.0.1
I (512) Stack Handler: I2C initialized for stack detection
I (524) Stack Handler: Stack 0 module ID: 0x28 (BLE)
I (536) Stack Handler: Stack 1 module ID: 0x00 (NONE)
I (548) CONFIG_GLOBAL: Stack_1 ID set: 0x28
I (560) CONFIG_GLOBAL: Stack_2 ID set: 0x00
I (572) CONFIG_HANDLER: Config handler task started
I (584) MODULE_MONITOR: Module IDs detected: Stack_1=0x28, Stack_2=0x00
I (596) MODULE_MONITOR: Module Monitor Task started (Module Base Setting enabled)
I (608) MCU_WAN_UL: MCU WAN handler started
I (620) MODULE_MONITOR: Monitor task running
```

### When JSON Config Received (from PC App)
```
I (5234) CONFIG_HANDLER: Received BLE JSON config for Stack 0
I (5246) MODULE_MONITOR: Received config for Stack 0
I (5258) MODULE_MONITOR: Config parsed for Stack 0: type=1 (BLE)
I (5270) CONFIG_NVS: Module JSON saved to NVS for Stack 0 (128 bytes)
I (5282) MODULE_MONITOR: Starting BLE handler for Stack 0
I (5294) BLE_TASK: BLE handler task started for Stack 0
I (5306) BLE_HANDLER: BLE module initialized on Stack 0
```

## Testing Module Base Setting

### Test 1: Module Detection
**Goal**: Verify module ID detection

```bash
# Expected logs:
Stack Handler: Stack 0 module ID: 0x28 (BLE)
Stack Handler: Stack 1 module ID: 0x00 (NONE)
CONFIG_GLOBAL: Stack_1 ID set: 0x28
```

**Pass criteria**: Module IDs correctly detected and saved to config_global

### Test 2: JSON Config Load
**Goal**: Send BLE config và verify handler auto-start

**JSON Example**:
```json
{
  "module_type": "BLE",
  "stack_id": 0,
  "scan_interval_ms": 5000,
  "connect_timeout_ms": 10000,
  "whitelist": ["AA:BB:CC:DD:EE:FF"]
}
```

**Send via PC App → WAN MCU → LAN MCU**

**Expected logs**:
```
MODULE_MONITOR: Received config for Stack 0
MODULE_MONITOR: Config parsed for Stack 0: type=1
MODULE_MONITOR: Starting BLE handler for Stack 0
BLE_TASK: BLE handler task started for Stack 0
```

**Pass criteria**: 
- ✅ JSON parsed correctly
- ✅ Config saved to NVS
- ✅ BLE handler task started automatically

### Test 3: NVS Persistence
**Goal**: Verify config persists across reboot

1. Flash LAN MCU với Module Base Setting enabled
2. Send JSON config for Stack 0 (BLE)
3. Reboot LAN MCU (press RESET button)
4. Check logs for auto-start from NVS:

```
MODULE_MONITOR: Loaded saved config for Stack 0 from NVS
MODULE_MONITOR: Config parsed for Stack 0: type=1
MODULE_MONITOR: Starting BLE handler for Stack 0
```

**Pass criteria**: Handler auto-starts from saved config without PC App

### Test 4: Multi-Stack Support
**Goal**: Verify 2 modules can run simultaneously

**Setup**: Connect BLE on Stack 0, Zigbee on Stack 1

**Expected behavior**:
- Both handlers start independently
- Each handler has separate queues/tasks
- No interference between stacks

## Debugging Tips

### Issue: Module ID detection fails
```
Stack Handler: Stack 0 module ID: 0x00 (NONE)
```

**Solution**:
1. Check I2C wiring (SDA/SCL, pull-up resistors)
2. Check TCA9548 I2C multiplexer
3. Verify module power supply
4. Use `i2cdetect` to scan bus

### Issue: JSON parse failed
```
MODULE_MONITOR: Failed to parse config for Stack 0
```

**Solution**:
1. Check JSON syntax (use validator)
2. Verify "module_type" field exists
3. Check JSON length < 2048 bytes
4. Enable verbose logging: `esp_log_level_set("MODULE_MONITOR", ESP_LOG_DEBUG);`

### Issue: Handler task not starting
```
MODULE_MONITOR: Starting BLE handler for Stack 0
E (1234) MODULE_MONITOR: Failed to start handler for Stack 0
```

**Solution**:
1. Check BLE handler task implementation
2. Verify stack size (4096 bytes minimum)
3. Check memory availability: `esp_get_free_heap_size()`
4. Ensure BLE module initialized: `ble_handler_init()`

## Configuration Files

### module_monitor_task.c
- **Location**: `DA2_esp_LAN/Application/Module_Monitor_Task/src/`
- **Key functions**: 
  - `module_monitor_task_start()` - Entry point
  - `module_parse_json_config()` - Parse JSON
  - `module_start_handler_task()` - Start BLE/Zigbee/LoRa handler

### config_load_save.c
- **Location**: `DA2_esp_LAN/Application/Config_Handler/src/`
- **Key functions**:
  - `config_save_module_json_to_nvs()` - Save JSON to NVS
  - `config_load_module_json_from_nvs()` - Load JSON from NVS

### stack_handler.c
- **Location**: `DA2_esp_LAN/BSP/stack_handler/src/`
- **Key functions**:
  - `stack_handler_init()` - Init I2C for detection
  - `stack_handler_get_module_id(stack_id)` - Detect module ID

## Next Steps

### Phase 2: Complete BLE Handler Integration
- [ ] Test BLE discovery command
- [ ] Test BLE connect/disconnect
- [ ] Test BLE data uplink/downlink
- [ ] Verify device whitelist filtering

### Phase 3: Add Zigbee Support
- [ ] Implement `zigbee_handler_task_start()`
- [ ] Implement `zigbee_handler_task_stop()`
- [ ] Add Zigbee JSON parser
- [ ] Test multi-module (BLE + Zigbee)

### Phase 4: Add LoRa Support
- [ ] Implement `lora_handler_task_start()`
- [ ] Implement `lora_handler_task_stop()`
- [ ] Add LoRa JSON parser
- [ ] Test triple-module scenario

## Contact

**Embedded Team**  
Email: embedded@example.com  
Date: February 2026
