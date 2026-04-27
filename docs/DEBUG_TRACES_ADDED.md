# Disconnect Retry Debug Trace Points Added

## Summary
Complete instrumentation added to diagnose why AT+DISCONNECT with BUSY status doesn't retry properly. The traces will show the full path from BUSY → timer arm → callback fire → task wake → retry execution.

---

## Trace Point Locations

### 1. **Initial Disconnect BUSY (ble_connection.c, ~line 335)**
```
[INFO] hci_disconnect BUSY (0x01): hdl=0x0801, timer_id=1, ticks=410
[INFO] Before HW_TS_Start: hdl=0x0801 pending_hdl=0x0801 retry_count=0
[INFO] HW_TS_Start returned: 0 (0=success,1=ok_already_running,2=error)
[INFO] Disconnect retry armed: pending_hdl=0x0801 retry_count=0 disc_retry_pending=0
```
**What it tells you:**
- Timer ID assigned
- HW_TS_Start return code (CRITICAL: should be 0 for success)
- pending_disc_handle set correctly
- disc_retry_pending should still be 0 at this point (ISR hasn't fired yet)

---

### 2. **Timer Callback Fires (ble_connection.c, ~line 70)**
```
[INFO] DiscRetry_Callback FIRED: timer_id=1 pending_hdl=0x0801 retry_count=0 disc_retry_pending_before=0
[INFO] DiscRetry_Callback SET FLAG: disc_retry_pending now=1
[INFO] DiscRetry_Callback: calling AT_ScheduleTask to wake sequencer
[INFO] DiscRetry_Callback: AT_ScheduleTask completed
```
**What it tells you:**
- Did the ISR callback fire? (Wait 400+ ms, should see this line)
- Flag set correctly (1)
- Task scheduling call completed

**⚠️ If you DON'T see these lines:** 
- HW timer system not firing callbacks → hardware timer problem
- CPU core might be in low-power mode

---

### 3. **AT Sequencer Task Woken (at_command.c, ~line 412)**
```
[INFO] [AT_ProcessReady] Task entry - will check retry then other work
[INFO] AT task: disconnect retry path executed - early return
```
**What it tells you:**
- Did the task actually run after the callback?
- Did BLE_Connection_ProcessRetry() execute?

---

### 4. **Retry Execution Attempt (ble_connection.c, ~line 167)**
```
[INFO] Disconnect retry #1/5 (task ctx): hdl=0x0801 timer_id=1 pending_state=0
[INFO] Before hci_disconnect: retry_count=1 max=5 handle=0x0801
[INFO] hci_disconnect returned: 0x02 (0=success, 0x01=busy)
```
**What it tells you:**
- Retry number / max count
- Return code from HCI (0x02 = error, 0x01 = still busy, 0x00 = success)

---

### 5. **BUSY Retry Rescheduling (ble_connection.c, ~line 186)**
```
[INFO] hci_disconnect BUSY on retry #1/5 - rescheduling timer_id=1 ticks=410
[INFO] Before re-arm: pending_hdl=0x0801 disc_retry_pending=0
[INFO] HW_TS_Start re-arm returned: 0 pending_state_after=0
```
**What it tells you:**
- Is on retry N < MAX (good, will keep trying)
- HW_TS_Start again returns success
- pending handle survives across retries

---

### 6. **Timer Fires Again (ble_connection.c, ~line 70)**
Loop back to trace point #2 — should see:
```
[INFO] DiscRetry_Callback FIRED: timer_id=1 pending_hdl=0x0801 retry_count=1 disc_retry_pending_before=0
```
**Expected pattern for multiple retries:**
- Retry #1: BUSY → reschedule
- ~200ms wait
- Retry #2: BUSY → reschedule
- ~200ms wait
- Retry #3: SUCCESS or EXHAUSTED

---

### 7. **Success or Forced Clear (ble_connection.c, ~line 178 or 195)**
**If SUCCESS:**
```
[INFO] Disconnect retry accepted by HCI - waiting for DISCONNECTION_COMPLETE event
```
Then later:
```
[DEBUG] Event: Disconnection Complete - handle=0x0801, reason=0x16
```

**If RETRIES EXHAUSTED:**
```
[INFO] Disconnect retry exhausted (err=0x02 after 5 tries) - force-clearing
[INFO] disc_force_clear: hdl=0x0801 retry_count=5
```

---

## Diagnosis Checklist

Use these traces to narrow down the problem:

- [ ] **See BUSY line?** → Yes = code path works
- [ ] **See DiscRetry_Callback FIRED?** → No = **timer not firing** (hardware/RTC issue)
- [ ] **See AT_ProcessReady entry?** → No = **task not waking** (sequencer issue)
- [ ] **See retry #N line?** → No = **BLE_Connection_ProcessRetry not entering** (flag not set)
- [ ] **See hci_disconnect returned: 0x00?** → Yes = **success, wait for DISCONNECTION_COMPLETE**
- [ ] **See force-clear after 5 tries?** → Yes = **CPU2 won't accept disconnect** (firmware issue)

---

## Next Steps if Stuck

1. **Timer not firing:** Check RTC timer interrupt handler, check CFG_HW_TS_MAX_NBR_CONCURRENT_TIMER
2. **Task not waking:** Check UTIL_SEQ_SetTask return, check if sequencer is initializing
3. **Retries stop:** Check if another code path overwriting pending_disc_handle
4. **CPU2 won't disconnect:** May need to send AT+DISC before AT+CHARS, then wait longer before AT+DISCONNECT

