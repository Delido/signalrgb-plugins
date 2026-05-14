"""Device registry — single source of truth for supported peripherals.

Each entry captures the USB IDs plus any device-specific protocol constants
the feature modules need. Adding a new supported device = one entry here +
its UI dropdown option appears automatically.

`auto` selection: pick the first listed entry whose USB IDs are present on
the system. User can override via UI to force a specific device or `none`.
"""
import logging

import pywinusb.hid as hid


# Keyboard (Game Mode feature). Currently one entry; structure allows
# adding more Bragi-v2 keyboards (Vanguard 96 non-Pro 0x2B0D, etc.).
SUPPORTED_KEYBOARDS = {
    "vanguard_pro_96": {
        "label": "Corsair Vanguard Pro 96",
        "vid": 0x1B1C,
        "pid": 0x2B0E,
        "usage_page": 0xFF42,
        "usage": 0x0001,
    },
}

# Headset (Mic Mute Mirror feature). mic_register and wireless_mode differ
# between models — captured here so the feature module is device-agnostic.
SUPPORTED_HEADSETS = {
    "virtuoso_xt": {
        "label": "Corsair Virtuoso XT Wireless",
        "vid": 0x1B1C,
        "pid": 0x0A64,
        "event_usage_page": 0xFF42,
        "event_usage": 0x0002,    # col06 — passive event channel
        "cmd_usage_page": 0xFF42,
        "cmd_usage": 0x0001,      # col05 — command channel
        "mic_register": 0x46,
        "led_echo_register": 0x8E,
        "wireless_mode": 0x09,    # vs 0x08 for wired
    },
    # Future: HS80 (mic_register=0xA6, different PID), wired Virtuoso etc.
}


def _is_present(vid: int, pid: int) -> bool:
    return bool(hid.HidDeviceFilter(vendor_id=vid, product_id=pid).get_devices())


def resolve_keyboard(config_key: str):
    """Returns the device dict for the configured keyboard, or None if
    `config_key == "none"` or the device isn't connected."""
    if config_key == "none":
        return None
    if config_key == "auto":
        for key, spec in SUPPORTED_KEYBOARDS.items():
            if _is_present(spec["vid"], spec["pid"]):
                logging.info(f"[devices] keyboard auto → {key}")
                return spec
        return None
    return SUPPORTED_KEYBOARDS.get(config_key)


def resolve_headset(config_key: str):
    if config_key == "none":
        return None
    if config_key == "auto":
        for key, spec in SUPPORTED_HEADSETS.items():
            if _is_present(spec["vid"], spec["pid"]):
                logging.info(f"[devices] headset auto → {key}")
                return spec
        return None
    return SUPPORTED_HEADSETS.get(config_key)


def keyboard_choices():
    """For UI dropdown: [(key, label)] including auto+none."""
    return [("auto", "Auto-detect"), ("none", "Disabled")] + [
        (k, v["label"]) for k, v in SUPPORTED_KEYBOARDS.items()
    ]


def headset_choices():
    return [("auto", "Auto-detect"), ("none", "Disabled")] + [
        (k, v["label"]) for k, v in SUPPORTED_HEADSETS.items()
    ]
