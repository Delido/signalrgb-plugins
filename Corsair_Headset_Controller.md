# Corsair Headset Controller — Fork Notes

Documents the deltas in [`Corsair_Headset_Controller.js`](Corsair_Headset_Controller.js) against the upstream reference at:

<https://gitlab.com/signalrgb/signal-plugins/-/blob/Development/Plugins/Corsair/Modern_Corsair/Corsair_Headset_Controller.js?ref_type=heads>

Tested on: Corsair Virtuoso XT Wireless (USB VID `0x1B1C`, PID `0x0A64`), Windows 11, SignalRGB latest stable, Software Mode active.

The fork adds one user-facing feature, replaces the upstream's active polling for mic and battery state with passive listening on a separate HID top-level collection, and adds an RGB write dirty-flag. Net effect: in steady state with a static lighting effect the plugin sends about one USB control packet per second instead of dozens, and the mute-LED follows the physical button within ~150 ms instead of the polling interval. None of the changes alter the device-detection table or the supported-PID list — any headset the upstream plugin recognizes still works.

---

## New user-facing settings

### `Low Battery LED Cutoff (%)`

A number setting (`0`–`100`, default `15`). When the battery falls below this threshold and the headset is *not* charging, the plugin sends one black frame and stops issuing further `sendColors()` calls until the battery rises back above the threshold. `fetchStatus` and the passive event drain keep running so the SignalRGB battery indicator continues to update.

Charging bypass: a battery status of `Charging` (`0x01`) or `Fully Charged` (`0x03`) keeps the LEDs on regardless of the threshold. Power conservation isn't a concern when external power is supplied.

Set to `0` to disable the cutoff entirely.

Implementation: tracked via `Config.lastBatteryLevel`, `Config.lastBatteryStatus`, `Config.inLowBatteryMode`. Decision made in `Render()` per frame after the battery reading.

---

## Runtime behavior changes

### RGB dirty-flag with 1 s heartbeat

Upstream sends the full color packet every render frame (~30/s) regardless of whether anything changed. The fork hashes `RGBData` into a string key and skips `writeRGB()` if the key matches the previous frame **and** less than `rgbHeartbeatMs` (default 1000 ms) has passed since the last write.

Effect: a static effect (e.g. Solid Color) drops from ~30 USB writes/s down to 1/s. The 1 s heartbeat is a deliberate safety net so a mute-LED state change that happens to coincide with a constant-color background still recovers within one second even if the upstream parser missed an interim event.

Override colors (e.g. the `#000000` shutdown frame) bypass the dirty-flag check.

### Passive listening for mic, battery and charging state

Upstream polls actively for everything — mic mute every `pollingInterval` (1 000 ms) and battery every `pollingBatteryInterval` (60 s) — by writing a request packet, waiting, and reading the response. Mute-LED reaction time was bounded by the mic poll interval.

The fork replaces this with **passive listening** on a different HID top-level collection.

#### The two iCUE collections

The Virtuoso XT exposes two HID top-level collections on the iCUE vendor usage-page (`0xff42`):

| Collection | Usage | Used for |
|------------|-------|----------|
| `0x0005` | `0x0001` | Output reports for control (RGB writes, software-mode set, active polls) and their responses (report-ID `0x01`) |
| `0x0006` | `0x0002` | **Input-only event channel** with report-ID `0x03` — unsolicited mute, button, LED, battery and charging state events |

`device.read()` is bound to whichever collection `device.set_endpoint()` last selected, and each report ID is owned by its declaring collection. Reading from `0x0005` will *never* surface report-ID `0x03` events, no matter how clearly Wireshark sees them on the wire — that's why upstream's parsing of `report[3] === micRegister` on the main collection had no chance of working for the unsolicited events.

#### `drainPassiveEvents()`

A new method called once per `Render()` frame for wireless devices. It

1. Switches the endpoint to `interface 3, usage 0x0002, usage_page 0xff42, collection 0x0006`.
2. Drains up to 16 events that queued since the last frame.
3. For each event matching `03 01 01 <register> 00 <value…>`, updates the corresponding state field in `Config`.
4. Switches the endpoint back to the main collection so subsequent RGB writes / `fetchStatus` / safety-net polls in the same frame behave as before.
5. On any state change, calls `battery.setBatteryLevel()` / `battery.setBatteryState()` and emits a single log line.

Observed event formats on the alt collection (all verified live):

```text
03 01 02 <pressed>             — button transition (1 = pressed, 0 = released, ignored)
03 01 01 8e 00 <V>             — LED feedback echo (ignored)
03 01 01 <micRegister> 00 <V>  — mic register, byte 5 = value (0 unmuted, 1 muted)
03 01 01 0F 00 <LO> <HI>       — battery level, 16-bit LE at bytes 5..6, /10 for percent (~5 min cadence)
03 01 01 10 00 <V>             — charging status (1 = Charging, 2 = Discharging, 3 = Full)
```

The button transition and LED feedback events are observed but not used — the mic-register event carries the authoritative value already. `micRegister` is `0x46` for the Virtuoso family and `0xA6` for the HS80 (matches upstream's existing logic).

State-change log lines (one per transition, no spam in steady state):

```text
Microphone muted
Microphone unmuted
Battery Level is [95%]
Battery Status is [Charging]
```

#### Safety-net active polls

`fetchMicStatus()` and `fetchBattery()` are kept as safety-net active polls. They only fire if no event has arrived for the throttle window:

- **Mic safety net**: `pollingInterval` = 10 000 ms (was 1 000 ms upstream). Catches missed events after wake-from-sleep or plugin reload before the user has touched the button.
- **Battery safety net**: `pollingBatteryInterval` = 1 800 000 ms (was 60 000 ms upstream). The first `Render()` still triggers it (because `lastBatteryPolling` starts at `0`) so the SignalRGB battery indicator populates immediately on plugin load; after that the half-hour throttle effectively means it never runs again unless the headset stops emitting level events for an extended period.

Whenever the passive drain receives an event, it resets the corresponding `lastMicStatePolling` / `lastBatteryPolling` timestamp so the safety net stays disarmed.

For the active mic-poll response itself (when the safety net does fire), the parser-fix from earlier diagnostics applies: response shape is `[01 01 02 00 <value> 00 …]` — byte 3 is always `0x00` (not the register echo upstream's parser expected), value at byte 4. Match on `report[0] === 0x01 && report[1] === 0x01 && report[2] === 0x02`.

### Init/sleep handling fixes

Some of these changes were already present in this branch before the fork notes were written — they predate the upstream divergence point and may already be in upstream too:

- 22 s pause on re-init (resume / hot-reload) before any USB write, vs ~1 s on first start. Without this Windows occasionally throws *Access Denied* / *Unrecoverable Error* because the OS hasn't released the previous handle.
- `fetchSleepStatus()` rewrites `device.pause(60)` *before* `clearReadBuffer()` to drain late ACKs from color writes that would otherwise corrupt the next read.
- `modernDirectLightingMode()` verifies software-mode acceptance by reading back register `0x03` and only sets `Config.softwareModeActive = true` after the read confirms `b5 === 0x02` or `b4 === 0x02` (the Virtuoso XT Wireless answers in `b4` after wakeup, not `b5` like other models).
- `fetchStatus()` re-activates software mode whenever the device is awake but our `softwareModeActive` flag is false. Recovers the lit state automatically on a wake-from-sleep transition.
- `fetchBattery()` does not lock out the polling cooldown if the response is invalid (battery status outside `1..3`); it logs once per 5 s and tries again next frame. Avoids a missed sample on the very first poll right after init.
- `Shutdown(SystemSuspending)`: explicit `#000000` frame on system sleep/shutdown, hardware-mode switch otherwise.

---

## Known limitations

- **Battery drain is mostly hardware.** A/B test with the included `Power Saver Test Mode` toggle (since removed) showed ~14 min/% in normal operation vs ~11 min/% with the plugin's RGB and mic traffic disabled — the difference is small and the absolute numbers exceed Corsair's spec (≈15 h with RGB → ≈900 min vs measured ≈1400 min idle). The big radio-link drain is the firmware itself (audio class isochronous streams on EP `0x03`/`0x83` at ~100 packets/s each direction), not the plugin. Plugin packets are <1 % of headset USB traffic when audio is routed to the headset.
- **Cable-only mode for headsets that support it isn't separately verified.** This plugin's wired path uses `headsetMode = 0x08`; the fork hasn't been retested wired since the mic-parser fix and the move to passive listening on collection `0x0006` (a wired Virtuoso may expose the same TLC, but it's untested).
- **Other Corsair models may need the alternate-collection trick verified.** The `0x0005`/`0x0006` split was confirmed on the Virtuoso XT Wireless. Other models in the upstream device library (HS80, Virtuoso SE, base Virtuoso) likely follow the same pattern but haven't been exercised here. If passive listening doesn't work on a given device, the 10 s safety-net active poll keeps the LED behavior at least functional.

---

## Testing notes

The reverse-engineering captures used to derive the fixes live under `dumps/corsair_headset/` (gitignored). The most useful ones:

| File | What it shows |
|------|---------------|
| `signalrgb_laufzeit_nach_einschalten.pcapng` | Steady-state outbound traffic after a fresh headset power-on. Used to count packets-per-second by type. |
| `signalrgb_laufzeit_mic_mute.pcapng` | Mute-button presses during SignalRGB-active operation. Used to confirm the headset pushes `03 01 01 46 00 <value>` events on every press. |
| `mic_on_off_2package_per_click.pcapng` | Minimal isolated capture (4 packets) of two mute clicks. Used to confirm the events arrive on EP `0x81` regardless of whether SignalRGB is running and to identify the alt-collection routing. |
| `headset_aktuell.pcapng` | 3.6 s capture during normal operation. ~720 isochronous audio packets vs ~10 plugin control packets — establishes the audio stream as the dominant USB load. |

Useful Wireshark display filters (replace `46` with `a6` for an HS80 mic register):

```text
# All unsolicited 03 01 01 events from the headset (mic, battery, charging, LED)
usb.src != "host" && frame contains 03:01:01

# Mic-register events only
usb.src != "host" && frame contains 03:01:01:46

# Battery level events only (~5 min cadence)
usb.src != "host" && frame contains 03:01:01:0f

# Charging status events only (instant on plug/unplug)
usb.src != "host" && frame contains 03:01:01:10
```

To pin down which HID top-level collection a given report ID belongs to (in case another model needs the alt-collection trick adapted): use `tshark -G fields | grep usbhid` or read the device's HID descriptor directly via `Get_Report` to a configuration-descriptor request. Each collection's report-ID set is what determines whether `device.read()` will surface the events.
