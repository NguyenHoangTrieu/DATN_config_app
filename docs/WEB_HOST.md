## Embedded Web Server

A web server is a program that listens for incoming HTTP requests and sends back responses — typically HTML pages, JSON data, or files. On a full computer, this is software like Nginx or Apache running on an OS. On a microcontroller like ESP32, the same concept is implemented at a much smaller scale using a lightweight HTTP server library (ESP-IDF's `esp_http_server`). The device listens on port 80, and when a browser makes a request to its IP address, the MCU handles the request directly in firmware — no operating system, no file system required. Every URL the device responds to is called an **endpoint** or **route**, and each one is mapped to a handler function in C/C++ code.

## Captive Portal

A captive portal is a technique where a network intercepts all outgoing traffic from a newly connected client and forces the browser to display a specific page before allowing normal network access. The mechanism relies on two components working together: a **DNS server** and an **HTTP server**.

When your phone connects to a WiFi network, it immediately sends a DNS query to resolve some known domain (like `connectivitycheck.google.com` on Android, or `captive.apple.com` on iOS) to verify internet access. In a captive portal, the local DNS server intercepts this query and returns the device's own IP address instead of the real internet IP. The browser then makes an HTTP request to that IP, lands on the config page, and the OS displays the "Sign in to network" popup automatically.

On ESP32, you run a minimal DNS server alongside the HTTP server. The DNS server responds to every query — regardless of what domain was asked — with the ESP32's own IP address (`192.168.4.1` by default in AP mode). This way, whatever URL the user or OS tries to reach, they always end up on your config page.

## WiFi AP Mode vs STA Mode

ESP32 can operate in three WiFi modes. In **AP (Access Point) mode**, it creates its own WiFi network — it becomes the router. Devices connect to it, and it assigns them IP addresses via a built-in DHCP server. In **STA (Station) mode**, it joins an existing WiFi network like any normal device — a phone, laptop, etc. — and gets an IP from the network's router. In **AP+STA mode**, it does both simultaneously.

For a gateway config flow, the standard pattern is: start in AP mode for initial configuration (so the user can always reach the device even without existing network credentials), then switch to STA mode after credentials are saved. If STA connection fails (wrong password, network unavailable), the device falls back to AP mode again so the user can reconfigure.

## mDNS / Zeroconf / Bonjour

On a local network, devices get IP addresses dynamically from a DHCP server, meaning the IP can change after every reboot. This makes it inconvenient to remember the device's address. **mDNS (Multicast DNS)** solves this by allowing devices to register a human-readable hostname (e.g., `gateway.local`) on the local network without needing a central DNS server. The device broadcasts its hostname and IP over multicast UDP, and any client on the same network that queries for `gateway.local` receives the current IP automatically.

This is the same technology Apple calls **Bonjour** and the broader standard is called **Zeroconf**. On Arch Linux, it is handled by `avahi-daemon`. On Windows and macOS, it works out of the box. For the user, the experience is simple: instead of finding the IP address, they just type `http://gateway.local` in a browser and always reach the device.

## Static File Embedding

When you write C code and compile it, the compiler produces a binary that contains your code and any constant data. ESP-IDF has a mechanism (`EMBED_TXTFILES` / `EMBED_FILES` in CMake) that takes arbitrary files — HTML, CSS, JavaScript — and converts them into byte arrays that are compiled directly into the firmware binary. At runtime, these files live in the MCU's flash memory and are accessed as regular C pointers. The HTTP server reads from these pointers and sends the content to the browser.

The advantage is simplicity: there is no filesystem to mount, no partition to manage separately, and the web files are always in sync with the firmware version. The disadvantage is that updating the web UI requires reflashing the entire firmware.

## SPIFFS and LittleFS

These are **filesystems designed for NOR flash memory** on microcontrollers. Instead of embedding web files into the firmware binary, you allocate a dedicated partition of the ESP32's flash memory and format it with SPIFFS or LittleFS. You then copy your HTML/CSS/JS files into this partition as actual files with paths like `/web/index.html`.

At runtime, the ESP32 mounts this filesystem and the HTTP server reads files from it the same way a desktop server reads files from disk. The major advantage is that you can update the web UI independently from the firmware — flash only the filesystem partition without touching the application code. LittleFS is generally preferred over SPIFFS for new projects because it handles power-loss corruption better and has more predictable wear leveling.

## Single-Page Application (SPA)

Traditionally, every time you navigate to a new page on a website, the browser makes a new HTTP request and receives a completely new HTML document. For a config portal on an embedded device, this is inefficient — the MCU has to handle many requests and serve large files repeatedly.

A Single-Page Application loads **one HTML file once**, and from that point all navigation and content updates happen entirely in JavaScript without ever requesting a new page from the server. When the user clicks between tabs or submits a form, JavaScript intercepts the action, makes a small data request to the device's API, receives a compact JSON response, and updates only the relevant part of the page. The MCU only handles small JSON exchanges after the initial page load, which is far more efficient.

## REST API

REST (Representational State Transfer) is a convention for designing HTTP endpoints that exchange data in a predictable, structured way. For an embedded gateway, the web UI (running in the browser) and the firmware (running on the MCU) are two separate programs that communicate over HTTP using JSON.

The UI never directly manipulates hardware — it only makes HTTP requests to defined endpoints. For example: `GET /api/status` returns a JSON object with current device state, `GET /api/config` returns saved configuration, `POST /api/config` accepts a JSON body and saves new configuration to NVS. This clean separation means you can completely redesign the web UI without touching firmware logic, and vice versa, as long as the API contract stays the same.

## NVS (Non-Volatile Storage)

NVS is ESP-IDF's built-in key-value storage system that persists data across reboots and power cycles. It lives in a dedicated flash partition and stores data as typed key-value pairs — strings, integers, blobs. For a config portal, every setting the user submits (WiFi credentials, MQTT broker address, device name, polling intervals) gets written to NVS. On boot, the firmware reads these values back and uses them to initialize all subsystems. NVS also handles wear leveling internally, distributing writes across flash pages to extend the partition's lifespan.

## Frontend Build Pipeline

Modern JavaScript development uses a **build pipeline** — a toolchain that transforms human-readable source code into optimized output for deployment. The source code is written using modern syntax, component frameworks (React, Preact, Vue), and modular imports split across many files. The build tool (Vite, Webpack, Parcel) bundles all these files together, removes unused code (tree-shaking), minifies variable names and whitespace, and compresses the output.

For embedded targets specifically, a plugin like `vite-plugin-singlefile` takes this a step further by **inlining all JavaScript and CSS directly into the HTML file**, producing a single self-contained `.html` file. This is ideal for embedding into firmware — one file to manage, one pointer in C, and the browser receives everything in a single HTTP response. The development experience uses a live-reload dev server against mock API endpoints, and only the final build output gets embedded into the firmware.