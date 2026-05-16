# SignalRGB Plugins

A collection of custom device plugins for [SignalRGB](https://www.signalrgb.com/).

> **USE AT YOUR OWN RISK**
> These plugins are provided as-is, without any warranty. The author accepts no responsibility for any damage to hardware, software, or data that may result from using these plugins. Some plugins (e.g. SMBUS-based GPU plugins) can potentially damage hardware if used incorrectly.

## Included Plugins

| Plugin | Device Type | Protocol |
| ------ | ----------- | -------- |
| `ASUS_Keyboard_Protocol.js` | ASUS Keyboards | USB HID |
| `ASUS_Mouse_Protocol.js` | ASUS Mice | USB HID |
| `ASUS_Omni_Device.js` | ASUS Combo Devices (Keyboard + Mouse) | USB HID |
| `Asus_Ampere_Lovelace_GPU.js` | ASUS GPUs (Ampere / Lovelace) | **SMBUS** ⚠️ |
| `Corsair_Bragi_Device.js` | Corsair Bragi-family devices, including the new "Bragi v2" generation (Vanguard 96, **Vanguard Pro 96**) — community fork of upstream with the v2 wire-format + `0x1B` session handshake added. See [protocol notes](dumps/corsair_keyboard/PROTOCOL.md) for the Bragi v2 reverse-engineering details. | USB HID |
| `Corsair_Headset_Controller.js` | Corsair Headsets (forked from upstream — see [fork notes](Corsair_Headset_Controller.md)) | USB HID |
| `Corsair_Lighting_Commander_Core.js` | Corsair Commander Core | USB HID |
| `Logitech_Modern_Device.js` | Logitech Devices (incl. G PRO X 2 Superstrike — see [protocol notes](Logitech_GPRO_X2_Superstrike.md)) | HID++ 2.0 |

### ⚠️ SMBUS Warning

**Modifying SMBUS plugins is DANGEROUS and can DESTROY devices.**
Only use `Asus_Ampere_Lovelace_GPU.js` if you know exactly what you are doing.

## Feature Set

What these plugins offer beyond plain RGB — everything is configurable directly from the SignalRGB UI:

### Corsair Vanguard 96 / Vanguard Pro 96 (Bragi v2 Keyboards)

- **Per-key RGB** via any SignalRGB effect (Canvas) or as a static **Forced Color**.
- **Game Mode**: dedicated color and optional *"Game Mode forces Lighting"* switch — the keyboard's physical Game Mode key works as a real toggle even without iCUE running.
- **Fn highlight**: F1–F12 light up in a configurable color while `Fn` is held.
- **FlashTap (SOCD)** via the `Fn + Right Shift` hotkey — resolves simultaneous A+D inputs for clean counter-strafing in CS2 / Valorant. The hotkey can be disabled if you trigger it by accident while typing.
- **Rapid Trigger** with sensitivity from `0.1` to `1.0 mm` — keys actuate based on direction of motion instead of a fixed depth.
- **Key actuation point** from `0.3` to `3.6 mm`, with **separate values for Normal and Game Mode** (e.g. 2.0 mm for typing, 0.5 mm for gaming — auto-switches whenever Game Mode toggles).
- **Knob modes** cycled via `Fn + F12`:
  - **Volume** — turn = volume, push = mute (always available)
  - **Media** — turn = skip forward/backward, push = play/pause
  - **Vertical Scroll** — turn = Page Up/Down (works in browsers, PDF viewers, editors)
- **Pause for Web Hub** switch: releases the lighting handle so the Corsair Web Hub can claim the keyboard (e.g. for firmware updates).

### Corsair Virtuoso XT & other Bragi headsets

- **RGB logo control** with Canvas or Forced Color mode.
- **Microphone LED mode**: follow Canvas lighting or use a dedicated *MuteState* color (e.g. red when muted).
- **Instant mute detection** (~150 ms instead of 1 s) — the mute LED follows the physical button with almost no lag (passive event listening instead of polling).
- **Live battery level and charging status** in the SignalRGB UI, without flooding the headset's wireless link with polls.
- **Low Battery LED Cutoff** (`0`–`100 %`): the LED is automatically turned off and RGB streaming pauses below the threshold — meaningfully extends battery life with no manual action required. The LED stays on while charging.
- **Sidetone level** adjustable (model-dependent).
- **Sleep/wake handling**: Software Mode is automatically restored after standby, RGB keeps running without a reload.

### Logitech G PRO X 2 SUPERSTRIKE & modern Logitech mice

- **RGB control** for the G PRO X / G PRO Superlight / Superstrike family.
- **DPI stages** (1–5) with individual values, plus **DPI Stage Rollover** for cyclic switching.
- **Polling rate** from `125 Hz` to `8000 Hz`, with separate values for cable and Lightspeed operation.
- **Trigger Force (Superstrike-only)**: actuation pressure of the inductive switches, **per mouse button** (level 1–10).
- **Click Haptic (Superstrike-only)**: configurable haptic click feedback (off + level 1–5).
- **BHOP mode** with configurable interval (100–1000 ms).
- **Onboard Memory Mode** toggle — switches between SignalRGB control and stored hardware settings.
- **Setting Control lock**: a safety switch that prevents SignalRGB from unintentionally overwriting DPI / polling rate.

### ASUS keyboards, mice, combo devices

- **RGB control** for ASUS HID devices (ROG Strix / Falchion / Claymore etc.).
- **Combo plugin** (`ASUS_Omni_Device`) for devices that expose keyboard and mouse on a single USB interface.

### Corsair Commander Core

- **RGB control** of attached fans and pumps.
- **Shutdown Mode**: choose between the SignalRGB shutdown color or returning to the hardware profile on exit.

### ASUS GPUs (Ampere / Lovelace) — ⚠️ SMBUS

- **RGB control of the GPU backplate / shroud** for ASUS RTX 30 / 40 series cards via SMBUS.
- See the SMBUS warning above.

## Installation

### Option 1: GitHub Repo direkt in SignalRGB einbinden (empfohlen)

SignalRGB unterstützt das direkte Einbinden von GitHub-Repositories als Plugin-Quelle:

1. Öffne SignalRGB und gehe zu **Settings** → **Plugins**
2. Klicke auf **Add Plugin Repository**
3. Gib folgende URL ein:

   ```text
   https://github.com/Delido/signalrgb-plugins
   ```

4. Klicke auf **Add** und dann **Reload Plugins**
5. Die Plugins erscheinen nun in der Plugin-Liste und erhalten automatisch Updates.

### Option 2: Manuelle Installation

1. Lade die gewünschte `.js` Datei aus diesem Repository herunter.
2. Kopiere sie in das SignalRGB-Plugin-Verzeichnis:
   - Standard-Pfad: `%DOCUMENTS%\WhirlwindFX\Plugins`
3. Starte SignalRGB neu oder klicke in den Einstellungen auf **Reload Plugins**.
4. Dein Gerät erscheint nun unter **Devices**.

## Compatibility

These plugins were developed and tested with SignalRGB. They follow the standard SignalRGB plugin API. Compatibility with future versions of SignalRGB is not guaranteed.

## Disclaimer

This project is not affiliated with, endorsed by, or in any way officially connected with SignalRGB, WhirlwindFX, ASUS, Corsair, or Logitech. All product names, logos, and brands are property of their respective owners.

**USE THESE PLUGINS AT YOUR OWN RISK.**
