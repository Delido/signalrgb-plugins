"""Mic Drift Logger — background diagnostic for the "mic suddenly twice as
loud" bug.

Snapshots the Windows default-microphone state every N seconds and logs
any change. Catches:
  - Master volume scalar (slider 0..1) drift
  - Master volume dB drift
  - Mute toggles outside our own actions
  - Registry FxProperties + Properties value diffs (boost lives here on
    USB audio drivers)
  - Default-device-id changes (e.g. dongle re-enumerated)

This is the in-app integration of dev_probes/probe_mic_drift.py; runs
silently until a change is detected, then writes a `[mic_drift]` block to
watcher.log so we can correlate with timestamps of suspected triggers
(SignalRGB reload, headset disconnect, etc.)."""
import logging
import threading
import warnings
import winreg

from comtypes import CLSCTX_ALL, POINTER, cast
from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume

from feature_mic_mute import _ensure_com_initialized

# Suppress pycaw's noisy "COMError getting property 68/69" warnings emitted
# whenever GetAllDevices() walks an endpoint that doesn't expose property
# pages. They flood stderr without indicating anything actionable.
warnings.filterwarnings("ignore", category=UserWarning, module="pycaw.utils")

MMDEVICES_BASE = r"SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Capture"


def _read_subkey_values(full_key_path):
    out = {}
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, full_key_path) as k:
            i = 0
            while True:
                try:
                    name, value, _ = winreg.EnumValue(k, i)
                except OSError:
                    break
                out[name] = value.hex() if isinstance(value, bytes) else repr(value)
                i += 1
    except FileNotFoundError:
        pass
    except OSError as e:
        out["<error>"] = repr(e)
    return out


def _read_device_registry(device_id):
    """All values under FxProperties + Properties for this mic device."""
    if "}." not in device_id:
        return {}
    suffix = device_id.split("}.", 1)[1]
    base = f"{MMDEVICES_BASE}\\{suffix}"
    out = {}
    for sub in ("FxProperties", "Properties"):
        for k, v in _read_subkey_values(f"{base}\\{sub}").items():
            out[f"{sub}\\{k}"] = v
    return out


class MicDriftLogger(threading.Thread):
    def __init__(self, get_config):
        super().__init__(daemon=True, name="MicDriftLogger")
        self.get_config = get_config
        self._stop = threading.Event()
        self._last = None

    def stop(self):
        self._stop.set()

    def _snapshot(self):
        _ensure_com_initialized()
        mic = AudioUtilities.GetMicrophone()
        dev_id = mic.GetId()
        interface = mic.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
        vol = cast(interface, POINTER(IAudioEndpointVolume))
        scalar = round(vol.GetMasterVolumeLevelScalar(), 4)
        db = round(vol.GetMasterVolumeLevel(), 2)
        muted = bool(vol.GetMute())
        reg = _read_device_registry(dev_id)
        return {
            "id": dev_id,
            "scalar": scalar,
            "db": db,
            "muted": muted,
            "reg": reg,
        }

    def _diff_and_log(self, prev, cur):
        if prev["id"] != cur["id"]:
            logging.warning(f"[mic_drift] DEVICE CHANGED: {prev['id']} → {cur['id']}")
        if prev["scalar"] != cur["scalar"]:
            logging.warning(f"[mic_drift] SLIDER {prev['scalar']} → {cur['scalar']}")
        if prev["db"] != cur["db"]:
            logging.warning(f"[mic_drift] dB {prev['db']} → {cur['db']}")
        if prev["muted"] != cur["muted"]:
            logging.warning(f"[mic_drift] MUTE {prev['muted']} → {cur['muted']}")
        for k in sorted(set(prev["reg"]) | set(cur["reg"])):
            if prev["reg"].get(k) != cur["reg"].get(k):
                logging.warning(f"[mic_drift] REG {k}:")
                logging.warning(f"[mic_drift]     old: {prev['reg'].get(k)}")
                logging.warning(f"[mic_drift]     new: {cur['reg'].get(k)}")

    def run(self):
        logged_init = False
        while not self._stop.is_set():
            section = self.get_config().get("mic_drift_logger", {})
            interval = max(1.0, float(section.get("poll_interval_seconds", 5.0)))

            if section.get("enabled", False):
                try:
                    cur = self._snapshot()
                    if self._last is None:
                        if not logged_init:
                            logging.info(
                                f"[mic_drift] watching — scalar={cur['scalar']} dB={cur['db']} "
                                f"muted={cur['muted']} regKeys={len(cur['reg'])}"
                            )
                            logged_init = True
                        self._last = cur
                    elif cur != self._last:
                        self._diff_and_log(self._last, cur)
                        self._last = cur
                except Exception:
                    logging.exception("[mic_drift] snapshot failed")
            else:
                # Reset state so re-enabling re-seeds rather than diffing
                # against pre-disable values.
                self._last = None
                logged_init = False

            self._stop.wait(interval)
