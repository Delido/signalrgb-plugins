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
| `Corsair_Headset_Controller.js` | Corsair Headsets | USB HID |
| `Corsair_Lighting_Commander_Core.js` | Corsair Commander Core | USB HID |
| `Logitech_Modern_Device.js` | Logitech Devices | USB HID |

### ⚠️ SMBUS Warning

**Modifying SMBUS plugins is DANGEROUS and can DESTROY devices.**
Only use `Asus_Ampere_Lovelace_GPU.js` if you know exactly what you are doing.

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
