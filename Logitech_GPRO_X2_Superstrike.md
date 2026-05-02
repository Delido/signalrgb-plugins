# Logitech G PRO X 2 SUPERSTRIKE — HID++ Protocol Notes

Reverse-engineering notes from Wireshark captures of G HUB → mouse traffic, used to extend `Logitech_Modern_Device.js` with Superstrike-specific configuration support.

> **Status:** Most settings confirmed and working in the SignalRGB plugin. Cable polling rate not yet end-to-end tested (only seen via wireless-side packet capture). DPI verified working.

## Device Identification

| Property | Value |
|----------|-------|
| Device | Logitech G PRO X 2 SUPERSTRIKE Lightspeed |
| USB VID | `0x046D` (Logitech) |
| USB PID (Lightspeed dongle) | `0xC54D` (wireless) |
| USB PID (wired) | `0xC09B` *(not personally verified — pulled from existing plugin)* |
| HID++ Transport PID | `0x40BD` (this is what `LogitechMouse.PingDevice()` returns) |
| HID++ Device Index | `0x01` (single device behind the dongle) |
| HID Interface | `2`, usage page `0xFF00`, usage `0x0001` (short) / `0x0002` (long) |

The `0x40BD` transport PID was the missing entry that prevented the existing Pro-X-2 code paths from activating — every gated method (`setDpi`, `setBHOPMode`, ...) checked `Logitech.Config.DeviceName.includes("PRO X 2")` and the lookup returned `undefined`, so the include-check was always false.

## HID++ Wire Format

Standard HID++ 2.0 over USB Set_Report:

```
Short report (7 bytes total):
  10 [DEV_IDX] [FEATURE_INDEX] [FUNC_NIBBLE | SWID_NIBBLE] [PARAM0] [PARAM1] [PARAM2]

Long report (20 bytes total):
  11 [DEV_IDX] [FEATURE_INDEX] [FUNC_NIBBLE | SWID_NIBBLE] [PARAM0..PARAM15]
```

`DEV_IDX` is `0x01` for the Lightspeed mouse. The function byte's high nibble is the function ID, the low nibble is the SoftwareID (echo tag).

### SWID matters for Superstrike

The Superstrike encodes the **target connection mode** in the SWID nibble for polling-rate writes:

- SWID `b` (function bytes `6B`, `7B`, `3B`) → wireless register
- SWID `c` (function bytes `6C`, `7C`, `3C`) → cable register

Both registers are independently addressable while connected wirelessly. G HUB writes the cable rate even when no cable is plugged in.

## Confirmed Settings

### DPI

Three packets per change. X and Y are coupled in G HUB (always equal) and encoded as **16-bit big-endian**.

```
1. Set DPI value     11 01 09 6B 00 [XH XL YH YL] 02 00 00 00 00 00 00 00 00 00 00
2. Save to stage     11 01 09 7B 00 [STAGE_INDEX] 00 00 00 00 00 00 00 00 00 00 00 00 00
3. Apply trigger     10 01 0D 3B 05 00 00
```

**Encoding examples** (from captures):

| DPI | Hex (BE) | Captured packet bytes 5–10 |
|-----|----------|----------------------------|
| 400   | `0x0190` | `01 90 01 90 02` |
| 800   | `0x0320` | `03 20 03 20 02` |
| 16000 | `0x3E80` | `3E 80 3E 80 02` |
| 25625 | `0x6419` | `64 19 64 19 02` |

Stage index in the save packet: observed values 1 and 5. Active stage in the apply packet was always `0x05` regardless of which stage was changed.

### Polling Rate

Same three-packet pattern as DPI but with constant payload in the long packets and the rate index in the short packet:

```
1. Long config       11 01 09 [6B|6C] 00 03 20 03 20 02 ...   (constant)
2. Long commit       11 01 09 [7B|7C] 00 01 00 ...            (constant for polling)
3. Apply with index  10 01 0D [3B|3C] [INDEX]
```

`6B/7B/3B` = wireless slot, `6C/7C/3C` = cable slot.

**Rate index mapping** (confirmed by captures):

| Hz   | Index |
|------|-------|
| 125  | `0x00` |
| 4000 | `0x05` |
| 8000 | `0x06` |

> Indices `1`, `2`, `3`, `4` (250/500/1000/2000 Hz) extrapolated linearly. Not individually captured but consistent with Logitech's standard `0x8061` (Extended Adjustable Report Rate) feature.

### Trigger Force + Click Haptic

**Both share one register** on Feature `0x0C`, function 1. Whenever either changes, G HUB sends both values together. Two long packets per change — one for each button (left/right).

```
11 01 0C 1B [SIDE] [PRESSURE] 08 [HAPTIC] 00 00 00 00 00 00 00 00 00 00 00 00
```

| Field | Position | Values |
|-------|----------|--------|
| `SIDE`     | byte 4 | `0x00` = left, `0x01` = right (always sent as two consecutive packets) |
| `PRESSURE` | byte 5 | `level × 0x04` → `0x04`..`0x28` (level 1–10) |
| `08`       | byte 6 | constant separator |
| `HAPTIC`   | byte 7 | `0x00` (off), `0x04` (lvl 1), `0x08` (lvl 2), `0x0C` (lvl 3), `0x10` (lvl 4), `0x14` (lvl 5) |

**Implication:** if your plugin only changes haptic, it must read the current pressure (or its persisted SignalRGB value) and re-send both. Same in reverse. The plugin tracks both as separate `ControllableParameter`s and reads via `device.getProperty()` at write time.

### BHOP

Short packets on Feature `0x0B`. Note: **on/off use different function bytes**:

```
On  (set interval): 10 01 0B 2B [INTERVAL] 00 00     ← function nibble 2, SWID b
Off:                10 01 0B 2C 00 00 00              ← function nibble 2, SWID c
```

Interval encoding: **milliseconds ÷ 10** (one byte).

| ms   | Hex |
|------|-----|
| 100  | `0x0A` |
| 1000 | `0x64` |

`0x0A × 10 = 100`, `0x64 × 10 = 1000` — two-point linear fit, encoding fully determined.

Whether `2B` with value `0x00` would also disable BHOP isn't tested — the plugin sends exactly what G HUB sent (`2C` for off) to stay safe.

## Open Questions / Unverified

- **Cable polling rate end-to-end**: All cable-rate captures were taken while connected wirelessly. The packets are sent by G HUB regardless of physical connection, so the encoding is known, but a smoke test with an actual USB cable plugged in is still pending.
- **Per-axis DPI (X ≠ Y)**: G HUB couples them in its UI so we never see different values. The packet structure clearly has separate fields for X and Y, so it's almost certainly settable independently — but we have no captured proof.
- **DPI stage values 2, 3, 4**: only stages 1 and 5 were captured. Stages 2/3/4 should follow the linear pattern but weren't individually verified.
- **HID++ Feature ID → Index mapping**: feature indices (0x09, 0x0B, 0x0C, 0x0D) are device-specific and may shift after firmware updates. The init capture (`init_full.pcapng`) contains the raw feature-discovery handshake but a clean parse of it is still pending — when this plugin breaks after a Logitech firmware update, that's where to look.
- **Polling-rate save packet's `7B 00 01` vs `7C 00 01`**: the `01` is constant across all rates. It's most likely a "commit" flag rather than a stage selector, but the precise semantic isn't decoded.

## Reverse-Engineering Methodology

For each setting:

1. Captured a short Wireshark trace covering only the moment G HUB pushed the change (filter `usb.device_address == 17`).
2. Extracted the HID++ payload from each packet — both Set_Report Control transfers (host→device) and Interrupt IN responses (device→host, when full bidirectional capture was taken).
3. Diffed payloads across captures with different setting values to isolate the byte(s) that vary with the setting.
4. Used multiple data points (3 polling rates, 4 DPI values, 5 haptic levels, 10 pressure levels, 2 BHOP timings) to confirm encoding — anything with at least 3 linear data points was treated as "encoding fully determined."
5. Anything with fewer data points or non-monotonic patterns was flagged as extrapolated.

Tooling lives in `dumps/` (gitignored):

- `parse-pcap.ps1` — extracts HID++ payloads from a single `.pcapng`
- `compare-captures.ps1` — diffs payloads across multiple captures
- `parse-full.ps1` — handles bidirectional captures and pairs OUT/IN packets

The capture corpus is in `dumps/gpx2_superstrike/`.

## Plugin Implementation

Lives in [`Logitech_Modern_Device.js`](Logitech_Modern_Device.js). Superstrike-specific paths gate on USB PID `0xC54D` / `0xC09B` (the existing PRO X 2 string-include gate already activates correctly thanks to the new `0x40BD` lookup entry).

| Function | Implements |
|----------|------------|
| `LogitechMouse.setDpi(dpi, stage)` | DPI write — Superstrike branch sends the captured 3-packet sequence |
| `LogitechMouse.setBHOPMode()` | BHOP — existing path; uses function `2A` not the captured `2B`/`2C`, but reportedly works |
| `LogitechMouse.setTriggerSwitchState()` | Trigger Force + Click Haptic — new |
| `configureMouseSettings()` end | Calls `setTriggerSwitchState()` for Superstrike PIDs to sync UI ↔ firmware on init |

> **Note on existing BHOP/DPI code**: the original PRO X 2 paths used function bytes (`6E` for DPI, `2A` for BHOP) that don't match our captures (`6B` and `2B`). The DPI path was confirmed broken (didn't actually update DPI on the Superstrike) and replaced. The BHOP path appears to work in practice — probably because the lower nibble (SWID) is just an echo tag and the firmware accepts any SWID for the same function. If BHOP behavior turns out to be subtly off, replacing `2A` with `2B`/`2C` from our captures would be the next thing to try.

## References

- HID++ 2.0 protocol: not officially published by Logitech; community reverse-engineering at <https://github.com/pwr-Solaar/Solaar/blob/master/docs/hidpp20.md>
- libratbag's Logitech HID++ implementation: <https://github.com/libratbag/libratbag/tree/master/src>

These cover the standard HID++ feature set; the Superstrike's inductive-switch and BHOP features are device-specific and aren't documented in either project at the time of writing.
