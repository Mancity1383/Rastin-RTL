import json
import os
import sys
from pathlib import Path

DEFAULT_CONFIG = {
    "sensitivity": 0.90,        # 0.1 to 1.0 (higher = more sensitive)
    "grouping_window_ms": 408,  # Max interval between taps in a multi-tap combo
    "refractory_period_ms": 110,# Cooldown between individual taps to prevent ring/echo
    "suppress_typing": True,    # Ignore taps while user is typing on keyboard
    "typing_cooldown_ms": 400,  # Milliseconds after last keystroke before accepting taps
    "detect_sides": True,       # Distinguish left vs right chassis tap
    "max_hf_ratio": 0.36,       # High-frequency rejection threshold (airborne sound rejection)
    "max_rise_time_ms": 4.5,    # Maximum transient attack rise time (mechanical shock gate)
    "active_mode": "knock",     # "knock" or "voice" (exclusive mode)
    "enable_voice_commands": True, # Voice commands (Copy, Paste, Screenshot, etc.)
    "voice_confidence_threshold": 0.60, # SAPI speech recognition confidence threshold (0.35 to 0.85)
    "enable_sound_feedback": True, # Subtle audio click/beep confirmation on triggers
    "enable_notifications": True,  # Desktop notifications on triggered actions
    "start_with_windows": False,   # Automatically launch on Windows login
    "actions": {
        "single_tap": "copy",
        "double_tap": "paste",
        "triple_tap": "none",
        "left_double_tap": "screenshot",
        "right_double_tap": "play_pause"
    },
    "voice_actions": {
        "copy": "copy",
        "paste": "paste",
        "undo": "undo",
        "redo": "redo",
        "select_all": "select_all",
        "screenshot": "screenshot",
        "lock": "lock",
        "show_desktop": "show_desktop",
        "close_window": "close_window",
        "open_calculator": "open_calculator",
        "open_notepad": "open_notepad",
        "open_browser": "open_browser",
        "open_terminal": "open_terminal",
        "play": "play_pause",
        "pause": "play_pause",
        "next": "next_track",
        "previous": "prev_track",
        "mute": "mute",
        "volume_up": "volume_up",
        "volume_down": "volume_down"
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
                    # Also merge voice_actions and actions dictionaries
                    if "actions" in data:
                        merged_actions = DEFAULT_CONFIG["actions"].copy()
                        merged_actions.update(data["actions"])
                        merged["actions"] = merged_actions
                    if "voice_actions" in data:
                        merged_va = DEFAULT_CONFIG["voice_actions"].copy()
                        merged_va.update(data["voice_actions"])
                        merged["voice_actions"] = merged_va
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
        if key == "start_with_windows":
            self.set_autostart_registry(value)

    def set_autostart_registry(self, enable: bool):
        if os.name != 'nt':
            return
        try:
            import winreg
            run_key = r"Software\Microsoft\Windows\CurrentVersion\Run"
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, run_key, 0, winreg.KEY_SET_VALUE)
            app_name = "LaptopTap"
            if enable:
                main_py = Path(__file__).parent / "main.py"
                # Use pythonw to prevent console popping up on boot
                pythonw = Path(sys.executable).parent / "pythonw.exe"
                if not pythonw.exists():
                    pythonw = Path(sys.executable)
                cmd = f'"{pythonw}" "{main_py}" --minimized'
                winreg.SetValueEx(key, app_name, 0, winreg.REG_SZ, cmd)
                print(f"[Config] Windows Autostart registered: {cmd}")
            else:
                try:
                    winreg.DeleteValue(key, app_name)
                    print("[Config] Windows Autostart removed.")
                except FileNotFoundError:
                    pass
            winreg.CloseKey(key)
        except Exception as e:
            print(f"[Config] Error updating autostart registry: {e}")
