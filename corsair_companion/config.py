"""Shared JSON config helpers for CorsairCompanion."""
import json
import logging
import os
from pathlib import Path

APP_NAME = "CorsairCompanion"
CONFIG_DIR = Path(os.getenv("APPDATA", str(Path.home()))) / APP_NAME
CONFIG_PATH = CONFIG_DIR / "config.json"
LOG_PATH = CONFIG_DIR / "watcher.log"

DEFAULTS = {
    # Game Mode feature (Vanguard Pro 96 — flips Game Mode property when any
    # whitelisted process is running).
    "game_mode": {
        "enabled": True,
        "poll_interval_seconds": 2.0,
        "executables": [],
    },
    # Mic Mute Mirror feature (Virtuoso XT — toggles Windows default mic when
    # the headset's hardware mute button is pressed).
    "mic_mute_mirror": {
        "enabled": True,
    },
}


def load_config():
    if not CONFIG_PATH.exists():
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        save_config(DEFAULTS)
        return _deep_copy(DEFAULTS)
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        return _merge_defaults(cfg, DEFAULTS)
    except Exception:
        logging.exception("load_config failed; using defaults")
        return _deep_copy(DEFAULTS)


def save_config(cfg):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)


def _deep_copy(d):
    return json.loads(json.dumps(d))


def _merge_defaults(cfg, defaults):
    """Recursive merge so new feature sections appear after upgrades without
    wiping user values."""
    if not isinstance(cfg, dict):
        return _deep_copy(defaults)
    out = {}
    for k, default_v in defaults.items():
        cur = cfg.get(k, default_v)
        if isinstance(default_v, dict):
            out[k] = _merge_defaults(cur if isinstance(cur, dict) else {}, default_v)
        else:
            out[k] = cur
    # Preserve any extra keys the user added (forward-compat)
    for k, v in cfg.items():
        if k not in out:
            out[k] = v
    return out
