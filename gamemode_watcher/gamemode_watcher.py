"""GameMode Watcher — tray app that toggles Corsair Vanguard Pro 96 Game Mode
based on running processes.

Watches a user-configurable list of executable names. When any matching
process is running, sends setProperty(0xE1)=1 over HID to engage Game Mode;
when none are running, sends =0. SignalRGB plugin syncs its internal state
(polling rate, FlashTap dependency) via FetchProperty polling — no conflict.

Run modes:
  gamemode_watcher.exe              → tray icon + background watcher
  gamemode_watcher.exe --settings   → settings dialog only (spawned by tray)
"""
import json
import logging
import os
import subprocess
import sys
import threading
from pathlib import Path

import psutil
import pystray
import pywinusb.hid as hid
from PIL import Image, ImageDraw

APP_NAME = "GameModeWatcher"
CONFIG_DIR = Path(os.getenv("APPDATA", str(Path.home()))) / APP_NAME
CONFIG_PATH = CONFIG_DIR / "config.json"
LOG_PATH = CONFIG_DIR / "watcher.log"

DEFAULTS = {
    "poll_interval_seconds": 2.0,
    "game_executables": [],
    "enabled": True,
}

# Vanguard Pro 96 HID descriptors (probed in toggle_gamemode.py).
VID = 0x1B1C
PID = 0x2B0E
TARGET_USAGE_PAGE = 0xFF42
TARGET_USAGE = 0x0001  # command channel; 0x0002 is read-only notifications


# ---------------------------------------------------------------- config

def load_config():
    if not CONFIG_PATH.exists():
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        save_config(DEFAULTS)
        return dict(DEFAULTS)
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        for k, v in DEFAULTS.items():
            cfg.setdefault(k, v)
        return cfg
    except Exception:
        logging.exception("load_config failed; using defaults")
        return dict(DEFAULTS)


def save_config(cfg):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)


# ---------------------------------------------------------------- keyboard

class KeyboardController:
    """Owns the HID handle to the Vanguard Pro 96 command interface. Auto-
    reconnects if the device disappears (USB reset, plugin reload, etc.)."""

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
                    logging.info(f"Opened keyboard command interface: {d.device_path}")
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
            logging.exception("set_game_mode failed; will reopen next time")
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


# ---------------------------------------------------------------- watcher

class ProcessWatcher(threading.Thread):
    """Background thread polling the process list against the configured
    whitelist. Writes to the keyboard only on state transitions."""

    def __init__(self, keyboard, get_config, on_state_change=None):
        super().__init__(daemon=True, name="ProcessWatcher")
        self.keyboard = keyboard
        self.get_config = get_config
        self.on_state_change = on_state_change
        self._stop = threading.Event()
        self.last_state = None  # None | True | False

    def stop(self):
        self._stop.set()

    def _current_processes(self):
        names = set()
        for p in psutil.process_iter(["name"]):
            n = p.info.get("name")
            if n:
                names.add(n.lower())
        return names

    def run(self):
        while not self._stop.is_set():
            cfg = self.get_config()
            interval = max(0.5, float(cfg.get("poll_interval_seconds", 2.0)))

            if cfg.get("enabled", True):
                whitelist = {name.lower() for name in cfg.get("game_executables", []) if name}
                desired = bool(whitelist and (whitelist & self._current_processes()))
                if desired != self.last_state:
                    if self.keyboard.set_game_mode(desired):
                        self.last_state = desired
                        logging.info(f"Game Mode → {'ON' if desired else 'OFF'}")
                        if self.on_state_change:
                            try:
                                self.on_state_change(desired)
                            except Exception:
                                logging.exception("on_state_change callback failed")
                    else:
                        logging.warning("Keyboard write failed; will retry next tick")
            self._stop.wait(interval)


# ---------------------------------------------------------------- icon

def make_icon(active: bool) -> Image.Image:
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    fill = (220, 50, 50) if active else (110, 110, 110)
    draw.ellipse([6, 6, 58, 58], fill=fill, outline=(20, 20, 20), width=2)
    # crude "G" — two rectangles forming a C-with-leg
    draw.rectangle([20, 20, 44, 26], fill=(255, 255, 255))
    draw.rectangle([20, 20, 26, 44], fill=(255, 255, 255))
    draw.rectangle([20, 38, 44, 44], fill=(255, 255, 255))
    draw.rectangle([34, 32, 44, 44], fill=(255, 255, 255))
    return img


# ---------------------------------------------------------------- settings dialog

def run_settings_dialog():
    import tkinter as tk
    from tkinter import messagebox, simpledialog, ttk

    cfg = load_config()

    root = tk.Tk()
    root.title("GameMode Watcher — Settings")
    root.geometry("460x500")
    root.minsize(380, 400)

    ttk.Label(
        root,
        text="Executable names that trigger Game Mode\n(case-insensitive, exact match on process name):",
        justify="left",
    ).pack(pady=(10, 4), padx=10, anchor="w")

    list_frame = ttk.Frame(root)
    list_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=4)

    scrollbar = ttk.Scrollbar(list_frame)
    scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

    listbox = tk.Listbox(list_frame, yscrollcommand=scrollbar.set, selectmode=tk.EXTENDED)
    for exe in cfg["game_executables"]:
        listbox.insert(tk.END, exe)
    listbox.pack(fill=tk.BOTH, expand=True)
    scrollbar.config(command=listbox.yview)

    btn_frame = ttk.Frame(root)
    btn_frame.pack(fill=tk.X, padx=10, pady=4)

    def add_manual():
        name = simpledialog.askstring(
            "Add Executable", "Executable name (e.g. Cyberpunk2077.exe):", parent=root
        )
        if name and name.strip():
            listbox.insert(tk.END, name.strip())

    def add_running():
        running = sorted({
            p.info["name"] for p in psutil.process_iter(["name"]) if p.info.get("name")
        }, key=str.lower)
        dlg = tk.Toplevel(root)
        dlg.title("Pick running processes")
        dlg.geometry("400x460")
        dlg.transient(root)

        ttk.Label(dlg, text="Select one or more (Ctrl/Shift):").pack(pady=(10, 4))

        f = ttk.Frame(dlg)
        f.pack(fill=tk.BOTH, expand=True, padx=10)
        sb = ttk.Scrollbar(f)
        sb.pack(side=tk.RIGHT, fill=tk.Y)
        lb = tk.Listbox(f, yscrollcommand=sb.set, selectmode=tk.EXTENDED)
        for name in running:
            lb.insert(tk.END, name)
        lb.pack(fill=tk.BOTH, expand=True)
        sb.config(command=lb.yview)

        def pick():
            for i in lb.curselection():
                listbox.insert(tk.END, lb.get(i))
            dlg.destroy()

        bb = ttk.Frame(dlg)
        bb.pack(fill=tk.X, padx=10, pady=8)
        ttk.Button(bb, text="Add Selected", command=pick).pack(side=tk.RIGHT, padx=2)
        ttk.Button(bb, text="Cancel", command=dlg.destroy).pack(side=tk.RIGHT, padx=2)

    def remove_sel():
        for i in reversed(listbox.curselection()):
            listbox.delete(i)

    ttk.Button(btn_frame, text="Add…", command=add_manual).pack(side=tk.LEFT, padx=2)
    ttk.Button(btn_frame, text="Add from Running…", command=add_running).pack(side=tk.LEFT, padx=2)
    ttk.Button(btn_frame, text="Remove Selected", command=remove_sel).pack(side=tk.LEFT, padx=2)

    ttk.Separator(root, orient="horizontal").pack(fill=tk.X, padx=10, pady=8)

    interval_frame = ttk.Frame(root)
    interval_frame.pack(fill=tk.X, padx=10)
    ttk.Label(interval_frame, text="Poll interval (seconds):").pack(side=tk.LEFT)
    interval_var = tk.StringVar(value=str(cfg["poll_interval_seconds"]))
    ttk.Entry(interval_frame, textvariable=interval_var, width=8).pack(side=tk.LEFT, padx=6)

    ttk.Label(
        root,
        text=f"Config file: {CONFIG_PATH}\nLog file: {LOG_PATH}",
        foreground="#666",
        justify="left",
    ).pack(pady=(8, 0), padx=10, anchor="w")

    bottom = ttk.Frame(root)
    bottom.pack(fill=tk.X, padx=10, pady=10)

    def save_and_close():
        try:
            interval = float(interval_var.get())
            if interval < 0.5:
                messagebox.showerror("Invalid", "Poll interval must be at least 0.5s")
                return
        except ValueError:
            messagebox.showerror("Invalid", "Poll interval must be a number")
            return
        cfg["game_executables"] = [listbox.get(i) for i in range(listbox.size())]
        cfg["poll_interval_seconds"] = interval
        save_config(cfg)
        root.destroy()

    ttk.Button(bottom, text="Save", command=save_and_close).pack(side=tk.RIGHT, padx=2)
    ttk.Button(bottom, text="Cancel", command=root.destroy).pack(side=tk.RIGHT, padx=2)

    root.mainloop()


# ---------------------------------------------------------------- tray app

class TrayApp:
    def __init__(self):
        self.keyboard = KeyboardController()
        self.watcher = ProcessWatcher(
            self.keyboard, get_config=load_config, on_state_change=self._on_state_change
        )
        self.icon = None

    def _on_state_change(self, active: bool):
        if self.icon:
            self.icon.icon = make_icon(active)
            self.icon.title = f"GameMode Watcher — Game Mode {'ON' if active else 'OFF'}"

    def _spawn_settings(self):
        if getattr(sys, "frozen", False):
            subprocess.Popen([sys.executable, "--settings"])
        else:
            subprocess.Popen([sys.executable, __file__, "--settings"])

    def _toggle_paused(self, icon, item):
        cfg = load_config()
        cfg["enabled"] = not cfg.get("enabled", True)
        save_config(cfg)
        if not cfg["enabled"] and self.watcher.last_state:
            # turn GM off when pausing if it was on
            self.keyboard.set_game_mode(False)
            self.watcher.last_state = False
            self._on_state_change(False)

    def _is_paused(self, item):
        return not load_config().get("enabled", True)

    def _quit(self):
        logging.info("Quit requested")
        self.watcher.stop()
        self.keyboard.close()
        if self.icon:
            self.icon.stop()

    def run(self):
        self.watcher.start()
        menu = pystray.Menu(
            pystray.MenuItem("Settings…", self._spawn_settings),
            pystray.MenuItem("Paused", self._toggle_paused, checked=self._is_paused),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", self._quit),
        )
        self.icon = pystray.Icon(
            "GameModeWatcher", make_icon(False), "GameMode Watcher — Game Mode OFF", menu
        )
        self.icon.run()


# ---------------------------------------------------------------- main

def main():
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.FileHandler(str(LOG_PATH), encoding="utf-8"),
        ],
    )

    if len(sys.argv) > 1 and sys.argv[1] == "--settings":
        run_settings_dialog()
        return

    logging.info(f"=== {APP_NAME} starting ===")
    try:
        TrayApp().run()
    except Exception:
        logging.exception("Tray app crashed")
        raise


if __name__ == "__main__":
    main()
