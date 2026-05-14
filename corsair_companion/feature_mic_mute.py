"""Mic mute mirror feature.

Listens to the Corsair Virtuoso XT Wireless event channel for the
"mic mute state changed" notification (event format `03 01 01 46 00 <V>`,
verified against Corsair_Headset_Controller.js drainPassiveEvents). When the
hardware mute button is pressed, mirrors the new state to the Windows
default microphone via the Core Audio API (pycaw).

Why not just rely on SignalRGB's plugin? The plugin only reads state to
drive its LED color and does NOT propagate the change to Windows audio.
This tool fills that gap.
"""
import logging
import threading
import time

import comtypes
import pywinusb.hid as hid
from comtypes import CLSCTX_ALL, POINTER, cast
from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume

# pywinusb delivers reports on its own worker thread which hasn't called
# CoInitialize. Any pycaw/comtypes call from that thread raises
# `CoInitialize wurde nicht aufgerufen`. We init the apartment once per
# thread via a thread-local flag.
_com_init = threading.local()


def _ensure_com_initialized():
    if not getattr(_com_init, "done", False):
        try:
            comtypes.CoInitialize()
        except OSError:
            # Already initialized (different apartment, or re-entered) — fine.
            pass
        _com_init.done = True

# Virtuoso XT Wireless (extendable: HS80 = 0xA6 register, different PID).
VID = 0x1B1C
PID = 0x0A64
EVENT_USAGE_PAGE = 0xFF42
EVENT_USAGE = 0x0002      # col06 — passive event channel (read-only)
CMD_USAGE = 0x0001        # col05 — command channel (read/write)
MIC_REGISTER = 0x46
LED_ECHO_REGISTER = 0x8E  # iCUE writes this paired with the mic register so the headset's mute-LED updates
WIRELESS_MODE = 0x09      # 0x09 for wireless dongle; 0x08 for wired (HS80 etc.)


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


class HeadsetMicWatcher(threading.Thread):
    """Opens the Virtuoso XT event channel and listens for hardware-mute
    state changes. Calls the controller on each transition.

    pywinusb's set_raw_data_handler delivers reports on a worker thread; we
    only need this thread to keep the device handle alive and to attempt
    reconnects when the headset goes offline (dongle disconnect, sleep)."""

    def __init__(self, mic_controller, get_config, on_state_change=None):
        super().__init__(daemon=True, name="HeadsetMicWatcher")
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
        for d in hid.HidDeviceFilter(vendor_id=VID, product_id=PID).get_devices():
            try:
                d.open()
                caps = d.hid_caps
                if caps and caps.usage_page == EVENT_USAGE_PAGE and caps.usage == EVENT_USAGE:
                    d.set_raw_data_handler(self._on_report)
                    self._device = d
                    logging.info("[mic_mute] Listening on Virtuoso XT event channel")
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
        # Empirically verified report layout on the col06 event channel of the
        # Virtuoso XT Wireless (see watcher.log dumps): pywinusb does NOT
        # prepend a report-ID byte here, so wire bytes start at data[0]:
        #     [0x03, 0x01, 0x01, <reg>, 0x00, <V>, 0x00...]
        # Filter `03 01 01` matches the plugin's drainPassiveEvents prefix;
        # other prefixes (e.g. `03 01 02`) are ack/state events we ignore.
        if len(data) < 6:
            return
        if data[0] != 0x03 or data[1] != 0x01 or data[2] != 0x01:
            return
        if data[3] != MIC_REGISTER:
            return
        muted = bool(data[5])
        if muted == self.last_state:
            return
        self.last_state = muted

        if not self.get_config().get("mic_mute_mirror", {}).get("enabled", True):
            logging.info(f"[mic_mute] hardware → {'MUTED' if muted else 'UNMUTED'} (feature disabled, ignoring)")
            return

        if self.mic.set_mute(muted):
            logging.info(f"[mic_mute] hardware → {'MUTED' if muted else 'UNMUTED'} → Windows mic synced")
            if self.on_state_change:
                try:
                    self.on_state_change(muted)
                except Exception:
                    logging.exception("[mic_mute] state callback failed")
        else:
            logging.warning("[mic_mute] mic toggle failed")

    def run(self):
        # Try-open with reconnect loop. Headset disappears when dongle is
        # unplugged or user powers it off — sleep and retry.
        while not self._stop.is_set():
            if self._device is None:
                if not self._open():
                    # Backoff: don't spam HID enumeration when nothing's there
                    self._stop.wait(5.0)
                    continue
            # Device is open; pywinusb worker thread feeds _on_report.
            # We just sleep and periodically check the handle.
            self._stop.wait(2.0)
            # No good way to detect "device went away" from pywinusb other
            # than the next read failing. We rely on _on_report errors or
            # explicit unplug events. For now, keep handle until stop().


class HeadsetMuteWriter:
    """Pushes mute state to the Virtuoso XT command channel (col05).

    iCUE writes the mute-toggle as TWO sequential SET commands:
        02 09 01 8E 00 <V>   — register 0x8E (LED feedback echo, updates mute LED)
        02 09 01 46 00 <V>   — register 0x46 (actual mic mute state)
    Verified bytes in dumps/corsair_headset/corsair_headset_unmute_mute.pcapng
    frames 111/115 (unmute) and 177/181 (mute).
    """

    def __init__(self):
        self._device = None

    def _open(self):
        self._close()
        for d in hid.HidDeviceFilter(vendor_id=VID, product_id=PID).get_devices():
            try:
                d.open()
                caps = d.hid_caps
                if caps and caps.usage_page == EVENT_USAGE_PAGE and caps.usage == CMD_USAGE:
                    self._device = d
                    logging.info("[mic_mute/writer] Opened Virtuoso XT command channel")
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

    close = _close  # public alias

    def _send_set(self, register, value):
        """Send a single `02 09 01 <reg> 00 <V>` SET command.

        Critical: this collection's output report is *numbered* with
        report_id=0x02, NOT unnumbered (0x00) like the keyboard's. For
        numbered reports pywinusb expects payload[0] to be the report ID
        AND that byte IS transmitted on the wire as the first byte. So the
        leading `0x02` doubles as both the report ID and the conn-byte the
        headset firmware expects — exactly how iCUE's writes look in
        dumps/corsair_headset/corsair_headset_unmute_mute.pcapng."""
        reports = self._device.find_output_reports()
        if not reports:
            return False
        report = reports[0]
        out_len = self._device.hid_caps.output_report_byte_length or 65
        payload = bytearray(out_len)
        wire = [0x02, WIRELESS_MODE, 0x01, register, 0x00, value]
        for i, b in enumerate(wire):
            if i >= out_len:
                break
            payload[i] = b
        report.set_raw_data(list(payload))
        return bool(report.send())

    def set_mute(self, muted: bool) -> bool:
        if self._device is None and not self._open():
            return False
        v = 0x01 if muted else 0x00
        try:
            # iCUE sends LED echo first, then mic state — preserve that order
            # so the LED color flips before the mic actually mutes.
            ok1 = self._send_set(LED_ECHO_REGISTER, v)
            ok2 = self._send_set(MIC_REGISTER, v)
            return ok1 and ok2
        except Exception:
            logging.exception("[mic_mute/writer] send failed; will reopen next time")
            self._close()
            return False


class WindowsMicMuteWatcher(threading.Thread):
    """Polls the Windows default mic mute state and mirrors it to the
    headset hardware. Counterpart to HeadsetMicWatcher — together they
    form a bidirectional sync.

    Echo-suppression: each watcher only triggers a write when its OWN side
    changes. After a hardware press, HeadsetMicWatcher writes to Windows,
    we observe the change here and write back to the headset (which is
    already in the requested state — a one-shot redundant write, NOT a
    loop, because writing the same value doesn't produce a real state
    change worth re-emitting).
    """

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
                        # First reading: seed without action.
                        self.last_state = cur
                    elif cur != self.last_state:
                        self.last_state = cur
                        if self.get_config().get("mic_mute_mirror", {}).get("enabled", True):
                            logging.info(f"[mic_mute/win] Windows mic → {'MUTED' if cur else 'UNMUTED'} → syncing headset")
                            self.headset.set_mute(cur)
                        else:
                            logging.info(f"[mic_mute/win] Windows mic → {'MUTED' if cur else 'UNMUTED'} (feature disabled)")
            except Exception:
                logging.exception("[mic_mute/win] poll failed")
            self._stop.wait(self.poll_interval)
