import json
import os
from pathlib import Path

DEFAULT_CONFIG = {
    "sensitivity": 0.70,        # 0.1 to 1.0 (higher = more sensitive)
    "grouping_window_ms": 350,  # Max interval between taps in a multi-tap combo
    "refractory_period_ms": 80, # Cooldown between individual taps to prevent ring/echo
    "suppress_typing": True,    # Ignore taps while user is typing on keyboard
    "typing_cooldown_ms": 400,  # Milliseconds after last keystroke before accepting taps
    "detect_sides": True,       # Distinguish left vs right chassis tap
    "max_hf_ratio": 0.36,       # High-frequency rejection threshold (airborne sound rejection)
    "max_rise_time_ms": 4.5,    # Maximum transient attack rise time (mechanical shock gate)
    "enable_voice_commands": True, # Voice commands (Copy, Paste, Screenshot, etc.)
    "actions": {
        "single_tap": "play_pause",       # play_pause, copy, paste, screenshot, lock, mute
        "double_tap": "copy",
        "triple_tap": "paste",
        "left_double_tap": "screenshot",
        "right_double_tap": "play_pause"
    },
    "voice_actions": {
        "copy": "copy",
        "paste": "paste",
        "screenshot": "screenshot",
        "lock": "lock",
        "play": "play_pause",
        "pause": "play_pause",
        "next": "next_track",
        "previous": "prev_track",
        "mute": "mute"
    },
    "selected_input_device": None, # None = default microphone array
}

class ConfigManager:
    def __init__(self, config_dir=None):
        if config_dir is None:
            config_dir = Path.home() / ".laptoptap"
        else:
            config_dir = Path(config_dir)
            
        self.config_dir = config_dir
        self.config_dir.mkdir(parents=True, exist_ok=True)
        self.config_file = self.config_dir / "config.json"
        self.config = self.load()

    def load(self):
        if self.config_file.exists():
            try:
                with open(self.config_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    # Merge with defaults to ensure all keys exist
                    merged = DEFAULT_CONFIG.copy()
                    merged.update(data)
                    return merged
            except Exception as e:
                print(f"[Config] Error loading config: {e}. Using defaults.")
        return DEFAULT_CONFIG.copy()

    def save(self):
        try:
            with open(self.config_file, "w", encoding="utf-8") as f:
                json.dump(self.config, f, indent=4, ensure_ascii=False)
        except Exception as e:
            print(f"[Config] Error saving config: {e}")

    def get(self, key, default=None):
        return self.config.get(key, default)

    def set(self, key, value):
        self.config[key] = value
        self.save()
