"""Settings dialog for CorsairCompanion. Spawned as a subprocess from the
tray to keep tkinter on its own main thread."""
import tkinter as tk
from tkinter import messagebox, simpledialog, ttk

import psutil

from config import CONFIG_PATH, LOG_PATH, load_config, save_config


def run():
    cfg = load_config()
    gm = cfg["game_mode"]
    mic = cfg["mic_mute_mirror"]

    root = tk.Tk()
    root.title("CorsairCompanion — Settings")
    root.geometry("520x620")
    root.minsize(420, 520)

    nb = ttk.Notebook(root)
    nb.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

    # ---------- Game Mode tab ----------
    tab_gm = ttk.Frame(nb)
    nb.add(tab_gm, text="Game Mode")

    gm_enabled = tk.BooleanVar(value=gm.get("enabled", True))
    ttk.Checkbutton(
        tab_gm, text="Enable Game Mode auto-toggle (Vanguard Pro 96)", variable=gm_enabled,
    ).pack(anchor="w", pady=(8, 4), padx=8)

    ttk.Label(
        tab_gm,
        text="Executable names that trigger Game Mode\n(case-insensitive, exact process name match):",
        justify="left",
    ).pack(pady=(8, 4), padx=8, anchor="w")

    list_frame = ttk.Frame(tab_gm)
    list_frame.pack(fill=tk.BOTH, expand=True, padx=8, pady=4)
    sb = ttk.Scrollbar(list_frame)
    sb.pack(side=tk.RIGHT, fill=tk.Y)
    lb = tk.Listbox(list_frame, yscrollcommand=sb.set, selectmode=tk.EXTENDED)
    for exe in gm.get("executables", []):
        lb.insert(tk.END, exe)
    lb.pack(fill=tk.BOTH, expand=True)
    sb.config(command=lb.yview)

    btn_row = ttk.Frame(tab_gm)
    btn_row.pack(fill=tk.X, padx=8, pady=4)

    def add_manual():
        name = simpledialog.askstring(
            "Add Executable", "Executable name (e.g. Cyberpunk2077.exe):", parent=root
        )
        if name and name.strip():
            lb.insert(tk.END, name.strip())

    def add_running():
        running = sorted(
            {p.info["name"] for p in psutil.process_iter(["name"]) if p.info.get("name")},
            key=str.lower,
        )
        dlg = tk.Toplevel(root)
        dlg.title("Pick running processes")
        dlg.geometry("400x460")
        dlg.transient(root)
        ttk.Label(dlg, text="Select one or more (Ctrl/Shift):").pack(pady=(10, 4))
        f = ttk.Frame(dlg)
        f.pack(fill=tk.BOTH, expand=True, padx=10)
        sb2 = ttk.Scrollbar(f)
        sb2.pack(side=tk.RIGHT, fill=tk.Y)
        lb2 = tk.Listbox(f, yscrollcommand=sb2.set, selectmode=tk.EXTENDED)
        for name in running:
            lb2.insert(tk.END, name)
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

    interval_row = ttk.Frame(tab_gm)
    interval_row.pack(fill=tk.X, padx=8, pady=(8, 4))
    ttk.Label(interval_row, text="Poll interval (seconds):").pack(side=tk.LEFT)
    interval_var = tk.StringVar(value=str(gm.get("poll_interval_seconds", 2.0)))
    ttk.Entry(interval_row, textvariable=interval_var, width=8).pack(side=tk.LEFT, padx=6)

    # ---------- Mic Mute Mirror tab ----------
    tab_mic = ttk.Frame(nb)
    nb.add(tab_mic, text="Mic Mute Mirror")

    mic_enabled = tk.BooleanVar(value=mic.get("enabled", True))
    ttk.Checkbutton(
        tab_mic,
        text="Mirror Virtuoso XT hardware mute button to Windows default microphone",
        variable=mic_enabled,
    ).pack(anchor="w", pady=(16, 8), padx=12)
    ttk.Label(
        tab_mic,
        text=(
            "When you press the mute button on the headset, Windows will mute the\n"
            "default recording device too. Works regardless of which app is in focus\n"
            "(Teams, Discord, Zoom, browser tabs, games — all affected).\n\n"
            "Requires the Virtuoso XT Wireless to be connected. If you turn the\n"
            "headset off, the watcher waits and reconnects when it comes back."
        ),
        foreground="#444",
        justify="left",
    ).pack(anchor="w", padx=12)

    # ---------- footer ----------
    ttk.Label(
        root,
        text=f"Config: {CONFIG_PATH}\nLog:    {LOG_PATH}",
        foreground="#666",
        justify="left",
    ).pack(pady=(4, 0), padx=10, anchor="w")

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
        cfg["game_mode"]["enabled"] = bool(gm_enabled.get())
        cfg["game_mode"]["executables"] = [lb.get(i) for i in range(lb.size())]
        cfg["game_mode"]["poll_interval_seconds"] = interval
        cfg["mic_mute_mirror"]["enabled"] = bool(mic_enabled.get())
        save_config(cfg)
        root.destroy()

    ttk.Button(bottom, text="Save", command=save_and_close).pack(side=tk.RIGHT, padx=2)
    ttk.Button(bottom, text="Cancel", command=root.destroy).pack(side=tk.RIGHT, padx=2)

    root.mainloop()


if __name__ == "__main__":
    run()
