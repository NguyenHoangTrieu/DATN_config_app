"""
LoRa Advanced Configuration Tab - v5.0 JSON Config Builder.

Uses the shared ConfigForm widget. Layout:
  Header: Stack Slot | Preset | Module ID | Module Name | Reload
  Body:   ConfigForm (Communication + Functions accordion + JSON Preview + Actions)
"""

import tkinter as tk
from tkinter import ttk

from src.config.paths import load_module_config, get_presets_for_type
from src.ui.advanced.config_form import ConfigForm

_MODULE_TYPE = "LORA"
_CMD_PREFIX = "CFLR"


class LoRaTab(ttk.Frame):
    """Advanced LoRa tab - JSON Config Builder."""

    def __init__(self, parent, serial_manager=None, log_callback=None,
                 **kwargs):
        kwargs.pop("stack_idx", None)
        kwargs.pop("stack_id", None)
        kwargs.pop("cmd_prefix", None)
        kwargs.pop("cmd_map", None)
        super().__init__(parent, **kwargs)

        self.serial_manager = serial_manager
        self.log = log_callback or (lambda msg, lvl="INFO": None)

        self._presets = get_presets_for_type(_MODULE_TYPE)
        self._current_stack_id = (self._presets[0]["stack_id"]
                                  if self._presets else "003")

        self._build_ui()
        self._on_preset_change()

    def _build_ui(self):
        hdr = ttk.Frame(self, padding=(8, 4))
        hdr.pack(fill=tk.X)

        row1 = ttk.Frame(hdr)
        row1.pack(fill=tk.X, pady=2)

        ttk.Label(row1, text="Stack Slot:").pack(side=tk.LEFT)
        self._slot_var = tk.StringVar(value="S1")
        ttk.Combobox(row1, textvariable=self._slot_var,
                     values=["S1", "S2"], state="readonly",
                     width=4).pack(side=tk.LEFT, padx=4)

        ttk.Label(row1, text="Preset:").pack(side=tk.LEFT, padx=(12, 0))
        preset_labels = [p["label"] for p in self._presets]
        self._preset_var = tk.StringVar(
            value=preset_labels[0] if preset_labels else "")
        preset_cb = ttk.Combobox(row1, textvariable=self._preset_var,
                                 values=preset_labels, width=24)
        preset_cb.pack(side=tk.LEFT, padx=4)
        preset_cb.bind("<<ComboboxSelected>>", self._on_preset_change)

        ttk.Button(row1, text="Reload", width=10,
                   command=self._on_preset_change).pack(side=tk.LEFT, padx=8)

        row2 = ttk.Frame(hdr)
        row2.pack(fill=tk.X, pady=2)

        ttk.Label(row2, text="Module ID:").pack(side=tk.LEFT)
        self._module_id_var = tk.StringVar(value=self._current_stack_id)
        ttk.Entry(row2, textvariable=self._module_id_var,
                  width=10).pack(side=tk.LEFT, padx=4)

        ttk.Label(row2, text="Module Name:").pack(side=tk.LEFT, padx=(12, 0))
        self._module_name_var = tk.StringVar(value="")
        ttk.Entry(row2, textvariable=self._module_name_var,
                  width=30).pack(side=tk.LEFT, padx=4, fill=tk.X, expand=True)

        ttk.Separator(self, orient="horizontal").pack(fill=tk.X, padx=4)

        self._config_form = ConfigForm(
            self, module_type=_MODULE_TYPE, cmd_prefix=_CMD_PREFIX,
            serial_manager=self.serial_manager,
            log_callback=self.log)
        self._config_form.set_module_id_var(self._module_id_var)
        self._config_form.set_module_name_var(self._module_name_var)
        self._config_form.set_stack_slot_var(self._slot_var)
        self._config_form.pack(fill=tk.BOTH, expand=True)

    def _on_preset_change(self, _event=None):
        label = self._preset_var.get().strip()
        for p in self._presets:
            if p["label"] == label:
                self._current_stack_id = p["stack_id"]
                break

        config = load_module_config(self._current_stack_id)
        if config:
            self._module_id_var.set(config.get("module_id", self._current_stack_id))
            self._module_name_var.set(config.get("module_name", ""))
            self._config_form.load_config(config)

    def handle_response(self, line: str):
        self._config_form.handle_response(line)

    def set_stack(self, stack_idx: int, stack_id: str, **kwargs):
        """Compatibility stub."""
        pass
