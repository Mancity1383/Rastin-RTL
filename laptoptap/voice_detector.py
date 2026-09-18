import os
import sys
import subprocess
import threading
from pathlib import Path

class VoiceDetector:
    """
    Manages the offline Windows native speech recognition engine (VoiceRecognizer.exe).
    Listens for spoken commands: 'copy', 'paste', 'screenshot', 'lock', 'play', 'pause', 'mute'.
    Triggers actions in real time with sub-100ms latency and near-zero CPU usage.
    """
    
    def __init__(self, config_manager, on_voice_command=None):
        self.config_manager = config_manager
        self.on_voice_command = on_voice_command
        self.proc = None
        self.is_running = False
        self.thread = None
        
        # Locate VoiceRecognizer.exe in the same directory
        self.exe_path = Path(__file__).parent / "VoiceRecognizer.exe"

    @property
    def is_enabled(self):
        return self.config_manager.get("enable_voice_commands", True)

    def _disable_windows_ducking(self):
        # Prevent Windows from lowering media volume when microphone is active
        if os.name == 'nt':
            try:
                import winreg
                key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Multimedia\Audio", 0, winreg.KEY_SET_VALUE)
                winreg.SetValueEx(key, "UserDuckingPreference", 0, winreg.REG_DWORD, 3)
                winreg.CloseKey(key)
            except Exception:
                pass

    def start(self):
        if self.is_running:
            return
            
        self._disable_windows_ducking()
            
        if not self.exe_path.exists():
            print(f"[VoiceDetector] Error: {self.exe_path} not found.")
            return

        try:
            print(f"[VoiceDetector] Launching VoiceRecognizer: {self.exe_path}")
            # Hide console window on Windows
            startupinfo = None
            if os.name == 'nt':
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                startupinfo.wShowWindow = subprocess.SW_HIDE

            conf = self.config_manager.get("voice_confidence_threshold", 0.64)
            self.proc = subprocess.Popen(
                [str(self.exe_path), str(conf)],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding='utf-8',
                bufsize=1,
                startupinfo=startupinfo
            )
            self.is_running = True
            
            self.thread = threading.Thread(target=self._reader_loop, daemon=True)
            self.thread.start()
            print("[VoiceDetector] Voice recognition engine active.")
        except Exception as e:
            print(f"[VoiceDetector] Failed to start voice recognizer: {e}")
            self.is_running = False

    def _reader_loop(self):
        while self.is_running and self.proc and self.proc.poll() is None:
            try:
                line = self.proc.stdout.readline()
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue
                    
                if line.startswith("VOICE_CMD:"):
                    parts = line.split(":")
                    if len(parts) >= 2:
                        cmd = parts[1].strip().lower()
                        conf = float(parts[2]) if len(parts) >= 3 else 1.0
                        spoken_text = parts[3].strip() if len(parts) >= 4 else cmd
                        print(f"[VoiceDetector] Spoken Word Recognized: '{spoken_text}' (Cmd: {cmd}, Confidence: {conf:.2f})")
                        
                        if self.is_enabled and self.on_voice_command:
                            try:
                                self.on_voice_command(cmd, conf, spoken_text)
                            except TypeError:
                                self.on_voice_command(cmd, conf)
                elif line.startswith("DEBUG_LOW_CONF:"):
                    parts = line.split(":")
                    if len(parts) >= 3:
                        print(f"[VoiceDetector] Filtered ambient noise / low-conf speech: '{parts[1]}' ({float(parts[2]):.2f})")
                elif line.startswith("STATUS:"):
                    print(f"[VoiceDetector] Status: {line}")
                elif line.startswith("ERROR:"):
                    print(f"[VoiceDetector] Engine Error: {line}")
            except Exception as e:
                if self.is_running:
                    print(f"[VoiceDetector] Reader exception: {e}")
                break

    def stop(self):
        if not self.is_running:
            return
        self.is_running = False
        try:
            if self.proc and self.proc.poll() is None:
                if self.proc.stdin:
                    self.proc.stdin.write("quit\n")
                    self.proc.stdin.flush()
                self.proc.terminate()
                self.proc.wait(timeout=1.0)
        except Exception:
            try:
                self.proc.kill()
            except Exception:
                pass
        self.proc = None
        print("[VoiceDetector] Voice recognition engine stopped.")
