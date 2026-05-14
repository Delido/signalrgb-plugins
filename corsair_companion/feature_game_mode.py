"""Game Mode auto-toggle feature.

Watches Windows processes and toggles the Corsair Vanguard Pro 96 Game Mode
property over USB when any whitelisted executable is running. The SignalRGB
plugin syncs its internal state via FetchProperty polling every 3s, so the
plugin's polling-rate auto-switch and FlashTap dependency follow along
without conflict.
"""
import logging
import threading

import psutil
import pywinusb.hid as hid

# Vanguard Pro 96 (only supported PID for now)
VID = 0x1B1C
PID = 0x2B0E
TARGET_USAGE_PAGE = 0xFF42  # Bragi-v2 vendor-specific command page
TARGET_USAGE = 0x0001       # command channel (0x0002 is read-only notifications)


class KeyboardController:
    """Owns the HID handle to the Vanguard Pro 96 command interface.
    Auto-reconnects if the device disappears (USB reset, plugin reload, etc.)."""

    def __init__(self):
        self._device = None

    def _open(self):
        if self._device:
            try:
                self._device.close()
            except Exception:
                pass
            self._device = None
        for d in hid.HidDeviceFilter(vendor_id=VID, product_id=PID).get_devices():
            try:
                d.open()
                caps = d.hid_caps
                if caps and caps.usage_page == TARGET_USAGE_PAGE and caps.usage == TARGET_USAGE:
                    self._device = d
                    logging.info(f"[game_mode] Opened keyboard command interface")
                    return True
                d.close()
            except Exception:
                try:
                    d.close()
                except Exception:
                    pass
        return False

    def set_game_mode(self, enabled: bool) -> bool:
        if not self._device and not self._open():
            return False
        try:
            out_len = self._device.hid_caps.output_report_byte_length or 65
            payload = bytearray(out_len)
            # Wire bytes (matches SignalRGB plugin's setHardwareGameMode):
            #   00 01 02 01 E1 00 <0|1>
            # Prefixed with HID report-ID byte 0x00.
            wire = [0x00, 0x01, 0x02, 0x01, 0xE1, 0x00, 0x01 if enabled else 0x00]
            for i, b in enumerate(wire, start=1):
                if i >= out_len:
                    break
                payload[i] = b
            reports = self._device.find_output_reports()
            if not reports:
                return False
            report = reports[0]
            report.set_raw_data(list(payload))
            return bool(report.send())
        except Exception:
            logging.exception("[game_mode] write failed; will reopen next time")
            try:
                self._device.close()
            except Exception:
                pass
            self._device = None
            return False

    def close(self):
        if self._device:
            try:
                self._device.close()
            except Exception:
                pass
            self._device = None


class ProcessWatcher(threading.Thread):
    """Polls process list against the configured whitelist. Writes to the
    keyboard only on state transitions."""

    def __init__(self, keyboard, get_config, on_state_change=None):
        super().__init__(daemon=True, name="GameModeProcessWatcher")
        self.keyboard = keyboard
        self.get_config = get_config
        self.on_state_change = on_state_change
        self._stop = threading.Event()
        self.last_state = None

    def stop(self):
        self._stop.set()

    @staticmethod
    def _current_processes():
        names = set()
        for p in psutil.process_iter(["name"]):
            n = p.info.get("name")
            if n:
                names.add(n.lower())
        return names

    def run(self):
        while not self._stop.is_set():
            section = self.get_config().get("game_mode", {})
            interval = max(0.5, float(section.get("poll_interval_seconds", 2.0)))

            if section.get("enabled", True):
                whitelist = {name.lower() for name in section.get("executables", []) if name}
                desired = bool(whitelist and (whitelist & self._current_processes()))
                if desired != self.last_state:
                    if self.keyboard.set_game_mode(desired):
                        self.last_state = desired
                        logging.info(f"[game_mode] → {'ON' if desired else 'OFF'}")
                        if self.on_state_change:
                            try:
                                self.on_state_change(desired)
                            except Exception:
                                logging.exception("[game_mode] state callback failed")
                    else:
                        logging.warning("[game_mode] keyboard write failed; will retry")
            self._stop.wait(interval)
