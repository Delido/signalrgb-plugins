# Corsair Vanguard Pro 96 — Protocol Findings

Reverse-engineered from `init_icue.pcapng` and `init_icue_versuch2.pcapng` (USBPcap captures of iCUE classic launching against the keyboard, including a live RGB animation).

## Device identity

- Vendor `0x1B1C`, Product `0x2B0E`
- 4 USB interfaces, all HID:

| IF | Class/Sub/Proto | EPs | Report Desc | Likely role |
| -- | --------------- | --- | ----------- | ----------- |
| 0 | HID/Boot/Mouse(0x02) | 0x82 IN, 8 B, 2 ms | 75 B | Consumer/multimedia |
| 1 | HID/Boot/Keyboard(0x01) | 0x81 IN, 8 B, 2 ms | 138 B | Standard 6-KRO keyboard |
| 2 | HID/0/0 | **0x03 OUT + 0x83 IN, 1024 B, 1 ms** | 29 B | **iCUE control channel** |
| 3 | HID/0/0 | 0x84 IN, 64 B, 2 ms | 21 B | Likely event channel (similar to headset alt-collection) |

The 1024-byte interrupt EP pair on IF2 is the iCUE / Bragi control channel. All Software-Mode lighting traffic flows through this.

## Wire packet format (verified from dump)

All packets on EP `0x03`/`0x83` are **exactly 1024 bytes**, zero-padded after the meaningful payload.

```text
Byte 0:  0x00          — HID report ID (zero)
Byte 1:  0x01 / 0x00   — direction: 0x01 = host→device request, 0x00 = device→host response
Byte 2:  conn / class  — 0x00 for the 0x1B handshake commands; 0x01 for "primary" channel; 0x02 for "secondary" channel
Byte 3:  opcode        — see command table below
Byte 4+: opcode args
```

> **Important divergence from upstream `Corsair_Bragi_Device.js`:**
> Upstream emits `[0x00, deviceID | 0x08, command, …]` — i.e. byte 1 is the connection mask `0x08` for a wired device with deviceID 0. Our wired Vanguard Pro 96 captures show byte 1 = `0x01` (request) / `0x00` (response). This is a **direction byte, not a connection mask**. Either the upstream plugin never targeted wired keyboards in this fashion, or the SignalRGB SDK rewrites this byte before transmission. To replicate iCUE's behavior verbatim we should emit `0x01` for requests.

## Command opcodes (matches upstream Bragi)

From upstream `Corsair_Bragi_Device.js` line 2490, confirmed against the dump:

| Op | Name | Notes |
| -- | ---- | ----- |
| `0x01` | setProperty | `[propID, 0x00, val_lo, val_mid, val_hi]` |
| `0x02` | getProperty | `[propID_lo, propID_hi]` |
| `0x05` | closeHandle | `[count, handle]` |
| `0x06` | writeEndpoint | `[handle, len_le32, ...data]` ← **lighting writes** |
| `0x07` | streamEndpoint | for chunked writes >1 packet |
| `0x08` | readEndpoint | `[handle]` |
| `0x09` | checkHandle | `[handle, 0x00]` |
| `0x0D` | openEndpoint | `[handle, endpoint]` |
| `0x12` | pingDevice | |
| `0x15` | confirmChange | |
| `0x1B` | **(undocumented)** | session/auth handshake with 4-byte token. Seen 3× during init with different magic tokens; conn-byte = `0x00` |

## Init sequence (timing in seconds from capture start)

```text
0.213   IN  18B   01 00 00 ...                  — bootkbd ack on IF1
1.286   OUT 1024  00 01 00 1B 01 11 F7 83 96    — handshake #1, magic 0x9683F711
1.288   IN  1024  00 00 00 1B 00 11 F7 83 96 01 — ack
1.291   OUT       00 01 01 02 03                — getProperty(0x0003 mode)
1.292   IN        00 00 01 02 00 01 00          — current mode = 0x01 Hardware
1.294   OUT       00 01 01 01 03 00 02          — setProperty(mode = 0x02 Software)
1.295   IN        00 00 01 01 00 00             — ack
1.296   OUT       00 01 01 0D 00 24             — openEndpoint(handle 0x00, ep 0x24)
1.299   OUT       00 01 01 0D 00 36             — openEndpoint(handle 0x00, ep 0x36)  
1.302   OUT       00 01 01 01 03 00 01          — setProperty(mode = 0x01 Hardware)  ← iCUE flips back briefly
1.306   OUT       00 01 01 02 5A                — getProperty(0x005A) — unknown property
1.327   OUT       00 01 01 02 55                — getProperty(0x0055) — unknown property
1.332   OUT       00 01 00 1B 01 E7 D3 16 48    — handshake #2, magic 0x4816D3E7
1.333   OUT       00 01 02 02 11                — getProperty(VID = 0x0011) on conn 0x02
1.335   OUT       00 01 02 02 12                — getProperty(PID = 0x0012)
1.336   OUT       00 01 02 1B 02 00 00 00 00 02 — close session on conn 0x02
1.339   OUT       00 01 00 1B 01 64 AE ED F4    — handshake #3, magic 0xF4EDAE64
…       (40+ further property reads — firmware, brightness, layout 0x41, lock states, etc.)
1.668   OUT 303B  00 01 02 06 00 26 01 00 00 30 00 61 07 00 23 11 …  — write effect/zone config
…       (more 303-byte / 497-byte config writes)
2.273   OUT 419B  00 01 02 06 00 9D 01 00 00 12 …                   — first real RGB frame
4.624   OUT 419B  00 01 02 06 00 9D 01 00 00 12 …                   — steady-state begins
```

The three `0x1B` sessions appear to be an authentication / device-ownership protocol; iCUE reads the handles after each. **It is not yet known whether SignalRGB needs to replicate these to drive lighting** — most likely no, because Software Mode is the only state that matters for direct RGB writes. Worth testing without them first.

## RGB stream format (steady state)

Cadence: ~24 fps (40 ms inter-frame). Payload size: 419 bytes. Format:

```text
Byte 0:  0x00         — HID report ID
Byte 1:  0x01         — direction (request)
Byte 2:  0x02         — connection class (secondary; lighting always uses 0x02)
Byte 3:  0x06         — writeEndpoint
Byte 4:  0x00         — handle ID (lighting handle = 0x00)
Bytes 5-8: 0x9D 0x01 0x00 0x00 = 0x0000019D = 413     — payload length (LE32)
Bytes 9-21: 13 bytes that look like a sub-header (zone index? always-zero padding?)
            Example: 12 00 00 00 00 00 00 00 00 00 00 00 00
Bytes 22-…: 410 bytes of LED data (RGB triplets, exact ordering TBD)
```

The 13 bytes of sub-header before LED data is unusual — needs investigation. Possibilities:

- Zone selector + length + flags
- Multiple zones concatenated, the leading bytes are a "zone 1 length=0" marker

Total: 9 + 13 + 397 = 419 — but 397/3 isn't clean. Or: 9 + 13 + 410 = 432, but only 419 are actually present. Math doesn't quite work, suggesting the layout is more nuanced — possibly:

- Header (9 bytes) + 1-byte zone marker + (zone 1: count + RGB triplets) + (zone 2: count + RGB triplets) + …

This needs targeted captures to fully nail down: capture iCUE writing a single key red, then a single key green, etc., to map buffer offsets to keys.

## Initial RGB chunked transfer (init phase)

The very first lighting frame is sent in **two chunks** rather than one:

```text
2.273   OUT 402B   00 01 02 06 00 9D 01 00 00 12 …                              — chunk 1 with op 0x06
2.273   OUT 542B   00 01 02 06 01 19 02 00 00 2B …                              — chunk 2 (offset 0x0219?)
```

After this two-chunk warm-up, all subsequent frames fit in a single 419-byte packet. Steady-state path doesn't need chunking on this device.

## Lighting endpoint and handle IDs

From the init capture: openEndpoint with `(handle=0x00, endpoint=0x24)` and `(handle=0x00, endpoint=0x36)` — both returned status `0x06`. Then `02 06` writes use handle `0x00`. So:

- **Lighting endpoint** seems to be `0x24` (matches upstream's `endpoints.Lighting` = `0x24`)
- **Lighting handle** = `0x00`

Worth checking against upstream's `endpoints` table once we extract it.

## Confirmed during plugin bring-up

After implementing the protocol in `Corsair_Vanguard_Pro_96.js` and verifying against `signalrgb_run_01.pcapng`:

1. **`0x1B` handshake IS required.** Without it, all subsequent commands return error status `0x0F` ("session not open"). The device returns an incrementing session counter in the response (e.g. `04 00`, `05 00`, `06 00`) — this is a session ID, not a status code.

2. **SignalRGB SDK strips the leading `0x00` byte** of every `device.write()` buffer. To put the iCUE-correct `00 01 [conn] [opcode]…` on the wire, the plugin must emit `[0x00, 0x00, 0x01, conn, opcode, …]` — two leading zeros, the SDK consumes one as a HID report-ID prefix.

3. **Frame rate cap = 25 fps (40 ms).** Going faster causes Windows `Überlappender E/A` write pile-ups and the device eventually stops responding to keystrokes too. iCUE itself runs at ~24 fps continuously.

4. **No dirty-flag.** The device does NOT latch frames — without a fresh write every ~40 ms it reverts to the firmware-default lighting. The headset's 1 Hz dirty-flag heartbeat (which works for that device) breaks this one. Just stream every frame.

5. **Software Mode is set successfully** but on its own does **not** unlock lighting writes — see open issue below.

## Open issue: lighting writes accepted but visually ignored

The plugin successfully:

- Authenticates (3× `0x1B` handshakes return correct token echoes + session IDs)
- Sets `mode = Software` via `setProperty(0x03, 0x02)` (status byte = `0x00`, verified via `getProperty(0x03)` returning `02 00`)
- Sends 1024-byte `0x06`-opcode lighting writes at 25 fps with byte-for-byte the iCUE wire format

But the keyboard does not light up. iCUE was found to emit a much larger init sequence between `setProperty(mode)` and the first RGB frame. Excerpt of the additional traffic between **frames 575 and 1117** of `init_icue.pcapng`:

```text
Five lighting-config writes, each preceded by an openHandle/checkHandle/closeHandle dance:

  openEndpoint(handle=0, ep=0x33) → write 303 B with sub-header 0x30 → close
  openEndpoint(handle=0, ep=0x32) → write 303 B with sub-header 0x30 → close
  openEndpoint(handle=0, ep=0x38) → write 303 B with sub-header 0x30 → close
  openEndpoint(handle=0, ep=0x39) → write 303 B with sub-header 0x30 → close
  openEndpoint(handle=0, ep=0x3A) → write 497 B with sub-header 0x36 → close

Each 0x30-subheader payload contains 96 records of [0x23, HID_USAGE_ID, 0x00] —
the device's per-key LED layout. The 0x36-subheader payload uses 5-byte records
[0x14, 0x0a, 0x0a, HID_USAGE_ID, 0x00], same 96 keys.

Plus ~20 property reads in between (`0x41` HW Layout, `0x45` WinLock, `0x4A`
Lock Shortcuts, `0x44` Brightness Level) and key-remap-table reads at endpoints
`0x6D60`–`0x6D6F`.
```

Without sending these config packets the device answers `setProperty(mode, Software)` with success but never enters a state where `0x12`-subheader RGB frames produce visible output.

**Root cause hypothesis:** the device firmware's "direct RGB streaming" mode is gated on a successful LED-layout upload via the `0x30` config packets. Without that upload, the firmware doesn't know which physical LED corresponds to which buffer offset and silently drops the frames.

## Stage 1 → first light: confirmed working

Solved by replaying the iCUE bring-up sequence verbatim. From `icue_static_colors_disable_playmode.pcapng` we extracted **88 essential OUT packets** between the first handshake and the first steady-state `0x12`-subheader RGB frame; the plugin replays them at Initialize before its own `Render()` takes over. Of these:

- 3× `0x1B` handshakes (mandatory; without them the device returns status `0x0F` to *every* subsequent command)
- `setProperty(mode = Software)` on conn `0x01` and again on conn `0x02`
- 1× 969-byte `0x44`-subheader write at endpoint `0x3D` (purpose unknown — likely macro/remap-table preset; harmless to replay verbatim)
- 5× layout-config writes (`0x30`-subheader at endpoints `0x32`/`0x33`/`0x38`/`0x39`, `0x36`-subheader at `0x3A`)
- A `setProperty(0xFB)`/`setProperty(0xFC = 1)`/`setProperty(0xFE = 4)`/`setProperty(0xFF = 7)` block (purpose unknown — possibly hardware-feature flags; bytes faithfully replayed)
- A `0x01`-subheader 137-byte write at endpoint `0x02`, then `openEndpoint(handle = 0, endpoint = 0x22)` which leaves the LightingController handle open. From this point the plugin streams `0x12`-subheader frames every 40 ms and the keyboard responds.

The final `replayInit()` ends after the `openEndpoint(0, 0x22)` and one extra pre-allocation of handle 1 (edge bar) and handle 2 (LCD) which the wired Vanguard Pro 96 doesn't expose visually but iCUE always opens. Skipping those didn't seem to break anything in the captures we have, but they are kept for parity.

## Stage 2 → ledMap: confirmed working

The buffer-slot → physical-key mapping is **NOT HID-keycode-aligned** as the upstream Bragi K-series convention suggested it would be. The Vanguard Pro 96 uses a Vanguard-specific permutation. Derived from a layout-test sweep video on an ISO/DE Vanguard Pro 96:

- 26 letter slots (`0..25`) — the firmware emits A/B/C/D/E/F/G/H/I/J/K/L/M/N/O/P/Q/R/S/T/U/V/W/X/Z/Y in that exact order, with Z and Y swapped at the very end (DE keyboard convention places Z where ANSI puts Y on the top alpha row).
- 10 number-row slots (`26..35`).
- 5 "big" keys (`36..40`): Enter, Esc, Backspace, Tab, Space.
- 4 right-of-number-row keys (`41..44`): ß, ´, Ü, +.
- Phantom slot 45.
- 7 punctuation/special slots (`46..52`): #, Ö, Ä, ^ (backtick/caret), `,`, `.`, `-`.
- 1 CapsLock (`53`), 12 F-keys (`54..65`), Print Screen (`66`).
- Phantom run 67–71 (5 slots).
- Del (`72`), phantom 73–74, four arrows (`75..78`: Right/Left/Down/Up).
- 17 numpad slots (`79..95`): NumLock, Num/, Num*, Num-, Num+, NumEnter, then 1–9, 0, comma. The decimal separator on the DE numpad is a comma, not a period.
- ISO_< (`96`).
- Phantom run 97–100 (4 slots).
- 4 left-side modifiers (`101..104`): Left Ctrl, Left Shift, Left Alt, Left Win — note the firmware order is *not* the physical row order.
- Phantom 105.
- Right Shift (`106`), Right Alt / AltGr (`107`).
- Phantom run 108–117 (10 slots).
- Fn (`118`).
- Phantom run 119–125 (7 slots).
- 6 side-panel slots (`126..131`): LightFn at the top, then G1–G5.
- Elgato (`132`) — the dedicated Stream Deck button right next to Fn (this Vanguard Pro 96 model has **no** Right Ctrl in the modifier row; the Elgato button takes that anatomical slot).

The full mapping is encoded as `KEY_TABLE` in `Corsair_Vanguard_Pro_96.js`.

## Notes for future Vanguard / Bragi-v2 work

- The `0x30`-subheader prefix bytes vary slightly between iCUE captures. Animation mode used `30 00 61 07 00` followed by `[0x23, KEYID, 0x00]` 3-byte records; static (play-mode-disabled) mode used `30 00 61 37 01` followed by `[0x14, KEYID, 0x01]` records. Both unblock RGB streaming. Replaying either verbatim works; the plugin uses the static-mode capture.
- The `0x36`-subheader payload at endpoint `0x3A` uses 5-byte records `[0x14, 0x0a, 0x0a, KEYID, 0x00]`. Same 96 keys.
- iCUE opens lots of `0x6D6X` endpoints to read per-key remap tables for its own UI — these are pure reads and the plugin can skip them entirely without losing functionality.
- `openEndpoint(0, 0x24)` and `openEndpoint(0, 0x36)` both come back with status `0x06` (rejected) on the Vanguard Pro 96. The actual lighting endpoint is `0x22` (the upstream Bragi naming "LightingController"). iCUE's probes of the older endpoints are vestigial.

---

## Addendum 2026-05-15 — FlashTap and Actuation dual paths, knob push, LCD corner

### Dual firmware paths for GM-dependent features

The plugin originally treated FlashTap and global key-actuation as Game-Mode-only, derived from older captures where GM happened to be ON. New captures (`flashtap_no_gamemode.pcapng`, `actuation_global_no_gamemode_0.5mm.pcapng`, `actuation_spacebar_3mm_no_gamemode.pcapng`) revealed that iCUE uses *separate* firmware paths when GM is off — and the firmware stores **two independent values** for actuation (one for each GM state).

**FlashTap (SOCD):**

| Context | conn | opcode | propID | Notes |
| ------- | ---- | ------ | ------ | ----- |
| GM ON   | 0x02 | 0x01 setProperty | `0x0100` (LE16) | original capture `flashtap_engage_disengage.pcapng` |
| GM OFF  | 0x02 | 0x01 setProperty | `0xFB` (single byte) | capture `flashtap_no_gamemode.pcapng` frame 7 |

Plugin `setHardwareFlashTap()` now dispatches automatically based on current `gameModeActive`.

**Global key actuation point — TWO endpoints, TWO firmware NVRAM slots:**

| Context | Endpoint | Payload shape |
| ------- | -------- | ------------- |
| GM ON   | `0x48`   | 14-byte RT block (`63 00 01 <actuation×10> 00 <secClamp> 00 25 00 22 <rtFlag> <actuation×10> <sens> <sens>`) |
| GM OFF  | `0x32`   | 294-byte global table: `30 00 61 0e` sub-header + 96× `01 <actuation×10> <keyID>` triples + trailing `01 <actuation×10>` |

The 96-key ordering is fixed in the plugin's `ACTUATION_KEY_TABLE`. The plugin exposes the values as TWO UI properties (`actuationPoint` for normal, `gameModeActuationPoint` for GM) that don't overwrite each other; `writeActuationForCurrentMode()` re-applies on GM toggle so both stay in sync.

Per-key actuation (one specific key only) writes to THREE endpoints sequentially: `0x32` (defaults pass), `0x38` (secondary), `0x3a` (5-byte-per-key full config with override). Not implemented in the plugin because SignalRGB has no grid/key-selector UI widget.

### Knob push bitIdx

Vanguard Pro 96 sends the rotary push event as **bitIdx 129** on SignalRGB's read endpoint (`set_endpoint(0x03, 0x02, 0xFF42)`). The same physical press shows as bitIdx 121 in iCUE captures on USB endpoint 0x84 — *different read endpoints have different bit layouts*. Upstream Bragi K100 documentation says 137 (which doesn't apply here). For any new Bragi-derived plugin, log the actual incoming bitIdx with the live `processMacroInputs` path; don't infer from pcap captures.

### LCD top-right knob-mode indicator — investigation closed

The corner indicator (showing the active Fn+F12 knob label) does NOT render in Software Mode regardless of host-side workarounds. Confirmed via:

1. iCUE init replay (212 OUT packets) — no effect
2. Web Hub capture analysis — Web Hub stays primarily in **Hardware Mode** (last `SetProperty(mode=0x01)` in `webapp_init.pcapng` frame 1053); only briefly switches to SW for specific writes. Knob cycle in HW mode = firmware-rendered corner.
3. Three plugin experiments testing whether `SetProperty(mode=Software)` via conn=0x00 (Web Hub's channel, vs upstream conn=0x09) unlocks it: all negative.
4. User did Web Hub Factory Reset + ESC-bootloader reset + 3 firmware reflashes (2.4.130, 2.5.x, 2.6.153) — corner still blank in SW mode.

Conclusion: **structural Corsair firmware design.** Corner is HW-mode-rendered; SW mode delegates to host but no public protocol path exists to push corner content. The only remaining avenue would be reverse-engineering `writeEndpoint subhdr 0x12` (413-byte steady-state frame, last ~130 bytes possibly LCD pixel data) and `0x7E` (126-byte LED-pair refs, probably layout/index table) — high effort, unclear payoff.

### Web Hub vs iCUE vs SignalRGB protocol channels

Web Hub uses **conn=0x00 (session channel) for ALL its protocol I/O**, including SetProperty(mode), endpoint reads, and FetchProperty. iCUE uses conn=0x02 (data channel) for most operations. Upstream Bragi library uses `deviceID|0x08 = 0x09` for wired devices.

In `webapp_init.pcapng` Web Hub performs **18 mode toggles** (10× SET mode=Hardware, 8× SET mode=Software) interleaved with endpoint reads (tree under root endpoint `0x000f` → sub-endpoints `0x6d60`–`0x6d66`). Last toggle is HW — Web Hub leaves the device in Hardware Mode.

### Firmware archive CDN

`https://www.corsair.com/firmware-storage/firmware/public/fw/<MODEL>_<version>.zip` serves **older firmware versions too**, not just current. HEAD requests get routed to a bot-challenge 302 that looks like 404 — use `curl -A "<browser-UA>" -H "Range: bytes=0-99999"` to bypass and confirm file existence. Verified working for Vanguard Pro 96 versions 2.4.130, 2.5.x, 2.6.153.
