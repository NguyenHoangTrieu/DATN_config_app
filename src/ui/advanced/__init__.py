# Advanced mode UI - 7 tabs

from .wifi_tab import WiFiTab
from .lte_tab import LTETab
from .server_tab import ServerTab
from .lora_tab import LoRaTab
from .zigbee_tab import ZigbeeTab
from .can_tab import CanTab
from .rs485_tab import Rs485Tab
from .firmware_tab import FirmwareTab
from .advanced_panel import AdvancedPanel

__all__ = [
    'WiFiTab',
    'LTETab', 
    'ServerTab',
    'LoRaTab',
    'ZigbeeTab',
    'CanTab',
    'Rs485Tab',
    'FirmwareTab',
    'AdvancedPanel',
]