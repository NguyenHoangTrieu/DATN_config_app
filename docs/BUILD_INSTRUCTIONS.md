# Gateway Config Tool - Build Instructions

## Quick Build

```bash
# 1. Install dependencies
cd c:\embedded\DATN_Workspace\DATN_config_app
pip install -r requirements.txt
pip install pyinstaller

# 2. Build executable
pyinstaller Gateway_Config_Tool_v4.spec

# 3. Output location
# dist\Gateway_Config_Tool_v4.exe
# dist\config\                     ← editable JSON configs
```

## Clean Build

```bash
rmdir /s /q build dist
pyinstaller Gateway_Config_Tool_v4.spec
```

## Editing JSON Config Without Rebuilding

After building, the `dist/` folder looks like:
```
dist/
  Gateway_Config_Tool_v4.exe
  config/
    stack_id_map.json
    stack_002_config.json
    stack_002_app_commands.json
    stack_004_config.json
    stack_004_app_commands.json
```

**To change AT commands, timeouts, or UI buttons — just edit the JSON
files in `dist/config/` and restart the app.** No rebuild needed.

The app loads config in this priority order:
1. `<exe_dir>/config/<file>.json` — **external override (editable)**
2. Bundled copy inside the EXE — fallback if `config/` folder is missing

To revert to defaults: delete the `config/` folder (or the specific file)
and the app will use the bundled version.
