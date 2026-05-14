"""Settings dialog — spawned as a subprocess from the tray so tkinter owns
the main thread cleanly.

One tab per feature; each tab has the feature's enable-toggle at the top,
device dropdown (where applicable), direction toggles (mic mirror), and
feature-specific controls (whitelist for game mode, etc.). Footer shows
config + log paths and a "Open log folder" button."""
import os
import subprocess
import tkinter as tk
from pathlib import Path
from tkinter import messagebox, simpledialog, ttk

import psutil

from config import CONFIG_PATH, LOG_PATH, load_config, save_config
from devices import headset_choices, keyboard_choices


# ─────────────────────────── helpers ─────────────────────────────────────────

def _choice_label_for_key(choices, key):
    for k, label in choices:
        if k == key:
            return label
    return choices[0][1] if choices else key


def _choice_key_for_label(choices, label):
    for k, lbl in choices:
        if lbl == label:
            return k
    return choices[0][0] if choices else ""


# ─────────────────────────── tab: game mode ─────────────────────────────────

def _build_game_mode_tab(nb, cfg):
    gm = cfg["game_mode"]
    tab = ttk.Frame(nb, padding=12)
    nb.add(tab, text="Game Mode")

    enabled_var = tk.BooleanVar(value=gm.get("enabled", True))
    ttk.Checkbutton(tab, text="Enable Game Mode auto-toggle", variable=enabled_var).pack(anchor="w", pady=(0, 6))

    # Device selector
    dev_row = ttk.Frame(tab)
    dev_row.pack(fill=tk.X, pady=(0, 8))
    ttk.Label(dev_row, text="Keyboard:").pack(side=tk.LEFT)
    kbd_choices = keyboard_choices()
    kbd_var = tk.StringVar(value=_choice_label_for_key(kbd_choices, gm.get("device", "auto")))
    ttk.Combobox(dev_row, textvariable=kbd_var, values=[lbl for _, lbl in kbd_choices],
                 state="readonly", width=30).pack(side=tk.LEFT, padx=8)

    # Whitelist
    ttk.Label(tab, text="Executable names that trigger Game Mode\n(case-insensitive, exact match on process name):",
              justify="left").pack(anchor="w", pady=(8, 4))

    list_frame = ttk.Frame(tab)
    list_frame.pack(fill=tk.BOTH, expand=True)
    sb = ttk.Scrollbar(list_frame)
    sb.pack(side=tk.RIGHT, fill=tk.Y)
    lb = tk.Listbox(list_frame, yscrollcommand=sb.set, selectmode=tk.EXTENDED, height=8)
    for exe in gm.get("executables", []):
        lb.insert(tk.END, exe)
    lb.pack(fill=tk.BOTH, expand=True)
    sb.config(command=lb.yview)

    btn_row = ttk.Frame(tab)
    btn_row.pack(fill=tk.X, pady=4)

    def add_manual():
        name = simpledialog.askstring("Add Executable", "Executable name (e.g. Cyberpunk2077.exe):", parent=tab.winfo_toplevel())
        if name and name.strip():
            lb.insert(tk.END, name.strip())

    def add_running():
        running = sorted({p.info["name"] for p in psutil.process_iter(["name"]) if p.info.get("name")},
                         key=str.lower)
        dlg = tk.Toplevel(tab.winfo_toplevel())
        dlg.title("Pick running processes")
        dlg.geometry("400x460")
        dlg.transient(tab.winfo_toplevel())
        ttk.Label(dlg, text="Select one or more (Ctrl/Shift):").pack(pady=(10, 4))
        f = ttk.Frame(dlg)
        f.pack(fill=tk.BOTH, expand=True, padx=10)
        sb2 = ttk.Scrollbar(f)
        sb2.pack(side=tk.RIGHT, fill=tk.Y)
        lb2 = tk.Listbox(f, yscrollcommand=sb2.set, selectmode=tk.EXTENDED)
        for n in running:
            lb2.insert(tk.END, n)
        lb2.pack(fill=tk.BOTH, expand=True)
        sb2.config(command=lb2.yview)

        def pick():
            for i in lb2.curselection():
                lb.insert(tk.END, lb2.get(i))
            dlg.destroy()

        bb = ttk.Frame(dlg)
        bb.pack(fill=tk.X, padx=10, pady=8)
        ttk.Button(bb, text="Add Selected", command=pick).pack(side=tk.RIGHT, padx=2)
        ttk.Button(bb, text="Cancel", command=dlg.destroy).pack(side=tk.RIGHT, padx=2)

    def remove_sel():
        for i in reversed(lb.curselection()):
            lb.delete(i)

    ttk.Button(btn_row, text="Add…", command=add_manual).pack(side=tk.LEFT, padx=2)
    ttk.Button(btn_row, text="Add from Running…", command=add_running).pack(side=tk.LEFT, padx=2)
    ttk.Button(btn_row, text="Remove Selected", command=remove_sel).pack(side=tk.LEFT, padx=2)

    interval_row = ttk.Frame(tab)
    interval_row.pack(fill=tk.X, pady=(8, 0))
    ttk.Label(interval_row, text="Poll interval (seconds):").pack(side=tk.LEFT)
    interval_var = tk.StringVar(value=str(gm.get("poll_interval_seconds", 2.0)))
    ttk.Entry(interval_row, textvariable=interval_var, width=8).pack(side=tk.LEFT, padx=6)

    return {
        "enabled": enabled_var,
        "device_label": kbd_var,
        "device_choices": kbd_choices,
        "listbox": lb,
        "interval": interval_var,
    }


# ─────────────────────────── tab: mic mute mirror ───────────────────────────

def _build_mic_mute_tab(nb, cfg):
    m = cfg["mic_mute_mirror"]
    tab = ttk.Frame(nb, padding=12)
    nb.add(tab, text="Mic Mute Mirror")

    enabled_var = tk.BooleanVar(value=m.get("enabled", True))
    ttk.Checkbutton(tab, text="Enable Mic Mute Mirror", variable=enabled_var).pack(anchor="w", pady=(0, 6))

    dev_row = ttk.Frame(tab)
    dev_row.pack(fill=tk.X, pady=(0, 8))
    ttk.Label(dev_row, text="Headset:").pack(side=tk.LEFT)
    hs_choices = headset_choices()
    hs_var = tk.StringVar(value=_choice_label_for_key(hs_choices, m.get("device", "auto")))
    ttk.Combobox(dev_row, textvariable=hs_var, values=[lbl for _, lbl in hs_choices],
                 state="readonly", width=30).pack(side=tk.LEFT, padx=8)

    ttk.Separator(tab, orient="horizontal").pack(fill=tk.X, pady=8)
    ttk.Label(tab, text="Sync directions:", font=("", 9, "bold")).pack(anchor="w")

    hw_to_win = tk.BooleanVar(value=m.get("hardware_to_windows", True))
    ttk.Checkbutton(tab, text="Headset mute button → Windows default mic mute",
                    variable=hw_to_win).pack(anchor="w", padx=12, pady=2)

    win_to_hw = tk.BooleanVar(value=m.get("windows_to_hardware", True))
    ttk.Checkbutton(tab, text="Windows mic mute → Headset hardware (LED + USB-audio)",
                    variable=win_to_hw).pack(anchor="w", padx=12, pady=2)

    ttk.Label(
        tab,
        text=("Why both? Some apps (Discord) bypass the Windows-side mute via "
              "raw audio capture. The Windows→Headset direction cuts the mic\n"
              "at the device level, which Discord cannot bypass."),
        foreground="#666", justify="left", wraplength=460,
    ).pack(anchor="w", padx=12, pady=(4, 0))

    return {
        "enabled": enabled_var,
        "device_label": hs_var,
        "device_choices": hs_choices,
        "hw_to_win": hw_to_win,
        "win_to_hw": win_to_hw,
    }


# ─────────────────────────── tab: drift logger ──────────────────────────────

def _build_drift_tab(nb, cfg):
    d = cfg["mic_drift_logger"]
    tab = ttk.Frame(nb, padding=12)
    nb.add(tab, text="Mic Drift Logger")

    enabled_var = tk.BooleanVar(value=d.get("enabled", False))
    ttk.Checkbutton(tab, text="Enable diagnostic logging of mic volume/registry drift",
                    variable=enabled_var).pack(anchor="w", pady=(0, 6))

    interval_row = ttk.Frame(tab)
    interval_row.pack(fill=tk.X, pady=(4, 8))
    ttk.Label(interval_row, text="Poll interval (seconds):").pack(side=tk.LEFT)
    interval_var = tk.StringVar(value=str(d.get("poll_interval_seconds", 5.0)))
    ttk.Entry(interval_row, textvariable=interval_var, width=8).pack(side=tk.LEFT, padx=6)

    ttk.Label(
        tab,
        text=("Watches the Windows default microphone for any unexpected\n"
              "level / dB / mute / registry change. Logs every transition to\n"
              "watcher.log with `[mic_drift]` prefix. Use when investigating\n"
              "the 'mic gets twice as loud after a while' bug — the diff\n"
              "between two snapshots tells us exactly which value drifts.\n\n"
              "Overhead: one HID enumeration + one registry walk per interval.\n"
              "5 seconds is fine for background use."),
        foreground="#666", justify="left",
    ).pack(anchor="w", pady=(8, 0))

    ttk.Button(tab, text="Open log folder",
               command=lambda: os.startfile(str(LOG_PATH.parent))).pack(anchor="w", pady=(12, 0))

    return {
        "enabled": enabled_var,
        "interval": interval_var,
    }


# ─────────────────────────── main dialog ────────────────────────────────────

def run():
    cfg = load_config()

    root = tk.Tk()
    root.title("CorsairCompanion — Settings")
    root.geometry("560x680")
    root.minsize(480, 560)

    nb = ttk.Notebook(root)
    nb.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

    gm_vars = _build_game_mode_tab(nb, cfg)
    mic_vars = _build_mic_mute_tab(nb, cfg)
    drift_vars = _build_drift_tab(nb, cfg)

    ttk.Label(root,
              text=f"Config: {CONFIG_PATH}\nLog:    {LOG_PATH}",
              foreground="#666", justify="left").pack(anchor="w", padx=12, pady=(0, 4))

    bottom = ttk.Frame(root)
    bottom.pack(fill=tk.X, padx=10, pady=10)

    def save_and_close():
        try:
            gm_interval = float(gm_vars["interval"].get())
            drift_interval = float(drift_vars["interval"].get())
            if gm_interval < 0.5 or drift_interval < 1.0:
                messagebox.showerror("Invalid",
                                     "Game Mode poll interval ≥ 0.5s and drift ≥ 1.0s required")
                return
        except ValueError:
            messagebox.showerror("Invalid", "Poll intervals must be numbers")
            return

        cfg["game_mode"]["enabled"] = bool(gm_vars["enabled"].get())
        cfg["game_mode"]["device"] = _choice_key_for_label(
            gm_vars["device_choices"], gm_vars["device_label"].get()
        )
        cfg["game_mode"]["executables"] = [
            gm_vars["listbox"].get(i) for i in range(gm_vars["listbox"].size())
        ]
        cfg["game_mode"]["poll_interval_seconds"] = gm_interval

        cfg["mic_mute_mirror"]["enabled"] = bool(mic_vars["enabled"].get())
        cfg["mic_mute_mirror"]["device"] = _choice_key_for_label(
            mic_vars["device_choices"], mic_vars["device_label"].get()
        )
        cfg["mic_mute_mirror"]["hardware_to_windows"] = bool(mic_vars["hw_to_win"].get())
        cfg["mic_mute_mirror"]["windows_to_hardware"] = bool(mic_vars["win_to_hw"].get())

        cfg["mic_drift_logger"]["enabled"] = bool(drift_vars["enabled"].get())
        cfg["mic_drift_logger"]["poll_interval_seconds"] = drift_interval

        save_config(cfg)
        messagebox.showinfo(
            "Saved",
            "Config saved. Device-selection and direction changes apply on the next CorsairCompanion start.\n\n"
            "Feature enable/disable + interval changes apply within ~5 seconds.",
        )
        root.destroy()

    ttk.Button(bottom, text="Save", command=save_and_close).pack(side=tk.RIGHT, padx=2)
    ttk.Button(bottom, text="Cancel", command=root.destroy).pack(side=tk.RIGHT, padx=2)

    root.mainloop()


if __name__ == "__main__":
    run()
