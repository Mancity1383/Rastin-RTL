import time
import numpy as np
from config_manager import ConfigManager
from audio_engine import AudioEngine
from tap_detector import TapDetector, DetectedTapGesture
from action_executor import ActionExecutor

def run_smoke_test():
    print("=== Running LaptopTap Core Smoke Test ===")
    
    # 1. Test Config
    config = ConfigManager()
    print("[1/4] Config loaded successfully. Sensitivity:", config.get("sensitivity"))
    
    # 2. Test Action Executor
    executor = ActionExecutor()
    print("[2/4] Action Executor initialized.")
    executor.trigger("none")
    
    # 3. Test Tap Detector with synthetic impulse
    detected_gestures = []
    detector = TapDetector(
        config_manager=config,
        on_gesture_detected=lambda g: detected_gestures.append(g)
    )
    print("[3/4] Tap Detector initialized.")
    
    # Inject quiet background
    silence = np.zeros(256, dtype=np.float32)
    raw_stereo = np.zeros((256, 2), dtype=np.float32)
    for _ in range(4):
        detector.process_chunk(silence, silence, silence, silence, raw_stereo)
    
    # Test VOICE REJECTION: inject 1024 samples (4 blocks) of 160Hz periodic human vowel
    sr = 44100
    t = np.linspace(0, 1024/sr, 1024, endpoint=False)
    voice_1024 = (np.sin(2 * np.pi * 160 * t) + 0.4 * np.sin(2 * np.pi * 320 * t)).astype(np.float32) * 0.4
    for i in range(4):
        block = voice_1024[i*256:(i+1)*256]
        raw_b = np.column_stack([block, block])
        detector.process_chunk(block, block, block, block, raw_b)
    
    time.sleep(0.6)
    assert len(detected_gestures) == 0, "Voice was NOT rejected by tap detector!"
    print("      Voice rejection test PASSED! (Speech successfully ignored)")

    # Reset state with silence between voice and knock
    for _ in range(4):
        detector.process_chunk(silence, silence, silence, silence, raw_stereo)
    time.sleep(0.2)
    impulse = np.zeros(256, dtype=np.float32)
    impulse[10:30] = 0.35 # Sharp mechanical shock
    zero_high = np.zeros(256, dtype=np.float32)
    raw_stereo_impulse = np.zeros((256, 2), dtype=np.float32)
    raw_stereo_impulse[10:30, 0] = 0.35 # Left channel dominant
    raw_stereo_impulse[10:30, 1] = 0.08
    
    detector.process_chunk(impulse, impulse * 0.2, zero_high, zero_high, raw_stereo_impulse)
    
    # Feed silent follow-up blocks
    for _ in range(3):
        detector.process_chunk(silence, silence, silence, silence, raw_stereo)
    
    # Wait for grouping window to complete
    time.sleep(0.7)
    
    assert len(detected_gestures) == 1, f"Expected 1 gesture, got {len(detected_gestures)}"
    g = detected_gestures[0]
    print(f"      Synthetic Gesture detected: count={g.count}, side={g.side}, peak={g.peak:.3f}")
    assert g.count == 1
    assert g.side == "left"
    print("      Synthetic mechanical knock verification PASSED!")
    
    # 4. Test Audio Engine device discovery
    devices = AudioEngine.get_input_devices()
    print(f"[4/4] Audio Engine discovered {len(devices)} input devices.")
    mic_idx = AudioEngine.find_internal_mic_index()
    print(f"      Recommended internal mic index: {mic_idx}")
    
    print("\n>>> ALL CORE SMOKE TESTS PASSED SUCCESSFULLY! <<<")

if __name__ == "__main__":
    run_smoke_test()
