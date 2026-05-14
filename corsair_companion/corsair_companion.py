"""CorsairCompanion — tray app that fills SignalRGB / iCUE gaps.

Features:
  - Game Mode auto-toggle (Vanguard Pro 96) based on running processes
  - Mic Mute Mirror (Virtuoso XT Wireless) syncing hardware mute button to
    the Windows default microphone

Run modes:
  corsair_companion.exe              tray + background watchers
  corsair_companion.exe --settings   settings dialog only (spawned by tray)
"""
import logging
import subprocess
import sys

import pystray
from PIL import Image, ImageDraw

from config import APP_NAME, CONFIG_DIR, LOG_PATH, load_config
from feature_game_mode import KeyboardController, ProcessWatcher
from feature_mic_mute import HeadsetMicWatcher, HeadsetMuteWriter, MicController, WindowsMicMuteWatcher


def make_icon(game_mode_active: bool, mic_muted: bool) -> Image.Image:
    """Compose a 64x64 RGBA icon. Two stacked LEDs:
       top  = Game Mode (red when on),
       bottom = Mic Mute (red when muted)."""
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse([4, 4, 60, 60], fill=(40, 40, 40), outline=(20, 20, 20), width=2)

    gm_color = (220, 50, 50) if game_mode_active else (90, 90, 90)
    mic_color = (220, 50, 50) if mic_muted else (90, 90, 90)
    draw.ellipse([16, 12, 48, 30], fill=gm_color)  # top "GM" LED
    draw.ellipse([16, 34, 48, 52], fill=mic_color)  # bottom "MIC" LED
    # Small labels
    draw.text((24, 14), "G", fill=(255, 255, 255))
    draw.text((22, 36), "M", fill=(255, 255, 255))
    return img


class TrayApp:
    def __init__(self):
        self.gm_active = False
        self.mic_muted = False

        self.keyboard = KeyboardController()
        self.mic = MicController()
        self.headset_writer = HeadsetMuteWriter()

        self.gm_watcher = ProcessWatcher(
            self.keyboard, get_config=load_config, on_state_change=self._on_gm_change
        )
        self.mic_watcher = HeadsetMicWatcher(
            self.mic, get_config=load_config, on_state_change=self._on_mic_change
        )
        self.win_mic_watcher = WindowsMicMuteWatcher(
            self.mic, self.headset_writer, get_config=load_config
        )

        self.icon = None

    def _refresh_icon(self):
        if self.icon:
            self.icon.icon = make_icon(self.gm_active, self.mic_muted)
            self.icon.title = (
                f"CorsairCompanion — "
                f"GM {'ON' if self.gm_active else 'off'} / "
                f"Mic {'MUTED' if self.mic_muted else 'live'}"
            )

    def _on_gm_change(self, active: bool):
        self.gm_active = active
        self._refresh_icon()

    def _on_mic_change(self, muted: bool):
        self.mic_muted = muted
        self._refresh_icon()

    def _spawn_settings(self):
        if getattr(sys, "frozen", False):
            subprocess.Popen([sys.executable, "--settings"])
        else:
            subprocess.Popen([sys.executable, "-m", "settings_ui"], cwd=str(_script_dir()))

    def _quit(self):
        logging.info("Quit requested")
        self.gm_watcher.stop()
        self.mic_watcher.stop()
        self.win_mic_watcher.stop()
        self.keyboard.close()
        self.headset_writer.close()
        if self.icon:
            self.icon.stop()

    def run(self):
        self.gm_watcher.start()
        self.mic_watcher.start()
        self.win_mic_watcher.start()
        menu = pystray.Menu(
            pystray.MenuItem("Settings…", self._spawn_settings),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", self._quit),
        )
        self.icon = pystray.Icon(
            APP_NAME, make_icon(False, False), "CorsairCompanion — starting", menu
        )
        self.icon.run()


def _script_dir():
    from pathlib import Path
    return Path(__file__).parent


def main():
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[logging.FileHandler(str(LOG_PATH), encoding="utf-8")],
    )

    if len(sys.argv) > 1 and sys.argv[1] == "--settings":
        # Delegate to the settings_ui module (its run() owns the tkinter mainloop).
        import settings_ui
        settings_ui.run()
        return

    logging.info(f"=== {APP_NAME} starting ===")
    try:
        TrayApp().run()
    except Exception:
        logging.exception("Tray app crashed")
        raise


if __name__ == "__main__":
    main()
