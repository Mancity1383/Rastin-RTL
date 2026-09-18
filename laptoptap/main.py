import sys
import argparse
import time
from PyQt6.QtWidgets import QApplication

from config_manager import ConfigManager
from action_executor import ActionExecutor
from tap_detector import TapDetector
from audio_engine import AudioEngine
from voice_detector import VoiceDetector
from gui import MainWindow

def run_cli_mode(config, executor, detector, audio, voice):
    print("=====================================================")
    print("  LaptopTap CLI Mode (Headless Background Daemon)   ")
    print("=====================================================")
    print("  * Knock 1 time:  ", config.get("actions", {}).get("single_tap"))
    print("  * Knock 2 times: ", config.get("actions", {}).get("double_tap"))
    print("  * Knock 3 times: ", config.get("actions", {}).get("triple_tap"))
    print("  * Voice Commands: Say 'Copy', 'Paste', 'Screenshot', 'Lock'")
    print("  Press Ctrl+C to terminate.")
    print("-----------------------------------------------------")
    
    def on_gesture(gesture):
        actions = config.get("actions", {})
        action_name = None
        if gesture.count == 2 and gesture.side in ("left", "right"):
            action_name = actions.get(f"{gesture.side}_double_tap")
        if not action_name:
            if gesture.count == 1:
                action_name = actions.get("single_tap", "play_pause")
            elif gesture.count == 2:
                action_name = actions.get("double_tap", "copy")
            elif gesture.count >= 3:
                action_name = actions.get("triple_tap", "paste")
        print(f"\n[CLI] Gesture Recognized: {gesture} -> Triggering {action_name}")
        executor.trigger(action_name)

    def on_voice(cmd, conf, text=""):
        # Mute tap detector when speech is detected
        detector.notify_speech_active(0.60)
        voice_actions = config.get("voice_actions", {})
        action_name = voice_actions.get(cmd.lower(), cmd.lower())
        disp = text if text else cmd
        print(f"\n[CLI] 🎙️ Spoken Word: '{disp.upper()}' ({int(conf*100)}%) -> Triggering {action_name}")
        executor.trigger(action_name)

    detector.on_gesture_detected = on_gesture
    voice.on_voice_command = on_voice
    
    audio.start()
    if config.get("enable_voice_commands", True):
        voice.start()
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[CLI] Stopping engines...")
        audio.stop()
        voice.stop()
        print("[CLI] Exited cleanly.")

def main():
    parser = argparse.ArgumentParser(description="LaptopTap — Chassis Knock & Voice Shortcuts for Windows/Intel")
    parser.add_argument("--cli", action="store_true", help="Run in headless console mode without GUI")
    args = parser.parse_args()

    # Core components
    config = ConfigManager()
    executor = ActionExecutor()
    detector = TapDetector(config_manager=config)
    audio = AudioEngine(
        on_audio_chunk=lambda ll, lr, hl, hr, raw: detector.process_chunk(ll, lr, hl, hr, raw)
    )
    voice = VoiceDetector(config_manager=config)

    if args.cli:
        run_cli_mode(config, executor, detector, audio, voice)
    else:
        # Start GUI
        app = QApplication(sys.argv)
        app.setQuitOnLastWindowClosed(False) # Keep running in system tray
        
        # Start audio and voice monitoring
        audio.start()
        if config.get("enable_voice_commands", True):
            voice.start()
        
        window = MainWindow(config, audio, detector, executor, voice_detector=voice)
        window.show()
        
        sys.exit(app.exec())

if __name__ == "__main__":
    main()
