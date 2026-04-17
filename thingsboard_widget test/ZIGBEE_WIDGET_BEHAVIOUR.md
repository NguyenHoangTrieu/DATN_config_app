# Zigbee Widget Behaviour Specification

> Files: `zigbee_control_widget_v2.{html,css,js}`  
> Protocol: `CFML:CFZB:<slot>:<FUNCTION_NAME>[:<params>]` hex-encoded via `sendCommand` RPC  
> Async events: pushed by gateway firmware via ThingsBoard telemetry (key `data`)

---

## 1. Design Principles (Anti-Bug Rules)

These rules were derived from the disconnect bug in `ble_gatt_multi_widget.js` where UI cleanup only happened via async telemetry. They apply to **all** DA2 gateway widgets.

| Rule | Rationale |
|---|---|
| **Always handle state changes in `.then(resp)`** | On LAN, the RPC return value IS the event. Telemetry is a secondary/redundant path. |
| **Never rely solely on async telemetry for cleanup** | Over WAN (MQTT relay), telemetry can be delayed or dropped entirely. |
| **Optimistic UI update on user action; revert in `.catch()`** | Makes the UI feel responsive and fails gracefully. |
| **All cleanup functions must be idempotent** | They may be called from both the inline path and the telemetry path. Use `if (!state.nodes[addr]) return;` guards. |
| **Capture mutable state before async gap** | Capture `var capturedAddr = state.selectedNode;` before `enqueue(...)` to avoid closures reading stale state. |

---

## 2. Widget State Machine

### 2.1 Network State

```
        ┌─────────────────────────────────────────────────────┐
        │                                                     │
  [OFF] ─── startNetwork() ──→ [starting] ───+EVT:CREATENW:0─→ [ON]
   ↑                                   │                        │
   │                          timeout / error                   │
   │                                   ↓                        │
   └───────────────── stopNetwork() ─────────────────────────── ┘
```

States: `off` | `starting` | `on`  
UI element: `#net-badge[data-state]`, `#status-pill[data-state]`, `#status-text`

### 2.2 Node Lifecycle

```
  (not in list)
       │
       ├── JOIN event (telemetry) ──→ addNode() ──→ renderNodeList()
       │
       ├── FIND response (inline RPC) ──→ addNode() ──→ renderNodeList()
       │
       ↓
  [node in list] ─── selectNode() ──→ [selected + control panel visible]
       │
       ├── LEAVE event (telemetry) ──→ delete state.nodes[addr] ──→ renderNodeList()
       │
       └── deleteNode() RPC ──→ delete state.nodes[addr] ──→ renderNodeList()
```

---

## 3. User Action Behaviour Table

### 3.1 `startNetwork()` — Start button

| Step | What happens |
|---|---|
| User clicks ▶ Start | Immediately: `setNetState('starting')` → UI shows "Starting…" |
| RPC sent | `CFML:CFZB:<slot>:MODULE_START_NETWORK` (timeout 15 000 ms) |
| Response contains `+CREATENW:0` or `NETWORK UP` | `setNetState('on')` → UI shows "Network ON" |
| Response contains nothing valid | `setNetState('off')` → UI shows "OFF" + toast "Start failed" |
| `.catch()` | `setNetState('off')` |

**Edge case**: If firmware returns `OK` without `+CREATENW:0`, the widget incorrectly sets state `off`. Consider treating any non-error response as success in future.

---

### 3.2 `stopNetwork()` — Stop button

| Step | What happens |
|---|---|
| User clicks ■ Stop | RPC sent immediately — no optimistic update |
| `.then()` | `setNetState('off')`, clear `#net-info-bar` to "—", toast "Network stopped" |
| `.catch()` | *(no action)* — **BUG**: UI stays at `on` if RPC fails. Should call `setNetState('off')` anyway. |

---

### 3.3 `openPermitJoin()` — Join button (⚡)

| Step | What happens |
|---|---|
| User clicks ⚡ Join | RPC: `MODULE_SET_PERMIT_JOIN:60` (60 s permit window) |
| `.then()` | Toast: "Permit join: 60 s — waiting for nodes…" |
| New device joins | Async `JOIN:<short4>,<ieee16>,<type>` event via telemetry → `addNode()` |
| Permit window expires | Firmware sends no notification — widget just stops seeing JOINs |
| `.catch()` | *(no action)* |

---

### 3.4 `autoFind()` — Find button (⊕)

| Step | What happens |
|---|---|
| User clicks ⊕ Find | RPC: `MODULE_AUTO_FIND_TARGET` (timeout 5 000 ms) |
| `.then()` | Toast "Finding… nodes will appear when discovered"; if a node is selected, calls `bindSelectedNode()` |
| Async `FIND:<short>,<ieee>` event arrives via telemetry | `handleAsyncEvent()` → `addNode()` → `renderNodeList()` |
| `FIND:ADDR=<short>` in RPC response (inline) | `handleAsyncEvent()` also handles this in `logCFMLResponse()` |
| `.catch()` | *(no action)* |

**Important**: AT+FIND returns `OK` immediately. The actual `FIND:<addr>,<ieee>` results can arrive:
- **Inline** in the RPC response (via `logCFMLResponse` which calls `handleAsyncEvent`)
- **Async** via `onDataUpdated` telemetry path

Both paths call `addNode()` which is idempotent (overwrites by key `short`).

---

### 3.5 `selectNode(short)` — Click a node in the list

| Step | What happens |
|---|---|
| User clicks a node item | `state.selectedNode = short`, `state.shortAddr = short` |
| | `renderNodeList()` — highlights selected |
| | `updateControlPanel()` — shows hero info, removes overlay, shows Del button |
| | `saveLocalState()` — persists selection |

No RPC is sent. All pending RPC calls will use `getTarget()` which reads `state.shortAddr`.

---

### 3.6 `deleteNode()` — Delete button (✕)

| Step | What happens |
|---|---|
| User clicks ✕ | Overlay shown: `#ctrl-overlay.hidden` removed + spinner |
| RPC sent | `MODULE_DELETE_NODE:<short>` (timeout 15 000 ms) |
| `.then()` | `delete state.nodes[addr]`, `state.selectedNode = null`, `renderNodeList()`, `updateControlPanel()`, `saveLocalState()`, toast "Node removed" |
| `.catch()` | **BUG**: overlay is not hidden. Fix: add `ge('ctrl-overlay').classList.add('hidden')` |

---

### 3.7 `bindSelectedNode()` — Auto-called by autoFind or manually

| Step | What happens |
|---|---|
| Called | RPC 1: `AT+DSTADDR=<short>` (3 000 ms), then RPC 2: `AT+DSTEP=<ep>` (3 000 ms) |
| `.then()` | `logOk('DSTADDR set …')`, toast "Bound to 0x… ✓" |
| `.catch()` | *(no action)* |

---

### 3.8 `onOnOffToggle(checked)` — On/Off toggle

| Step | What happens |
|---|---|
| User toggles | Guard: if no `state.selectedNode`, revert toggle + toast |
| Optimistic UI update | `setEl('onoff-status-text', …)`, update icon wrapper |
| RPC sent | `AT+TURNON` or `AT+TURNOFF` (5 000 ms) |
| `.catch()` | Fallback: `MODULE_ZCL_SEND_CONTROL_CMD:<s>,<ep>,0006,<01|00>` |

**Note**: No revert of optimistic toggle on failure — both paths are fire-and-forget.

---

### 3.9 `onLevelChange(v)` — Level slider

| Step | What happens |
|---|---|
| User moves slider | `refreshLevelSlider()` immediately (CSS gradient update) |
| `onLevelChange()` fires on `onchange` | RPC: `MODULE_ZCL_SEND_CONTROL_CMD:<s>,<ep>,0008,04,<lvlHex>,0001` (15 000 ms) |
| `.catch()` | *(no action)* |

**Tip**: Slider fires on `onchange` (mouse up), not `oninput`, so rapid moves don't flood the queue. Good pattern.

---

### 3.10 `sendFixedColor(hexStr)` — Color button

| Step | What happens |
|---|---|
| Guard | If `!state.selectedNode`, toast "Select a node first"; return |
| Optimistic UI | Update `#color-preview` background + `#color-hex-label` + mark button active |
| RPC sent | `MODULE_ZCL_SEND_CONTROL_CMD:<s>,<ep>,0300,08,<xH>,<yH>,000A` (15 000 ms) |
| `.then()` | Toast "Color sent ✓" |
| `.catch()` | *(no action, preview stays updated)* |

---

### 3.11 `readTempAttr()` — Read temperature button

| Step | What happens |
|---|---|
| Guard | `!state.selectedNode` → toast "Select a node first"; return |
| RPC sent | `MODULE_ZCL_READ_ATTR:<s>,<ep>,0402,0000` (15 000 ms) |
| `.then(r)` | Parse `+ATTRREAD:…,<hex>` → divide by 100 → `setEl('temp-val', …)` |
| Async attribute report | `RPT:<s>,<ep>,0402,0000,…,<hex>` → `handleAttrReport()` → same `setEl('temp-val',…)` |
| `.catch()` | *(no action)* |

---

## 4. Async Event Handling

All async events from the firmware arrive via `onDataUpdated → handleAsyncEvent(line)`.

| Event line pattern | Handler action |
|---|---|
| `JOIN:<s4>,<ieee16>,<type>` | `addNode(short, ieee, type)` → `renderNodeList()` |
| `NODE:<s4>,<ieee16>` | `addNode(short, ieee, '?')` → `renderNodeList()` |
| `FIND:<s4>,<ieee16>` | `addNode(short, ieee, '?')` → `renderNodeList()` |
| `FIND:ADDR=<short>` | `setFoundNode(short, '')` (zigbee_rgb_widget only) |
| `FIND:MISS` | `showFindMiss()` (zigbee_rgb_widget only) |
| `+NWINFO:<data>` | `setEl('net-info-bar', data)`, `setNetState('on')` |
| `LEAVE:<s4>` | `delete state.nodes[gone]`, clear selection if needed, `renderNodeList()` |
| `RPT:<s>,<ep>,<cluster>,<attr>,<type>,<val>` | `handleAttrReport()` → updates on/off toggle, level slider, or temp display |
| `RSP:<…>` | `logOk('ZCL response: …')` only |

---

## 5. LocalStorage Persistence

Key: `zb_gw_state_v1`

Persisted fields:
- `slot` — stack slot (0 or 1)  
- `nodes` — all discovered nodes `{ short: { ieee, type, ep } }`  
- `selectedNode` — last selected short address  
- `cluster` — last selected cluster  
- `networkUp` — boolean  
- `onOffState`, `levelVal` — last ZCL state  

Loaded on `onInit` → `loadLocalState()`.  
Saved after every state change via `saveLocalState()`.

**Security note**: Node addresses loaded from localStorage are displayed via `escapeHtml()` — no XSS risk.

---

## 6. Known Bugs / Recommendations

| Location | Bug | Fix |
|---|---|---|
| `stopNetwork()` `.catch()` | UI stays `on` if RPC fails | Call `setNetState('off')` in catch |
| `deleteNode()` `.catch()` | Overlay spinner never hidden | Add `ge('ctrl-overlay').classList.add('hidden')` in catch |
| `onOnOffToggle()` | Toggle not reverted on both-path failure | Store pre-action value, restore in catch of fallback |
| `sendFixedColor()` | `document.querySelectorAll('.btn-color')` — not scoped to `_root` | Change to `_root.querySelectorAll('.btn-color')` |
| `handleAsyncEvent()` | No handler for `LEAVE` event updating selectedNode hero UI | After `delete state.nodes[gone]` + `renderNodeList()`, also call `updateControlPanel()` |
