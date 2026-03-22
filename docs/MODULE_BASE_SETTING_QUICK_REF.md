# Module Base Setting - Quick Reference

## ⚡ Quick Build Commands

```bash
# LAN MCU (DA2_esp_LAN)
cd c:/embedded/DATN_Workspace/DA2_esp_LAN
idf.py build
idf.py -p COM3 flash monitor

# WAN MCU (DA2_esp)
cd c:/embedded/DATN_Workspace/DA2_esp
idf.py build
idf.py -p COM4 flash monitor
```

## 🔑 Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **Module Monitor Task** | `DA2_esp_LAN/Application/Module_Monitor_Task/` | Core - manages handler lifecycle |
| **Stack Handler** | `DA2_esp_LAN/BSP/stack_handler/` | Detects module IDs via I2C |
| **Config Handler** | `DA2_esp_LAN/Application/Config_Handler/` | Parses JSON configs |
| **BLE Handler Task** | `DA2_esp_LAN/Application/BLE_Handler/` | BLE module communication |
| **Config Load/Save** | `DA2_esp_LAN/Application/Config_Handler/src/config_load_save.c` | NVS persistence |

## 📊 Boot Flow

```
NVS Init → I2C Init → Stack Handler Init (detect IDs) → 
Config Init → Module Monitor Start → MCU WAN Handler Start
```

## 🧪 Test JSON Config Example

### BLE Module Configuration
```json
{
  "module_type": "BLE",
  "stack_id": 0,
  "scan_interval_ms": 5000,
  "connect_timeout_ms": 10000,
  "whitelist": ["AA:BB:CC:DD:EE:FF", "11:22:33:44:55:66"]
}
```

### Send Command via WAN MCU
```
Command: CFBL:JSON
Payload: [JSON string above]
```

## 📝 Expected Logs Checklist

```
✅ Stack Handler: Stack 0 module ID: 0x28 (BLE)
✅ MODULE_MONITOR: Module IDs detected: Stack_1=0x28, Stack_2=0x00
✅ MODULE_MONITOR: Module Monitor Task started (Module Base Setting enabled)
✅ MODULE_MONITOR: Config parsed for Stack 0: type=1
✅ MODULE_MONITOR: Starting BLE handler for Stack 0
✅ BLE_TASK: BLE handler task started for Stack 0
```

## 🐛 Common Issues

| Issue | Solution |
|-------|----------|
| Module ID = 0x00 (NONE) | Check I2C wiring, power supply, TCA9548 |
| JSON parse failed | Validate JSON syntax, check "module_type" field |
| Handler not starting | Check heap memory, verify BLE handler init |
| Config not persisting | Check NVS partition, verify save success |

## 📂 Modified Files Summary

### Core Changes
- ✅ `DA2_esp_LAN/main/DA2_esp_LAN.c` - Added `module_monitor_task_start()`
- ✅ `DA2_esp_LAN/Application/Module_Monitor_Task/src/module_monitor_task.c` - Linked BLE handler API
- ✅ `DA2_esp_LAN/Application/Config_Handler/src/config_load_save.c` - NVS operations centralized
- ✅ `DA2_esp_LAN/Application/MCU_WAN_Handler/src/mcu_wan_handler*.c` - Removed deprecated code

### Cleanup Done
- ✅ Removed `stack_comm_type_t` enum
- ✅ Removed wrapper NVS functions from module_monitor
- ✅ Removed all `#if 0` blocks and commented code
- ✅ Centralized NVS init in main app

## 🚀 Status

**Current Phase**: Module Base Setting Core - READY FOR BUILD ✅

**Implemented**:
- ✅ Module detection via I2C
- ✅ JSON config parsing
- ✅ NVS persistence
- ✅ BLE handler integration
- ✅ Multi-stack support (2 stacks)

**TODO**:
- ⏳ Zigbee handler integration
- ⏳ LoRa handler integration
- ⏳ Full BLE testing with real devices

## 📞 Support

See full documentation: `docs/MODULE_BASE_SETTING_BUILD_GUIDE.md`
