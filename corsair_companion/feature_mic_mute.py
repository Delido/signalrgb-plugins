"""Mic mute mirror — bidirectional sync between the Virtuoso XT (or any
other supported headset) hardware mute button and the Windows default
microphone.

Two directions, independently togglable in settings:
  - hardware_to_windows: headset button → IAudioEndpointVolume.SetMute
  - windows_to_hardware: Windows mute → headset SET-property pair

Headset-specific constants live in `devices.SUPPORTED_HEADSETS`. The device
is selected once at app startup via config.mic_mute_mirror.device (auto or
specific key) and passed to both watcher/writer."""
import logging
import threading

import comtypes
import pywinusb.hid as hid
from comtypes import CLSCTX_ALL, POINTER, cast
from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume


# COM apartment init per-thread. pywinusb's worker thread (where mic-event
# reports arrive) hasn't called CoInitialize; pycaw calls from there raise
# OSError [-2147221008]. Guard via thread-local flag.
_com_init = threading.local()


def _ensure_com_initialized():
    if not getattr(_com_init, "done", False):
        try:
            comtypes.CoInitialize()
        except OSError:
            pass
        _com_init.done = True


# ─────────────────────────── Windows-side controller ────────────────────────

class MicController:
    """Cached IAudioEndpointVolume on the Windows default microphone."""

    def __init__(self):
        self._volume = None

    def _open(self):
        _ensure_com_initialized()
        try:
            mic = AudioUtilities.GetMicrophone()
            interface = mic.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
            self._volume = cast(interface, POINTER(IAudioEndpointVolume))
            return True
        except Exception:
            logging.exception("[mic_mute] failed to open default microphone")
            self._volume = None
            return False

    def set_mute(self, muted: bool) -> bool:
        _ensure_com_initialized()
        if self._volume is None and not self._open():
            return False
        try:
            self._volume.SetMute(1 if muted else 0, None)
            return True
        except Exception:
            logging.exception("[mic_mute] SetMute failed; will reopen next time")
            self._volume = None
            return False

    def get_mute(self):
        _ensure_com_initialized()
        if self._volume is None and not self._open():
            return None
        try:
            return bool(self._volume.GetMute())
        except Exception:
            self._volume = None
            return None


# ─────────────────────────── Headset event listener ─────────────────────────

class HeadsetMicWatcher(threading.Thread):
    """Listens on the headset event channel for hardware-mute state changes
    and (when the hardware_to_windows direction is enabled) mirrors the new
    state to the Windows default mic."""

    def __init__(self, device_spec, mic_controller, get_config, on_state_change=None):
        super().__init__(daemon=True, name="HeadsetMicWatcher")
        self.spec = device_spec   # None = feature disabled
        self.mic = mic_controller
        self.get_config = get_config
        self.on_state_change = on_state_change
        self._stop = threading.Event()
        self._device = None
        self.last_state = None

    def stop(self):
        self._stop.set()
        self._close()

    def _open(self):
        self._close()
        if not self.spec:
            return False
        for d in hid.HidDeviceFilter(vendor_id=self.spec["vid"], product_id=self.spec["pid"]).get_devices():
            try:
                d.open()
                caps = d.hid_caps
                if (caps and caps.usage_page == self.spec["event_usage_page"]
                        and caps.usage == self.spec["event_usage"]):
                    d.set_raw_data_handler(self._on_report)
                    self._device = d
                    logging.info(f"[mic_mute] Listening on {self.spec['label']} event channel")
                    return True
                d.close()
            except Exception:
                try:
                    d.close()
                except Exception:
                    pass
        return False

    def _close(self):
        if self._device:
            try:
                self._device.close()
            except Exception:
                pass
            self._device = None

    def _on_report(self, data):
        # Event format: `03 01 01 <mic_register> 00 <V>` (verified empirically).
        # pywinusb does NOT prepend a report-ID byte on this collection — data[0]
        # is the first wire byte directly.
        if len(data) < 6:
            return
        if data[0] != 0x03 or data[1] != 0x01 or data[2] != 0x01:
            return
        if data[3] != self.spec["mic_register"]:
            return
        muted = bool(data[5])
        if muted == self.last_state:
            return
        self.last_state = muted

        cfg = self.get_config().get("mic_mute_mirror", {})
        if not cfg.get("enabled", True) or not cfg.get("hardware_to_windows", True):
            logging.info(f"[mic_mute] hardware → {'MUTED' if muted else 'UNMUTED'} (HW→Win disabled)")
            if self.on_state_change:
                try: self.on_state_change(muted)
                except Exception: logging.exception("[mic_mute] state callback failed")
            return

        if self.mic.set_mute(muted):
            logging.info(f"[mic_mute] hardware → {'MUTED' if muted else 'UNMUTED'} → Windows mic synced")
            if self.on_state_change:
                try: self.on_state_change(muted)
                except Exception: logging.exception("[mic_mute] state callback failed")
        else:
            logging.warning("[mic_mute] mic toggle failed")

    def run(self):
        if not self.spec:
            return
        while not self._stop.is_set():
            if self._device is None:
                if not self._open():
                    self._stop.wait(5.0)
                    continue
            self._stop.wait(2.0)


# ─────────────────────────── Headset command writer ─────────────────────────

class HeadsetMuteWriter:
    """Pushes mute state to the headset command channel as a paired SET:
    register `led_echo_register` then `mic_register`, both with the same
    value byte. Wire bytes follow iCUE exactly (see
    dumps/corsair_headset/corsair_headset_unmute_mute.pcapng).

    Critical: this collection's output report is *numbered* with
    `report_id=0x02`. pywinusb expects payload[0] to be the report ID AND
    that byte IS transmitted on the wire — so the leading 0x02 doubles as
    both the report ID and the conn-byte the firmware expects."""

    def __init__(self, device_spec):
        self.spec = device_spec
        self._device = None

    def _open(self):
        self._close()
        if not self.spec:
            return False
        for d in hid.HidDeviceFilter(vendor_id=self.spec["vid"], product_id=self.spec["pid"]).get_devices():
            try:
                d.open()
                caps = d.hid_caps
                if (caps and caps.usage_page == self.spec["cmd_usage_page"]
                        and caps.usage == self.spec["cmd_usage"]):
                    self._device = d
                    logging.info(f"[mic_mute/writer] Opened {self.spec['label']} command channel")
                    return True
                d.close()
            except Exception:
                try:
                    d.close()
                except Exception:
                    pass
        return False

    def _close(self):
        if self._device:
            try:
                self._device.close()
            except Exception:
                pass
            self._device = None

    close = _close

    def _send_set(self, register, value):
        reports = self._device.find_output_reports()
        if not reports:
            return False
        report = reports[0]
        out_len = self._device.hid_caps.output_report_byte_length or 65
        payload = bytearray(out_len)
        wire = [0x02, self.spec["wireless_mode"], 0x01, register, 0x00, value]
        for i, b in enumerate(wire):
            if i >= out_len:
                break
            payload[i] = b
        report.set_raw_data(list(payload))
        return bool(report.send())

    def set_mute(self, muted: bool) -> bool:
        if not self.spec:
            return False
        if self._device is None and not self._open():
            return False
        v = 0x01 if muted else 0x00
        try:
            ok1 = self._send_set(self.spec["led_echo_register"], v)
            ok2 = self._send_set(self.spec["mic_register"], v)
            return ok1 and ok2
        except Exception:
            logging.exception("[mic_mute/writer] send failed; will reopen next time")
            self._close()
            return False


# ─────────────────────────── Windows-side watcher ───────────────────────────

class WindowsMicMuteWatcher(threading.Thread):
    """Polls Windows mic mute state; on change, mirrors to headset (when
    the windows_to_hardware direction is enabled)."""

    def __init__(self, mic_controller, headset_writer, get_config):
        super().__init__(daemon=True, name="WindowsMicMuteWatcher")
        self.mic = mic_controller
        self.headset = headset_writer
        self.get_config = get_config
        self._stop = threading.Event()
        self.last_state = None
        self.poll_interval = 0.5

    def stop(self):
        self._stop.set()

    def run(self):
        while not self._stop.is_set():
            try:
                cur = self.mic.get_mute()
                if cur is not None:
                    if self.last_state is None:
                        self.last_state = cur
                    elif cur != self.last_state:
                        self.last_state = cur
                        cfg = self.get_config().get("mic_mute_mirror", {})
                        if cfg.get("enabled", True) and cfg.get("windows_to_hardware", True):
                            logging.info(f"[mic_mute/win] Windows mic → {'MUTED' if cur else 'UNMUTED'} → syncing headset")
                            self.headset.set_mute(cur)
                        else:
                            logging.info(f"[mic_mute/win] Windows mic → {'MUTED' if cur else 'UNMUTED'} (Win→HW disabled)")
            except Exception:
                logging.exception("[mic_mute/win] poll failed")
            self._stop.wait(self.poll_interval)
