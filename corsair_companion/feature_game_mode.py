"""Game Mode auto-toggle feature.

Watches Windows processes and toggles the configured Corsair keyboard's
hardware Game Mode property over USB when any whitelisted executable is
running. The SignalRGB plugin's `syncGameModeFromHardware` polling picks
up the change within 3s and runs its dependency chain (Polling Rate
switch + FlashTap state + lighting refresh) — no conflict because both
processes share the HID device cleanly on Windows."""
import logging
import threading

import psutil
import pywinusb.hid as hid


class KeyboardController:
    """Owns the HID handle to the configured keyboard's command interface.
    Auto-reconnects if the device disappears (USB reset, plugin reload).
    `device_spec` is the dict from devices.SUPPORTED_KEYBOARDS; None means
    feature is disabled at the device level."""

    def __init__(self, device_spec):
        self.spec = device_spec
        self._device = None

    def _open(self):
        if not self.spec:
            return False
        if self._device:
            try:
                self._device.close()
            except Exception:
                pass
            self._device = None
        for d in hid.HidDeviceFilter(vendor_id=self.spec["vid"], product_id=self.spec["pid"]).get_devices():
            try:
                d.open()
                caps = d.hid_caps
                if caps and caps.usage_page == self.spec["usage_page"] and caps.usage == self.spec["usage"]:
                    self._device = d
                    logging.info(f"[game_mode] Opened {self.spec['label']} command interface")
                    return True
                d.close()
            except Exception:
                try:
                    d.close()
                except Exception:
                    pass
        return False

    def set_game_mode(self, enabled: bool) -> bool:
        if not self.spec:
            return False
        if not self._device and not self._open():
            return False
        try:
            out_len = self._device.hid_caps.output_report_byte_length or 65
            payload = bytearray(out_len)
            # Wire bytes (matches SignalRGB plugin's setHardwareGameMode):
            #   00 01 02 01 E1 00 <0|1>
            # Prefixed with HID report-ID byte 0x00 (unnumbered report).
            wire = [0x00, 0x00, 0x01, 0x02, 0x01, 0xE1, 0x00, 0x01 if enabled else 0x00]
            for i, b in enumerate(wire):
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

            if section.get("enabled", True) and self.keyboard.spec:
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
