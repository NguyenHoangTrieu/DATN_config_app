"""
Protocol definitions for ESP32 Gateway Configuration Tool
Handles CFSC command/response protocol
"""

from dataclasses import dataclass, field
from typing import Dict, Optional, List
from enum import Enum


class InternetType(Enum):
    WIFI = "WIFI"
    LTE = "LTE"
    UNKNOWN = "UNKNOWN"


class ServerType(Enum):
    MQTT = "MQTT"
    COAP = "COAP"
    HTTP = "HTTP"
    UNKNOWN = "UNKNOWN"


# Server type numeric codes (must match config_server_type_t in firmware)
SERVER_TYPE_MQTT  = 0
SERVER_TYPE_COAP  = 1
SERVER_TYPE_HTTP  = 2

SERVER_TYPE_LABELS = {
    SERVER_TYPE_MQTT: "MQTT",
    SERVER_TYPE_COAP: "CoAP",
    SERVER_TYPE_HTTP: "HTTP/HTTPS",
}

SERVER_TYPE_FROM_LABEL = {v: k for k, v in SERVER_TYPE_LABELS.items()}


class CanMode(Enum):
    NORMAL = "NORMAL"
    LOOPBACK = "LOOPBACK"
    SILENT = "SILENT"


class LoraRole(Enum):
    GATEWAY = "GATEWAY"
    NODE = "NODE"


class StackType(Enum):
    NONE = "NONE"
    LORA = "LORA"
    RS485 = "RS485"
    ZIGBEE = "ZIGBEE"
    CAN = "CAN"
    BLE = "BLE"


# Protocol constants
CFSC_COMMAND = "CFSC"
CFSC_RESP_START = "CFSC_RESP:START"
CFSC_RESP_END = "CFSC_RESP:END"

SECTION_GATEWAY_INFO = "[GATEWAY_INFO]"
SECTION_WAN_CONFIG = "[WAN_CONFIG]"
SECTION_LAN_CONFIG = "[LAN_CONFIG]"

PASSWORD_HIDDEN = "***HIDDEN***"
UNAVAILABLE = "UNAVAILABLE"


@dataclass
class GatewayInfo:
    """Read-only gateway information"""
    model: str = ""
    firmware: str = ""
    hardware: str = ""
    serial: str = ""
    internet_status: str = ""
    rtc_time: str = ""


@dataclass
class WanConfig:
    """WAN/Internet configuration"""
    internet_type: str = "WIFI"
    wifi_ssid: str = ""
    wifi_password: str = ""
    wifi_username: str = ""
    wifi_auth_mode: int = 0  # 0=PERSONAL, 1=ENTERPRISE
    lte_apn: str = ""
    lte_username: str = ""
    lte_password: str = ""
    lte_comm_type: str = "UART"
    lte_max_retries: int = 5
    lte_timeout_ms: int = 30000
    lte_auto_reconnect: str = "false"
    lte_modem_name: str = ""
    lte_pwr_pin: str = "WK"
    lte_rst_pin: str = "PE"
    stack_wan_id: str = "100"
    server_type: str = "MQTT"
    mqtt_broker: str = ""
    mqtt_device_token: str = ""
    mqtt_pub_topic: str = ""
    mqtt_sub_topic: str = ""
    mqtt_attribute_topic: str = ""
    mqtt_keepalive_s: int = 120   # MQTT keepalive interval in seconds
    mqtt_timeout_ms: int = 10000  # MQTT network timeout in ms
    # HTTP server fields
    http_url: str = "http://demo.thingsboard.io:8080/api/v1/{token}/telemetry"
    http_auth_token: str = ""
    http_port: int = 8080
    http_use_tls: bool = False
    http_verify_server: bool = False
    http_timeout_ms: int = 10000
    # CoAP server fields
    coap_host: str = "demo.thingsboard.io"
    coap_resource_path: str = "/api/v1/{token}/telemetry"
    coap_device_token: str = ""
    coap_port: int = 5683
    coap_use_dtls: bool = False
    coap_ack_timeout_ms: int = 2000
    coap_max_retransmit: int = 4
    coap_rpc_poll_interval_ms: int = 1500  # RPC polling interval in ms


@dataclass
class LoraConfig:
    """LoRa configuration"""
    e32_addh: int = 0x00
    e32_addl: int = 0x00
    e32_sped: int = 0x1A
    e32_chan: int = 23
    e32_option: int = 0x44
    e32_baud: int = 9600  # Read-only
    e32_header: int = 0xC0  # Read-only
    role: str = "GATEWAY"
    node_id: int = 0x0001
    gateway_id: int = 0x0001
    num_slots: int = 8
    my_slot: int = 0
    slot_duration_ms: int = 200
    crypto_key_len: int = 0


@dataclass
class CanConfig:
    """CAN Bus configuration"""
    baud_rate: int = 500000
    mode: str = "NORMAL"
    whitelist_count: int = 0  # Read-only
    whitelist: str = ""  # Read-only, comma-separated


@dataclass
class Rs485Config:
    """RS485 configuration"""
    baud_rate: int = 115200


@dataclass
class StackConfig:
    """Stack configuration (legacy, kept for compatibility)"""
    stack_1_type: str = "NONE"
    stack_2_type: str = "NONE"


@dataclass
class LanStackInfo:
    """LAN stack info parsed from CFSC response"""
    stack1_id: str = "000"       # "000"=empty, "001"=Zigbee, "002"=BLE, ...
    stack2_id: str = "000"
    rs485_baudrate: int = 115200
    stack1_json_len: int = 0    # 0 = no JSON stored on gateway
    stack2_json_len: int = 0

    def get_stack_id(self, stack_idx: int) -> str:
        return self.stack1_id if stack_idx == 0 else self.stack2_id

    def get_json_len(self, stack_idx: int) -> int:
        return self.stack1_json_len if stack_idx == 0 else self.stack2_json_len


@dataclass
class LanConfig:
    """LAN configuration - contains all LAN-side configs"""
    lora: LoraConfig = field(default_factory=LoraConfig)
    can: CanConfig = field(default_factory=CanConfig)
    rs485: Rs485Config = field(default_factory=Rs485Config)
    stack: StackConfig = field(default_factory=StackConfig)
    stack_info: LanStackInfo = field(default_factory=LanStackInfo)


@dataclass
class GatewayConfig:
    """Complete gateway configuration"""
    gateway_info: GatewayInfo = field(default_factory=GatewayInfo)
    wan: WanConfig = field(default_factory=WanConfig)
    lan: LanConfig = field(default_factory=LanConfig)


class ConfigParser:
    """Parser for CFSC response data"""
    
    @staticmethod
    def parse_response(data: str) -> Optional[GatewayConfig]:
        """Parse CFSC response string into GatewayConfig object"""
        if CFSC_RESP_START not in data or CFSC_RESP_END not in data:
            return None
        
        config = GatewayConfig()
        current_section = None
        
        lines = data.split('\n')
        for line in lines:
            line = line.strip()
            if not line:
                continue
            
            # Check for section headers
            if line == SECTION_GATEWAY_INFO:
                current_section = "gateway_info"
                continue
            elif line == SECTION_WAN_CONFIG:
                current_section = "wan"
                continue
            elif line == SECTION_LAN_CONFIG:
                current_section = "lan"
                continue
            elif line in [CFSC_RESP_START, CFSC_RESP_END]:
                continue
            
            # Parse key=value pairs
            if '=' in line:
                key, value = line.split('=', 1)
                key = key.strip()
                value = value.strip()
                
                ConfigParser._set_config_value(config, current_section, key, value)
        
        return config
    
    @staticmethod
    def _set_config_value(config: GatewayConfig, section: str, key: str, value: str):
        """Set a config value based on section and key"""
        try:
            if section == "gateway_info":
                if hasattr(config.gateway_info, key):
                    setattr(config.gateway_info, key, value)
            
            elif section == "wan":
                if key == "wifi_auth_mode":
                    config.wan.wifi_auth_mode = int(value)
                elif key == "lte_max_retries":
                    config.wan.lte_max_retries = int(value)
                elif key == "lte_timeout_ms":
                    config.wan.lte_timeout_ms = int(value)
                elif key == "mqtt_keepalive_s":
                    config.wan.mqtt_keepalive_s = int(value)
                elif key == "mqtt_timeout_ms":
                    config.wan.mqtt_timeout_ms = int(value)
                elif key == "coap_rpc_poll_interval_ms":
                    config.wan.coap_rpc_poll_interval_ms = int(value)
                elif hasattr(config.wan, key):
                    setattr(config.wan, key, value)
            
            elif section == "lan":
                # New stack-based fields from firmware CFSC response
                if key == "stack1_id":
                    config.lan.stack_info.stack1_id = value
                elif key == "stack2_id":
                    config.lan.stack_info.stack2_id = value
                elif key == "rs485_baudrate":
                    try:
                        config.lan.stack_info.rs485_baudrate = int(value)
                    except ValueError:
                        pass
                elif key == "stack1_json_len":
                    try:
                        config.lan.stack_info.stack1_json_len = int(value)
                    except ValueError:
                        pass
                elif key == "stack2_json_len":
                    try:
                        config.lan.stack_info.stack2_json_len = int(value)
                    except ValueError:
                        pass
                # LoRa configs
                elif key.startswith("lora_e32_"):
                    attr = key.replace("lora_e32_", "e32_")
                    if attr in ["e32_addh", "e32_addl", "e32_sped", "e32_option", "e32_header"]:
                        setattr(config.lan.lora, attr, int(value, 16) if value.startswith("0x") else int(value))
                    elif attr in ["e32_chan", "e32_baud"]:
                        setattr(config.lan.lora, attr, int(value))
                elif key.startswith("lora_"):
                    attr = key.replace("lora_", "")
                    if attr in ["node_id", "gateway_id"]:
                        setattr(config.lan.lora, attr, int(value, 16) if value.startswith("0x") else int(value))
                    elif attr in ["num_slots", "my_slot", "slot_duration_ms", "crypto_key_len"]:
                        setattr(config.lan.lora, attr, int(value))
                    elif hasattr(config.lan.lora, attr):
                        setattr(config.lan.lora, attr, value)
                
                # CAN configs
                elif key.startswith("can_"):
                    attr = key.replace("can_", "")
                    if attr == "baud_rate":
                        config.lan.can.baud_rate = int(value)
                    elif attr == "whitelist_count":
                        config.lan.can.whitelist_count = int(value)
                    elif hasattr(config.lan.can, attr):
                        setattr(config.lan.can, attr, value)
                
                # RS485 configs
                elif key.startswith("rs485_"):
                    attr = key.replace("rs485_", "")
                    if attr == "baud_rate":
                        config.lan.rs485.baud_rate = int(value)
                
                # Stack configs
                elif key.startswith("stack_"):
                    if hasattr(config.lan.stack, key):
                        setattr(config.lan.stack, key, value)
        except (ValueError, AttributeError) as e:
            print(f"Warning: Failed to parse {key}={value}: {e}")
    
    @staticmethod
    def build_wan_config_command(wan: WanConfig) -> str:
        """Build CF command for WAN config"""
        lines = []
        lines.append(f"CF:internet_type={wan.internet_type}")
        lines.append(f"CF:wifi_ssid={wan.wifi_ssid}")
        if wan.wifi_password and wan.wifi_password != PASSWORD_HIDDEN:
            lines.append(f"CF:wifi_password={wan.wifi_password}")
        lines.append(f"CF:wifi_username={wan.wifi_username}")
        lines.append(f"CF:wifi_auth_mode={wan.wifi_auth_mode}")
        lines.append(f"CF:lte_apn={wan.lte_apn}")
        lines.append(f"CF:lte_username={wan.lte_username}")
        if wan.lte_password and wan.lte_password != PASSWORD_HIDDEN:
            lines.append(f"CF:lte_password={wan.lte_password}")
        lines.append(f"CF:lte_comm_type={wan.lte_comm_type}")
        lines.append(f"CF:lte_max_retries={wan.lte_max_retries}")
        lines.append(f"CF:lte_timeout_ms={wan.lte_timeout_ms}")
        lines.append(f"CF:lte_auto_reconnect={wan.lte_auto_reconnect}")
        lines.append(f"CF:server_type={wan.server_type}")
        lines.append(f"CF:mqtt_broker={wan.mqtt_broker}")
        if wan.mqtt_device_token and wan.mqtt_device_token != PASSWORD_HIDDEN:
            lines.append(f"CF:mqtt_device_token={wan.mqtt_device_token}")
        lines.append(f"CF:mqtt_pub_topic={wan.mqtt_pub_topic}")
        lines.append(f"CF:mqtt_sub_topic={wan.mqtt_sub_topic}")
        lines.append(f"CF:mqtt_attribute_topic={wan.mqtt_attribute_topic}")
        return '\r\n'.join(lines)
    
    @staticmethod
    def build_lan_config_command(lan: LanConfig) -> str:
        """Build CF command for LAN config"""
        lines = []
        
        # LoRa configs
        lines.append(f"CF:lora_e32_addh=0x{lan.lora.e32_addh:02X}")
        lines.append(f"CF:lora_e32_addl=0x{lan.lora.e32_addl:02X}")
        lines.append(f"CF:lora_e32_sped=0x{lan.lora.e32_sped:02X}")
        lines.append(f"CF:lora_e32_chan={lan.lora.e32_chan}")
        lines.append(f"CF:lora_e32_option=0x{lan.lora.e32_option:02X}")
        lines.append(f"CF:lora_role={lan.lora.role}")
        lines.append(f"CF:lora_node_id=0x{lan.lora.node_id:04X}")
        lines.append(f"CF:lora_gateway_id=0x{lan.lora.gateway_id:04X}")
        lines.append(f"CF:lora_num_slots={lan.lora.num_slots}")
        lines.append(f"CF:lora_my_slot={lan.lora.my_slot}")
        lines.append(f"CF:lora_slot_duration_ms={lan.lora.slot_duration_ms}")
        lines.append(f"CF:lora_crypto_key_len={lan.lora.crypto_key_len}")
        
        # CAN configs
        lines.append(f"CF:can_baud_rate={lan.can.baud_rate}")
        lines.append(f"CF:can_mode={lan.can.mode}")
        
        # RS485 configs
        lines.append(f"CF:rs485_baud_rate={lan.rs485.baud_rate}")
        
        # Stack configs
        lines.append(f"CF:stack_1_type={lan.stack.stack_1_type}")
        lines.append(f"CF:stack_2_type={lan.stack.stack_2_type}")
        
        return '\r\n'.join(lines)


# =============================================================================
# Standalone server-config command builders
# =============================================================================

def build_server_type_cmd(server_type: int) -> str:
    """Build CFSV command: CFSV:<type_code>  (0=MQTT, 1=CoAP, 2=HTTP)"""
    return f"CFSV:{server_type}"


def build_mqtt_cmd(broker: str, token: str,
                   sub: str = "v1/devices/me/rpc/request/+",
                   pub: str = "v1/devices/me/telemetry",
                   attr: str = "v1/devices/me/attributes",
                   keepalive_s: int = 0,
                   timeout_ms: int = 0) -> str:
    """Build CFMQ command: CFMQ:BROKER|TOKEN|SUB|PUB|ATTR|KEEPALIVE_S|TIMEOUT_MS

    keepalive_s and timeout_ms are optional (0 = firmware uses its current default).
    """
    return f"CFMQ:{broker}|{token}|{sub}|{pub}|{attr}|{keepalive_s}|{timeout_ms}"


def build_http_cmd(url: str, auth_token: str, port: int = 80,
                   use_tls: bool = False, verify_server: bool = False,
                   timeout_ms: int = 10000) -> str:
    """Build CFHP command: CFHP:URL|AUTH_TOKEN|PORT|USE_TLS|VERIFY|TIMEOUT_MS"""
    return f"CFHP:{url}|{auth_token}|{port}|{int(use_tls)}|{int(verify_server)}|{timeout_ms}"


def build_coap_cmd(host: str, resource_path: str, token: str,
                   port: int = 5683, use_dtls: bool = False,
                   ack_timeout_ms: int = 2000, max_retransmit: int = 4,
                   rpc_poll_interval_ms: int = 1500) -> str:
    """Build CFCP command: CFCP:HOST|RESOURCE_PATH|TOKEN|PORT|USE_DTLS|ACK_TIMEOUT|MAX_RTX|RPC_POLL_MS"""
    return f"CFCP:{host}|{resource_path}|{token}|{port}|{int(use_dtls)}|{ack_timeout_ms}|{max_retransmit}|{rpc_poll_interval_ms}"
