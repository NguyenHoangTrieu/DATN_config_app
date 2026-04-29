# ThingsBoard Widget Button Event Delegation Test Guide

**Date**: 2024  
**Widgets**: `total_application_test_control.js/html` + `total_application_test_monitor.js/html`  
**Issue Fixed**: Buttons not responding due to ThingsBoard widget framework not executing inline `onclick=` handlers

## Technical Background

### Problem
ThingsBoard 4.x custom widget framework does not reliably execute inline `onclick=` handler attributes. All button clicks are silently ignored.

### Solution
Event delegation pattern using `addEventListener('click', ...)` on the root container, dispatching actions via `data-action` and `data-param` HTML attributes instead of inline handlers.

### How It Works
```html
<!-- OLD (not working in TB): -->
<button onclick="bleScan()">Scan</button>

<!-- NEW (working in TB): -->
<button data-action="scan">Scan</button>
```

```javascript
// In control.js onInit():
root.addEventListener('click', function(evt) {
  var action = evt.target.getAttribute('data-action');
  if (action === 'scan') { bleScan(); }  // etc.
});
```

## Pre-Test Checklist

- [ ] Both widget files deployed to ThingsBoard dashboard
- [ ] ThingsBoard dashboard is open and widgets are visible
- [ ] Browser DevTools console is open (F12)
- [ ] Clear console before testing

## Test Procedure

### 1. Verify Event Delegation Loading

**Expected**: No errors on widget init

```javascript
// In browser console, you should see:
[TAT] Widget ready — slot 0
```

**Action**: 
- Open DevTools console
- Refresh the dashboard
- Look for `[TAT]` log messages
- **PASS**: If you see "Widget ready" without errors
- **FAIL**: If you see "[TAT] error" or JS errors

---

### 2. Test Tab Switching (3 tabs)

**BLE Tab**:
1. Click the "BLE" tab button
2. Console should show: `[TAT] Tab switched to ble`
3. Content area should show BLE section (Scan button, connected devices list)
4. **PASS** if tab switches and console logs correctly

**Zigbee Tab**:
1. Click the "Zigbee" tab button
2. Console should show: `[TAT] Tab switched to zb`
3. Content area should show Zigbee section (Start/Stop/Join/Find buttons, node list)
4. **PASS** if tab switches and console logs correctly

**LoRa P2P Tab**:
1. Click the "LoRa P2P" tab button
2. Console should show: `[TAT] Tab switched to lora`
3. Content area should show LoRa section (Test Mode button, RX window, LED controls)
4. **PASS** if tab switches and console logs correctly

---

### 3. Test BLE Panel Buttons

**Scan Button**:
1. Ensure you're on BLE tab
2. Click "🔍 Scan" button
3. Console should show: `[TAT] Sending RPC: CFML:CFBG:SCAN`
4. **PASS** if RPC is queued and sent

**Color Buttons (5x)**:
1. On BLE tab, scroll to "LED Control" section
2. Click any color button (Red/Green/Blue/Yellow/White)
3. Console should show: `[TAT] Sending RPC: CFML:CFBG:LED:<HEX_COLOR>`
4. **PASS** if RPC is sent for each color

**LED ON/OFF**:
1. Click "💡 ON" button
2. Console should show: `[TAT] Sending RPC: CFML:CFBG:LED_ON`
3. Click "⭕ OFF" button
4. Console should show: `[TAT] Sending RPC: CFML:CFBG:LED_OFF`
5. **PASS** if both buttons send correct RPCs

**Apply Interval**:
1. Change interval value in BLE Sensor section (e.g., to 5000 ms)
2. Click "Apply Interval" button
3. Console should show: `[TAT] Sending RPC: CFML:CFBG:INTERVAL:...`
4. **PASS** if RPC is sent with interval value

**Disconnect Button**:
1. Ensure a device is simulated as connected (or create mock data)
2. Click "Disconnect ✕" button
3. Console should show: `[TAT] Sending RPC: CFML:CFBG:DISCONNECT:...`
4. **PASS** if disconnect RPC is sent

---

### 4. Test Zigbee Panel Buttons

**Start Network**:
1. Go to Zigbee tab
2. Click "▶ Start" button
3. Console should show: `[TAT] Sending RPC: CFML:CFZB:START`
4. **PASS** if Start RPC is sent

**Stop Network**:
1. Click "⬛ Stop" button
2. Console should show: `[TAT] Sending RPC: CFML:CFZB:STOP`
3. **PASS** if Stop RPC is sent

**Permit Join**:
1. Click "★ PJ 180s" button
2. Console should show: `[TAT] Sending RPC: CFML:CFZB:PERMIT_JOIN:180`
3. **PASS** if PermitJoin RPC is sent

**Find Devices**:
1. Click "⊙ Find" button
2. Console should show: `[TAT] Sending RPC: CFML:CFZB:FIND_DEVICES`
3. **PASS** if Find RPC is sent

**Reset State**:
1. Click "↺ Reset State" button
2. Console should show: `[TAT] Sending RPC: CFML:CFZB:RESET_STATE`
3. **PASS** if Reset RPC is sent

**Bulb Control (with mock node)**:
1. If a Zigbee node exists in the node list, select it
2. Click "💡 ON" button
3. Console should show: `[TAT] Sending RPC: CFML:CFZB:...ON`
4. Click "⭕ OFF" button
5. Console should show: `[TAT] Sending RPC: CFML:CFZB:...OFF`
6. **PASS** if bulb commands are sent

**Brightness Levels**:
1. Click brightness preset buttons (0%, 25%, 50%, 75%, 100%)
2. Console should show: `[TAT] Sending RPC: CFML:CFZB:...LEVEL:...`
3. **PASS** if level commands are sent

**Bulb Colors**:
1. Click color buttons (Red/Green/Blue/White)
2. Console should show: `[TAT] Sending RPC: CFML:CFZB:...COLOR:...`
3. **PASS** if color RPCs are sent

**Sensor Readings**:
1. Click "🔄 Read Temp" button
2. Console should show: `[TAT] Sending RPC: CFML:CFZB:...TEMP`
3. Click "🔄 Read Humidity" button
4. Console should show: `[TAT] Sending RPC: CFML:CFZB:...HUM`
5. **PASS** if sensor read RPCs are sent

**Delete Node**:
1. If a node is selected, click "Delete ✕" button
2. Console should show: `[TAT] Sending RPC: CFML:CFZB:DELETE_NODE:...`
3. **PASS** if delete RPC is sent

---

### 5. Test LoRa P2P Panel Buttons

**Enter Test Mode**:
1. Go to LoRa P2P tab
2. Click "⚡ Enter TEST Mode" button
3. Console should show: `[TAT] Sending RPC: CFML:CFLR:MODE:TEST`
4. **PASS** if mode command is sent

**Apply RF Config**:
1. Modify RF parameters (Freq, BW, SF, etc.)
2. Click "📡 Apply RF Config" button
3. Console should show: `[TAT] Sending RPC: CFML:CFLR:RF_CONFIG:...`
4. **PASS** if RF config RPC is sent

**Start RX**:
1. Click "▶ Start RX" button
2. Console should show: `[TAT] Sending RPC: CFML:CFLR:RX:START`
3. **PASS** if Start RX RPC is sent

**Stop RX**:
1. Click "⬛ Stop RX" button
2. Console should show: `[TAT] Sending RPC: CFML:CFLR:RX:STOP`
3. **PASS** if Stop RX RPC is sent

**Read Info**:
1. Click "▼ Read Info" button
2. Console should show: `[TAT] Sending RPC: CFML:CFLR:READ_INFO`
3. **PASS** if read info RPC is sent

**LED Control**:
1. After successful JOIN handshake (simulated), "💡 LED ON" button should enable
2. Click "💡 LED ON" button
3. Console should show: `[TAT] Sending RPC: CFML:CFLR:LED:ON`
4. Click "⭕ LED OFF" button
5. Console should show: `[TAT] Sending RPC: CFML:CFLR:LED:OFF`
6. **PASS** if LED commands are sent

---

### 6. Test Monitor Widget Filter Buttons

**Filter Chips**:
1. In the Monitor widget (if visible), look for filter buttons: "All / BLE / Zigbee / LoRa"
2. Click "Zigbee" chip
3. Monitor should filter and show only Zigbee devices
4. Click "All" chip
5. Monitor should show all devices again
6. **PASS** if filters work correctly

**Clear Button**:
1. Click "↺ Clear" button in monitor footer
2. Monitor should clear all device cards
3. **PASS** if cards are cleared

---

### 7. Console Log Audit

**Expected Patterns** (all actions should log to console):
```
[TAT] Tab switched to <tab>
[TAT] Sending RPC: CFML:...
[TAT] Error: ... (if any error occurs)
[TATM] Monitor event received
```

**Failure Detection**:
- If you see `[TAT] Action error: <action> - ...`, there's an issue with that action handler
- If you see no logs at all when clicking buttons, event delegation is not working
- If you see browser errors (red text), there's a JavaScript syntax error

---

## Troubleshooting

### All buttons are unresponsive

1. Check browser console for JavaScript errors
2. Verify HTML has `data-action` attributes (view page source)
3. Verify CSS shows no errors
4. Try refreshing the dashboard
5. Check if browser DevTools has script breakpoints enabled

### Some buttons work, others don't

1. Check if the non-working button has `data-action` attribute in HTML
2. Check if the action name is spelled correctly in JS handler (case-sensitive)
3. Look for "[TAT] Action error" in console with the action name
4. Verify JS event delegation handler is loaded (search for "addEventListener" in control.js)

### RPC commands not being sent

1. Verify device is selected (for device-specific commands)
2. Check ThingsBoard RPC queue in "Device Details → RPC"
3. Verify gateway device is configured correctly
4. Check if controlApi is available (TB console: `console.log(self.ctx.controlApi)`)

---

## Success Criteria

**PASS** if:
- [ ] All 30 button actions respond when clicked
- [ ] Console logs show [TAT] messages for each action
- [ ] RPC commands are queued in ThingsBoard
- [ ] No "[TAT] error" messages appear
- [ ] No JavaScript errors in console
- [ ] Tab switching is smooth
- [ ] Monitor filter buttons work
- [ ] Clear button clears devices

**FAIL** if:
- [ ] Any button is unresponsive
- [ ] "Action error" appears in console
- [ ] JavaScript errors appear
- [ ] RPCs are not sent

---

## Summary

This test validates that the event delegation pattern is correctly implemented for all 30+ button actions across both control and monitor widgets. The key difference from the old implementation is that buttons now use `data-action` attributes instead of inline `onclick=` handlers, which is required for ThingsBoard widget framework compatibility.
