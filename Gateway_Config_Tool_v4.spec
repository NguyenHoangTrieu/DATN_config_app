# -*- mode: python ; coding: utf-8 -*-

import shutil, os

# JSON config files — bundled inside the EXE as fallback,
# AND copied to dist/config/ so users can edit without rebuilding.
# (Removed stack_XXX_app_commands.json files — no longer needed, functionality now in stack_XXX_config.json)
_CONFIG_FILES = [
    'src/config/stack_id_map.json',
    'src/config/stack_001_config.json',
    'src/config/stack_002_config.json',
    'src/config/stack_003_config.json',
    'src/config/stack_004_config.json',
    'src/config/stack_005_config.json',
    'src/config/stack_006_config.json',
    'src/config/stack_011_config.json',
]

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=[(f, 'src/config') for f in _CONFIG_FILES],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='Gateway_Config_Tool_v4',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

# ── Post-build: copy config files next to EXE ──────────────────
# Users can edit these JSON files directly — no rebuild needed.
# The app checks <exe_dir>/config/<file>.json FIRST before using
# the bundled copy inside the EXE.
_dist_config = os.path.join(DISTPATH, 'config')
os.makedirs(_dist_config, exist_ok=True)
for _cf in _CONFIG_FILES:
    _dst = os.path.join(_dist_config, os.path.basename(_cf))
    shutil.copy2(_cf, _dst)
    print(f'  [post-build] copied {_cf} -> {_dst}')
