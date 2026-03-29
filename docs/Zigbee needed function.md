D	Function Name	Category	Type	Implementation Note
L5	MODULE_SET_COMM_CONFIG	Lifecycle	CMD+PARAM	Param = baudrate; cần reboot để apply
L6	MODULE_ENTER_HEX_MODE	Lifecycle	CMD	Chuyển AT → binary HEX; Ebyte-specific AT+EXIT
L7	MODULE_ENTER_BOOTLOADER	Lifecycle	GPIO+CMD	BOOT=HIGH + RST pulse; cần cho OTA firmware update
N5	MODULE_LEAVE_NETWORK	Network	CMD	Self-initiated leave; coordinator nhận NODE_LEAVE_NOTIFY
N6	MODULE_SET_DEVICE_TYPE	Network	CMD+PARAM	0=Coordinator / 1=Router / 2=EndDevice / 3=SleepyED; cần reboot
N7	MODULE_SET_CHANNEL	Network	CMD+PARAM	Channel mask 11–26; apply trước khi form network
N8	MODULE_SET_PANID	Network	CMD+PARAM	16-bit; 0xFFFF = random
N9	MODULE_SET_TX_POWER	Network	CMD+PARAM	dBm value; range tùy chip
D3	MODULE_QUERY_NODE_PORT_INFO	NodeMgmt	CMD+PARAM	Param = short_addr; returns endpoint list + cluster list (ZDO Simple Desc)
D4	MODULE_QUERY_IEEE_ADDR	NodeMgmt	CMD+PARAM	Param = short_addr; returns EUI-64 MAC
Z4	MODULE_ZCL_SET_REPORT_RULE	ZCL	CMD+PARAM	Param: addr, ep, cluster, attr, min_interval, max_interval, threshold
B1	MODULE_ZCL_BIND	Binding	CMD+PARAM	Param: src_IEEE+ep+cluster, dst_IEEE+ep; ZDO Bind Request
B2	MODULE_ZCL_UNBIND	Binding	CMD+PARAM	Same param format as BIND
TX2	MODULE_SEND_BROADCAST	DataTX	CMD+PARAM	Broadcast addr: 0xFFFF (all) / 0xFFFD (RxOnWhenIdle) / 0xFFFC (routers)
TX3	MODULE_SEND_MULTICAST	DataTX	CMD+PARAM	Param = group_addr + payload; khác hoàn toàn với broadcast
P2 — Optional (11 functions)
Implement khi module cụ thể hỗ trợ; không đưa vào JSON nếu module không có.

ID	Function Name	Category	Type	Implementation Note
L8	MODULE_ENTER_AT_MODE	Lifecycle	CMD	Binary HEX → AT switch; Ebyte cmd_code 0x16
D5	MODULE_AUTO_FIND_TARGET	NodeMgmt	CMD	Ebyte-specific AT+FIND; auto discover binding partner
Z5	MODULE_ZCL_DISCOVER_ATTR	ZCL	CMD+PARAM	ZCL Discover Attributes của cluster
Z6	MODULE_ZCL_IDENTIFY	ZCL	CMD+PARAM	Gửi ZCL Identify; LED nhấp nháy trên target device
B3	MODULE_ZCL_GET_BIND_TABLE	Binding	CMD+PARAM	Read binding table của remote node
TX4	MODULE_ENTER_TRANSPARENT_MODE	DataTX	CMD	AT+SEND; pass-through mode cho DTU use case
A1	MODULE_SET_DEST_ADDR	Addressing	CMD+PARAM	Default target addr cho transparent mode
A2	MODULE_SET_DEST_EP	Addressing	CMD+PARAM	Default target endpoint cho transparent mode
PM1	MODULE_SET_LP_LEVEL	PowerMgmt	CMD+PARAM	Sleep interval level 1–4; end device only
PM2	MODULE_ENTER_SLEEP	PowerMgmt	CMD	Force sleep; end device only
PM3	MODULE_WAKEUP	PowerMgmt	GPIO	Toggle WAKE pi