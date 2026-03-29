# DA2 IoT Gateway -- Project Progress Report

Author: Nguyen Van A (DATN Student)
Date: March 2026
Subject: Embedded Systems Senior Thesis -- Gateway Firmware and Configuration Tool

---

## Introduction

This report summarizes the progress made on the DA2 IoT Gateway project from the previous
version to the current state. The gateway is a dual-microcontroller system built on two
ESP32-S3 modules. The first module, referred to as the WAN MCU, handles internet
connectivity through WiFi, LTE 4G modem, and cloud communication protocols such as MQTT,
HTTP, and CoAP. The second module, referred to as the LAN MCU, manages physical RF modules
installed on adapter slots, including BLE, LoRa, Zigbee, and RS485 devices. A Python-based
desktop application is also part of the project and serves as the configuration tool for
the entire system.

Since the last review, five major areas of work have been carried out. Two of them have
been fully tested and confirmed to work on hardware. Two more have been implemented but
have not yet been tested on the physical device. One area is an ongoing adaptation effort
driven by changes in the hardware design from the board manufacturer.

---

## 1. JSON-Based Module Configuration System (Tested)

### 1.1 Background and Motivation

In the earlier version of the firmware, the type and behavior of the RF module installed
in each hardware slot were hardcoded. The UART baud rate, the AT commands for
initialization, and the GPIO pin sequences for hardware reset were all written directly
into the source code with conditional compilation flags. This made it impossible to change
the module type without recompiling and reflashing the firmware. It also meant that
supporting a new module required engineering effort at the firmware level every time.

The goal of this update was to move all of that module-specific knowledge out of the
firmware and into a configuration file that could be updated at runtime. The result is
what this project calls the Module Base Setting system.

### 1.2 How the System Works

The module configuration is described using a structured JSON format. Each JSON file
covers one module type and includes all the information the firmware needs to operate that
module: the communication bus type (UART, SPI, I2C, or USB), the bus parameters such as
baud rate and parity, and the full list of functions the module supports. Each function
entry carries the exact AT command string to send, the GPIO pins to control before and
after the command, the expected response, and the timeout in milliseconds.

For example, a hardware reset function for a BLE module would describe lowering a reset
GPIO pin for 100 milliseconds, then raising it again and waiting one second. A scan
function would describe sending the string AT+SCAN=5000 over UART and waiting for
asynchronous scan results to come back. These descriptions are the same regardless of
which BLE module vendor is used, as long as the AT command set matches.

Six preset configuration files have been prepared covering the most common modules used
in the project: Zigbee E180-ZG120B, BLE STM32WB55, LoRa RAK3172, a custom BLE variant,
Zigbee STM32WB55, and LoRa Wio-E5. A mapping file called stack_id_map.json links
hardware-detected slot identifiers to the appropriate preset.

### 1.3 Firmware Implementation

On the LAN MCU side, a dedicated Middleware layer called JSON_Config_Parser was written
to handle the parsing. It is split into separate parsers for each module type, all sharing
a common base for metadata fields. The parsed output is stored in typed C structures that
carry all function parameters in memory until a handler task needs them.

A new application component called Module_Config_Controller sits between the parser and
the hardware communication drivers. When the parsed config says the module communicates
over UART at 115200 baud with no parity, this controller initializes the appropriate ESP32
UART peripheral to exactly those settings. If the config says SPI, it configures the SPI
bus accordingly. The handler tasks themselves never call low-level hardware APIs directly.

Above that, a Module_Monitor_Task manages the lifecycle of all handler tasks. At boot, it
reads the hardware slot identifiers from an I2C GPIO expander, then checks the NVS flash
storage for a previously saved configuration for each slot. If a configuration is found
and the module identifier has not changed since the last boot, it automatically loads the
configuration and starts the appropriate handler task. If no configuration is found, the
system waits for one to arrive from the PC application over the SPI link.

When new configurations arrive during runtime, the monitor task parses the JSON, saves it
to NVS, and restarts the affected handler task with the new settings. This means the
module can be changed from one type to another at runtime without reflashing.

### 1.4 PC Application Changes

The advanced tabs in the PC application (DATN_config_app) were redesigned from being
direct AT command senders into JSON configuration builders. The user fills out a form
with the communication type, parameters, and per-function settings. The application
generates the complete JSON in a preview panel on the right side of the screen, then
sends it to the gateway using command prefixes CFBL:JSON: for BLE, CFLR:JSON: for LoRa,
and CFZB:JSON: for Zigbee. The gateway responds with a confirmation once the configuration
has been parsed and saved.

The previous behavior of sending individual raw AT commands from the UI has been replaced
by a pattern where the server or PC application sends a dynamic command string such as
AT+SCAN=5000, and the firmware looks up the matching function in the saved JSON. It finds
the correct function by prefix matching, then applies that function's GPIO sequences,
delays, and timeout from the stored configuration. This approach, referred to as prefix
command matching, eliminates the need to maintain a long list of hand-coded command cases
in the firmware for every supported module variant.

### 1.5 Testing Results

The full pipeline from PC application through UART to WAN MCU, across SPI to LAN MCU,
through JSON parsing, NVS storage, and handler task restart has been tested and confirmed
working. Boot logs confirm the expected module detection and auto-restore sequence. The
JSON parser correctly handles all metadata fields, function lists, GPIO control entries,
and communication parameters for the BLE configuration. Documentation in the
PARSER_VERIFICATION.md file records the verification steps and outputs.

---

## 2. Embedded Web Configuration Portal (Tested)

### 2.1 Background and Motivation

The earlier version of the project required a USB cable and the Python desktop
application to configure the gateway. While this is acceptable during development and
testing, it is not practical for deployment. A technician installing the gateway at a site
should be able to configure it from a phone or laptop using just the local WiFi network,
without installing any software.

To address this, a browser-accessible configuration portal was designed and embedded
directly into the WAN MCU firmware.

### 2.2 Architecture Decisions

One of the first decisions to make was where to store the web UI files. The common
approach on embedded systems is to add a separate filesystem partition to the flash memory
and mount it at runtime. However, this would require modifying the partition table, which
also affects the over-the-air firmware update flow, and introduces the risk of version
mismatch between the web UI and the firmware it controls. Since the web UI is tightly
coupled to the firmware's data structures, they need to change together.

The chosen approach was to embed the entire web UI as a compiled binary resource
directly inside the firmware image using CMake's target_add_binary_data mechanism. The
HTML, JavaScript, and CSS are bundled into a single file at build time using a tool called
vite-plugin-singlefile, which inlines all assets into one self-contained HTML file. The
firmware serves this single file from a const pointer in flash memory. This keeps the
partition table unchanged and guarantees that the UI and firmware are always in sync.

### 2.3 Backend Implementation

The web server backend was implemented inside a component called Web_Config_Handler in
the DA2_esp project. It is organized into four source files covering server initialization
and routing, configuration read and write handlers, status reporting, and a captive DNS
server.

The captive DNS server is responsible for the first-boot experience. When the gateway has
no saved WiFi credentials, it starts in Access Point mode and creates a WiFi network named
DA2-Gateway followed by a short hardware identifier. The DNS server then intercepts every
name resolution request from connected devices and returns the gateway's own IP address.
This causes the operating system on the phone or laptop to automatically display the
configuration portal in a browser window. The user enters their WiFi SSID and password,
submits the form, and the gateway saves the credentials and restarts in station mode.

In station mode, the web server continues running on the gateway's local IP address. An
mDNS registration makes the portal accessible at the address gateway.local without the
user needing to know the IP. A status indicator on the frontend polls a status endpoint
every five seconds to show whether the gateway is connected to the internet, along with
signal strength and firmware version information.

The entire web server integrates into the existing firmware as a new command source. When
the user submits configuration changes through the browser, the web handler pushes the
same types of messages to the same command queue that the UART handler and USB handler
already use. This means the config_handler.c file required no changes at all to support
the web interface.

### 2.4 Frontend Design

The web interface mirrors the layout of the Python desktop application. It includes a
basic mode for reading system status and a module information view, and an advanced mode
with tabs for WiFi, LTE, MQTT, HTTP, CoAP, module configuration, and firmware update.
The color palette and typography match the desktop application to give a consistent
experience. The advanced tabs for RF modules follow the JSON configuration builder
approach introduced in the Module Base Setting update.

### 2.5 Testing Results

The web portal has been validated on hardware. The first-boot captive portal flow was
tested on both Android and iOS, and the browser correctly redirected to the configuration
page. WiFi credential submission and station mode reconnection worked as expected.
Configuration read and write operations through the browser were tested for WiFi, LTE,
and server settings. The over-the-air update trigger via URL was also confirmed
functional.

---

## 3. Native BLE Mesh Provisioner on ESP32-S3 (Not Tested)

### 3.1 Background

During manual testing of the Tuya E27 smart LED bulb as a demonstration device for the
gateway, a fundamental compatibility issue was encountered. The Tuya E27 advertises itself
as a BLE Mesh unprovisioned device using a non-connectable advertisement type. The AT
command firmware on the STM32WB55 module expects a standard connectable advertisement
from the target device in order to establish a GATT connection. Because the bulb never
sends a connectable advertisement, the AT+CONNECT command would never succeed.

The only correct solution is to implement BLE Mesh provisioner functionality. A BLE Mesh
provisioner communicates with unprovisioned nodes through a dedicated provisioning
procedure, assigns network addresses and security keys, and then controls the node using
Mesh model operations. The ESP32-S3 on the LAN MCU natively supports this through the
ESP-IDF BLE Mesh stack, so the implementation was done there without any changes required
on the WAN MCU side.

### 3.2 Implementation

New source files were added under the existing BLE_Handler application component. The
provisioner initialization registers the gateway as a mesh provisioner with a network
key, an application key, and a set of client model bindings. The models registered cover
the generic on/off operation, light brightness control, and color temperature control,
matching the capabilities of the Tuya E27 bulb. Model selection is driven by a model
identifier field in the commands JSON file, so no model identifiers are hardcoded in
the firmware.

A new command prefix CFBN was defined to route commands to this native BLE Mesh handler,
following exactly the same pattern as CFBL for the AT command BLE path. Commands include
scanning for unprovisioned devices, provisioning a device by its UUID, sending control
payloads to provisioned nodes, and requesting status from individual nodes.

The Config_Handler was extended with two new message types for this module, and the
MCU_WAN_Handler frame type table was updated with a new handler identifier BLN to
distinguish native BLE Mesh traffic from AT command BLE traffic on the SPI link between
the two MCUs.

The sdkconfig for the LAN MCU needs specific Kconfig options enabled to activate the
BLE Mesh stack, including the provisioner role, PB-ADV provisioning bearer, and the
client model implementations for the light control clusters.

### 3.3 Status

The code is written and has been verified to compile without errors. Hardware testing
is pending. The provisioner initialization flow and command routing path have been
reviewed at the code level, but the behavior on a physical device with a real Tuya E27
bulb has not yet been observed. This is scheduled for the next phase of testing.

---

## 4. Gateway Test Application: Tuya E27 Bulb Control (Not Tested)

### 4.1 Purpose

To validate the full end-to-end behavior of the gateway, a test scenario was designed
around controlling a Tuya E27 smart LED bulb. This bulb was chosen because it supports
both BLE and Zigbee communication, which allows testing two different protocol paths
through the gateway using the same physical device.

### 4.2 What Was Written

The complete set of commands for controlling the bulb through the gateway was designed
and documented for both the AT command BLE path through the STM32WB55 module and the
native BLE Mesh path through the ESP32-S3. For the AT command path, the full sequence
from hardware reset through scan, connect, service discovery, enabling notifications,
and writing light control payloads was worked out and documented.

The Tuya E27 uses a proprietary binary protocol sent over BLE GATT. Each command
payload starts with a fixed header followed by a data point identifier, a type byte,
a length field, and the actual value. Payloads have been calculated and verified
against the Tuya DP specification for on/off control, brightness level, color
temperature, and RGB color mode. An equivalent Zigbee control sequence using ZCL cluster
identifiers was also documented for the Zigbee path.

Commands were organized as gateway-level instructions using the CFBL prefix so that the
server application can trigger each action with a single string without needing to know
the internal BLE protocol details. The gateway strips the prefix, applies the GPIO and
timing parameters from the loaded JSON configuration, and forwards the bare command to
the physical module.

The gateway command routing logic was confirmed through code review to correctly handle
the two special GPIO-only commands MODULE_HW_RESET and MODULE_WAKEUP, which do not
send anything over UART but instead toggle the hardware reset or wake pin on the GPIO
expander.

### 4.3 Status

The command set is complete and the routing logic has been confirmed by code review.
The actual end-to-end test, meaning the LED bulb physically changing state in response
to a command issued from the server application through the gateway, has not yet been
performed. This test depends on having the BLE module connected and a Tuya E27 bulb
available for testing.

---

## 5. New Hardware Board Adaptation (In Progress)

### 5.1 What Changed in the New Board Revision

After the software work above was completed, the hardware team released a revised board
design. The changes are significant enough to require updates across both firmware
projects and several layers of the software stack. The most impactful changes are
summarized below.

In the previous board, a TCA6424A IO expander chip was mounted directly on the main PCB.
This chip provides 24 controllable GPIO pins organized into three ports of eight pins each
and was used for both stack connector GPIO control and power rail management. The new
board moves the IO expander onto each individual adapter board, and changes the chip to
a TCA6416A, which is a smaller 16-pin device with only two ports. This affects every
layer of the firmware that interacts with GPIO signals through the expander.

The I2C address of the expander also changes. The old chip was always configured at a
fixed address. The new chip can be set to either of two addresses, and since the LAN MCU
now works with two independent adapter boards simultaneously, each board must have a
different address. There is also a design constraint noted in the documentation that both
adapters could inadvertently end up with the same address if the adapter boards are not
manufactured with different address pin configurations, which is flagged as a risk.

Several GPIO pin assignments have also changed on the LAN MCU side. The second adapter
slot's UART receive and transmit pins moved to different GPIO numbers. All five of the SPI
bus pins for the adapter communication are on different GPIOs. The interrupt pin from each
adapter's IO expander now has its own dedicated GPIO on the LAN MCU rather than sharing
one. A new GPIO controls a USB bus switch that routes the shared USB lines to one adapter
or the other.

The IO expander control signals also moved on the WAN MCU side, and the pins used to
control the LTE modem's power and reset lines changed within the IO expander pin map.

### 5.2 Tasks Already Completed

Three tasks from the adaptation plan are already done. The SPI communication pins between
the WAN MCU and LAN MCU were verified to be unchanged in the new design, so no firmware
changes were needed there. The interrupt, reset, and data-ready signal pins were similarly
confirmed. The UART communication path between the two MCUs was also confirmed unchanged.

### 5.3 Tasks Still in Progress

The most foundational change needed is migrating the TCA driver from TCA6424A to
TCA6416A. The two chips are similar in concept but have different register addresses for
their output and configuration registers. Every firmware layer that currently calls
TCA_PORT_2 will fail because that port does not exist on the new chip. The driver rewrite
must also be made instance-based rather than singleton to allow two independent expander
chips to coexist.

On the WAN MCU, the stack handler needs to be updated to use a new 16-pin GPIO enum that
maps directly to the physical port and pin numbers on the TCA6416A. The old naming
convention of STACK_GPIO_PIN_1 through STACK_GPIO_PIN_11 plus separate WAKE and PERST
names is being replaced by a flat enumeration from P00 through P17 corresponding directly
to the expander pins. A new hardware detection routine must read the lower four bits of
Port 0 on the expander to determine the installed module's hardware address, replacing the
current hardcoded pseudo-identifier.

The LTE modem control functionality must also be updated. The firmware currently treats
pin 11 as the power control signal and pin 12 as the reset control signal for the modem.
In the new hardware layout, the modem's wake pin is at P05 and the reset pin is at P06.
The configuration command parser must be updated to recognize the new pin labels, and the
stored LTE configuration in flash will need migration logic to handle devices that still
have the old pin numbers saved from before the board update.

On the LAN MCU, the stack handler requires a complete architectural revision. The new
design requires maintaining two separate TCA driver instances, one for each adapter slot.
The initialization routine must scan the I2C bus, identify each expander by its address,
read a slot detection pin to determine which physical slot each expander belongs to, and
then read the four address pins to determine the stack identifier. Only after this process
is complete can the firmware know which module is in which slot and load the appropriate
configuration from NVS.

Work is also needed on the LAN2 adapter UART pin assignments, the adapter SPI bus pin
assignments, the USB switch control GPIO, and a verification pass on the SD card pin
assignments to check whether any of them conflict with the new UART pin moves.

The power source handler on the WAN MCU, which currently controls three power rails
through TCA6424A Port 1, must be redesigned once the hardware team clarifies how power
rail control is handled in the new board revision. Similarly, the UART switch mechanism
that routes the WAN MCU's UART between a display module and the LAN MCU is a new feature
in the hardware design that has no corresponding firmware implementation yet.

---

## Summary

This report has described five areas of work carried out since the previous project
review. The JSON-based Module Base Setting system and the embedded web configuration
portal are both implemented and have been tested on real hardware. These two features
significantly improved the flexibility and usability of the gateway compared to the
earlier version. The native BLE Mesh provisioner implementation and the Tuya E27
test application are complete at the code level but have not yet been tested on hardware
due to scheduling constraints. The new board adaptation work is underway with three tasks
completed but the majority of the work still to be done, with the most critical dependency
being the TCA6416A driver migration which unblocks all other hardware adaptation tasks.

The overall system has grown considerably in both capability and complexity compared to
the initial version. The firmware now supports four different RF module protocols through
a unified JSON-driven interface, provides both UART and browser-based configuration,
handles automatic module detection at boot, and maintains all configuration persistently
across power cycles. The architecture is designed so that adding support for a new module
type in the future requires writing a JSON configuration file and, at most, adding a new
parser for that module type, without modifying any of the core routing or lifecycle
management code.

---

End of Report
