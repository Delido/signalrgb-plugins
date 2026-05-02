# Corsair Headset Controller — Fork Notes

Documents the deltas in [`Corsair_Headset_Controller.js`](Corsair_Headset_Controller.js) against the upstream reference at:

<https://gitlab.com/signalrgb/signal-plugins/-/blob/Development/Plugins/Corsair/Modern_Corsair/Corsair_Headset_Controller.js?ref_type=heads>

Tested on: Corsair Virtuoso XT Wireless (USB VID `0x1B1C`, PID `0x0A64`), Windows 11, SignalRGB latest stable, Software Mode active.

The fork adds two user-facing features and tightens several runtime behaviors to reduce idle wireless traffic and to fix a mic-mute-LED bug. None of the changes alter the device-detection table or the supported-PID list — any headset the upstream plugin recognizes still works.

---

## New user-facing settings

### `Low Battery LED Cutoff (%)`

A number setting (`0`–`100`, default `15`). When the battery falls below this threshold and the headset is *not* charging, the plugin sends one black frame and stops issuing further `sendColors()` calls until the battery rises back above the threshold. `fetchStatus` and `fetchBattery` keep running so the SignalRGB battery indicator continues to update.

Charging bypass: a battery status of `Charging` (`0x01`) or `Fully Charged` (`0x03`) keeps the LEDs on regardless of the threshold. Power conservation isn't a concern when external power is supplied.

Set to `0` to disable the cutoff entirely.

Implementation: tracked via `Config.lastBatteryLevel`, `Config.lastBatteryStatus`, `Config.inLowBatteryMode`. Decision made in `Render()` per frame after the battery reading.

---

## Runtime behavior changes

### RGB dirty-flag with 1 s heartbeat

Upstream sends the full color packet every render frame (~30/s) regardless of whether anything changed. The fork hashes `RGBData` into a string key and skips `writeRGB()` if the key matches the previous frame **and** less than `rgbHeartbeatMs` (default 1000 ms) has passed since the last write.

Effect: a static effect (e.g. Solid Color) drops from ~30 USB writes/s down to 1/s. The 1 s heartbeat is a deliberate safety net so a mute-LED state change that happens to coincide with a constant-color background still recovers within one second even if the upstream parser missed an interim event.

Override colors (e.g. the `#000000` shutdown frame) bypass the dirty-flag check.

### Mic-status poll — interval, drain loop, and parser fix

Upstream polls every `pollingInterval` (currently 1000 ms in upstream master) with a single `device.read()` after `device.write(); device.pause(60)`, and the parser checks `report[3] === micRegister`.

The fork changes three things:

1. **Polling interval reduced to 500 ms.** Compromise between mute-LED reaction time and the cost of keeping the radio link active for the round trip.
2. **No `clearReadBuffer()` before the poll.** Upstream clears the buffer right before the write, which throws away any data that arrived in the gap. The fork keeps the buffer so accumulated bytes can be drained.
3. **Drain up to 8 packets per poll.** Each iteration reads one packet, falls through if `getLastReadSize() <= 0`, otherwise tries to interpret it.
4. **Parser fixed.** Diagnostic logging revealed that the actual response shape is `[01 01 02 00 <value> 00 …]` — byte 3 is always `0x00`, not the register echo upstream's parser expected. The fork matches on `report[0]=0x01 && report[1]=0x01 && report[2]=0x02` and reads the value at `report[4]`.

Without (4) the explicit poll's value was being silently discarded. The mute LED could appear stuck in an old state until a different code path happened to reset it.

### Init/sleep handling fixes

Some of these changes were already present in this branch before the fork notes were written — they predate the upstream divergence point and may already be in upstream too:

- 22 s pause on re-init (resume / hot-reload) before any USB write, vs ~1 s on first start. Without this Windows occasionally throws *Access Denied* / *Unrecoverable Error* because the OS hasn't released the previous handle.
- `fetchSleepStatus()` rewrites `device.pause(60)` *before* `clearReadBuffer()` to drain late ACKs from color writes that would otherwise corrupt the next read.
- `modernDirectLightingMode()` verifies software-mode acceptance by reading back register `0x03` and only sets `Config.softwareModeActive = true` after the read confirms `b5 === 0x02` or `b4 === 0x02` (the Virtuoso XT Wireless answers in `b4` after wakeup, not `b5` like other models).
- `fetchStatus()` re-activates software mode whenever the device is awake but our `softwareModeActive` flag is false. Recovers the lit state automatically on a wake-from-sleep transition.
- `fetchBattery()` does not lock out the 60 s polling cooldown if the response is invalid (battery status outside `1..3`); it logs once per 5 s and tries again next frame. Avoids a missed sample on the very first poll right after init.
- `fetchMicStatus()` previously initialized `lastMicStatePolling` after the read so a transient invalid response wouldn't lock the polling cycle. (Same defensive pattern as fetchBattery.)
- `Shutdown(SystemSuspending)`: explicit `#000000` frame on system sleep/shutdown, hardware-mode switch otherwise.

---

## Known limitations

- **Unsolicited mute events are not surfaced.** Wireshark capture (`dumps/corsair_headset/signalrgb_laufzeit_mic_mute.pcapng`) confirms the headset pushes `[03 01 01 <register> 00 <value>]` reports within ~150 ms of every button press, both when SignalRGB is running and when it isn't. SignalRGB's plugin host appears to gate `device.read()` on the upstream report-ID byte and never returns those events to the JS layer. Practical mute-LED reaction time stays bounded by `pollingInterval` (currently 500 ms) — there's no way to react faster from inside the plugin without a SignalRGB API change.
- **Battery drain is mostly hardware.** A/B test with the included `Power Saver Test Mode` toggle (since removed) showed ~14 min/% in normal operation vs ~11 min/% with the plugin's RGB and mic traffic disabled — the difference is small and the absolute numbers exceed Corsair's spec (≈15 h with RGB → ≈900 min vs measured ≈1400 min idle). The big radio-link drain is the firmware itself, not the plugin.
- **Cable-only mode for headsets that support it isn't separately verified.** This plugin's wired path uses `headsetMode = 0x08`; the fork hasn't been retested wired since the mic-parser fix.

---

## Testing notes

The reverse-engineering captures used to derive the fixes live under `dumps/corsair_headset/` (gitignored). The most useful ones:

| File | What it shows |
|------|---------------|
| `signalrgb_laufzeit_nach_einschalten.pcapng` | Steady-state outbound traffic after a fresh headset power-on. Used to count packets-per-second by type. |
| `signalrgb_laufzeit_mic_mute.pcapng` | Mute-button presses during SignalRGB-active operation. Used to confirm the headset pushes `03 01 01 46 00 <value>` events on every press. |

Useful Wireshark display filter for inspecting unsolicited mic events on a Virtuoso XT:

```text
usb.src != "host" && frame contains 03:01:01:46
```

For an HS80 use `03:01:01:a6` instead.
