import time
import threading
import numpy as np
from pynput import keyboard

class DetectedTapGesture:
    def __init__(self, count, side="center", peak=0.0):
        self.count = count       # 1 = Single, 2 = Double, 3 = Triple
        self.side = side         # "left", "right", "center"
        self.peak = peak
        self.timestamp = time.time()
        
    def name(self):
        side_prefix = f"{self.side}_" if self.side in ("left", "right") else ""
        if self.count == 1:
            return f"{side_prefix}single_tap"
        elif self.count == 2:
            return f"{side_prefix}double_tap"
        elif self.count == 3:
            return f"{side_prefix}triple_tap"
        return f"{side_prefix}{self.count}_tap"

    def __repr__(self):
        return f"<TapGesture {self.name()} count={self.count} side={self.side} peak={self.peak:.3f}>"


class TapDetector:
    """
    Precision Physical Knock Detector for Laptop Chassis & Desks:
    - Highly responsive dynamic threshold adapted to laptop chassis sensitivity.
    - True Voice Rejection via 1024-sample Harmonic Autocorrelation (rejects human vocal cords).
    - Duration Gate: Only accepts fast mechanical shocks (<20ms); rejects sustained talking.
    - Refractory debouncing to eliminate acoustic ringing of laptop body.
    - Automatic typing suppression to ignore keyboard presses.
    """

    def __init__(self, config_manager, on_gesture_detected=None, on_level_update=None):
        self.config_manager = config_manager
        self.on_gesture_detected = on_gesture_detected
        self.on_level_update = on_level_update
        
        # Audio rolling buffer for pitch analysis (1024 samples ~ 23ms)
        self.history_len = 1024
        self.history_buffer = np.zeros(self.history_len, dtype=np.float32)
        
        # Noise floor tracking
        self.noise_floor = 0.001
        self.noise_alpha_slow = 0.005
        self.noise_alpha_fast = 0.03
        
        # State machine
        self.last_tap_time = 0.0
        self.current_taps = 0
        self.current_side = "center"
        self.max_peak_in_group = 0.0
        self.group_timer = None
        self.lock = threading.Lock()
        
        # Duration & Voice tracking
        self.consecutive_loud_blocks = 0
        self.is_in_sustained_sound = False
        self.voice_speech_active_until = 0.0
        
        # Keyboard typing suppression
        self.last_key_time = 0.0
        self.keyboard_listener = None
        self._start_keyboard_listener()

    def _start_keyboard_listener(self):
        try:
            def on_press(key):
                self.last_key_time = time.time()
                
            self.keyboard_listener = keyboard.Listener(on_press=on_press)
            self.keyboard_listener.daemon = True
            self.keyboard_listener.start()
        except Exception as e:
            print(f"[TapDetector] Could not start keyboard listener: {e}")

    def notify_speech_active(self, duration_s=0.50):
        """Mute tap detector whenever VoiceRecognizer is actively processing speech."""
        self.voice_speech_active_until = max(self.voice_speech_active_until, time.time() + duration_s)

    @property
    def sensitivity(self):
        return self.config_manager.get("sensitivity", 0.85)

    @property
    def grouping_window_s(self):
        return self.config_manager.get("grouping_window_ms", 400) / 1000.0

    @property
    def refractory_period_s(self):
        return self.config_manager.get("refractory_period_ms", 95) / 1000.0

    @property
    def suppress_typing(self):
        return self.config_manager.get("suppress_typing", True)

    @property
    def typing_cooldown_s(self):
        return self.config_manager.get("typing_cooldown_ms", 400) / 1000.0

    @property
    def detect_sides(self):
        return self.config_manager.get("detect_sides", True)

    def calculate_threshold(self):
        """
        Calibrated threshold range [0.010, 0.120] matching typical laptop chassis taps (0.020 - 0.080).
        At sensitivity 0.90 -> threshold is ~0.021 (catches gentle knocks, well above noise ~0.001).
        """
        sens = max(0.10, min(1.0, self.sensitivity))
        min_thresh = 0.010
        max_thresh = 0.120
        base = max_thresh - sens * (max_thresh - min_thresh)
        return max(base, self.noise_floor * 3.0, 0.008)

    def _compute_harmonicity(self, signal, sample_rate=44100):
        """
        Calculates normalized autocorrelation in pitch lag range (80 Hz - 400 Hz) across 1024 samples.
        Human vowels/speech have harmonicity > 0.45.
        Mechanical taps and clicks have harmonicity < 0.25.
        """
        min_lag = max(1, int(sample_rate / 400)) # ~110 samples
        max_lag = min(len(signal) - 1, int(sample_rate / 80)) # ~551 samples
        if min_lag >= max_lag or len(signal) < max_lag + 10:
            return 0.0
            
        sig_norm = signal - np.mean(signal)
        var = np.sum(sig_norm ** 2)
        if var < 1e-7:
            return 0.0
            
        corr = np.correlate(sig_norm, sig_norm, mode='full')
        corr = corr[len(sig_norm) - 1:]
        lags_corr = corr[min_lag:max_lag]
        if len(lags_corr) == 0:
            return 0.0
        return float(np.max(lags_corr) / var)

    def process_chunk(self, low_l, low_r, high_l, high_r, raw_chunk):
        now = time.time()
        
        # Update rolling buffer for pitch analysis
        step = len(low_l)
        if step < self.history_len:
            self.history_buffer[:-step] = self.history_buffer[step:]
            self.history_buffer[-step:] = low_l
        else:
            self.history_buffer[:] = low_l[-self.history_len:]
            
        peak_l = float(np.max(np.abs(low_l)))
        peak_r = float(np.max(np.abs(low_r)))
        current_peak = max(peak_l, peak_r)
        
        threshold = self.calculate_threshold()
        
        # Update UI oscilloscope
        if self.on_level_update:
            self.on_level_update(current_peak, threshold)

        # 1. Update Noise Floor when quiet
        if current_peak < threshold * 0.70:
            self.noise_floor = (1.0 - self.noise_alpha_slow) * self.noise_floor + self.noise_alpha_slow * current_peak
            self.consecutive_loud_blocks = 0
            self.is_in_sustained_sound = False
            return
        else:
            self.noise_floor = (1.0 - self.noise_alpha_fast) * self.noise_floor + self.noise_alpha_fast * current_peak
            self.consecutive_loud_blocks += 1

        # 2. Check typing suppression
        if self.suppress_typing and (now - self.last_key_time < self.typing_cooldown_s):
            return

        # 3. Check voice speech lockout
        if now < self.voice_speech_active_until:
            return

        # 4. Check sustained sound duration (human speech / music stays loud for > 4 blocks)
        if self.consecutive_loud_blocks > 4:
            self.is_in_sustained_sound = True
            return
            
        if self.is_in_sustained_sound:
            return

        # 5. CREST FACTOR FILTER (Peak-to-RMS ratio)
        # In acoustic physics: a physical tap is an instantaneous shock spike (Crest Factor > 2.7).
        # Human speech, vocalization, singing, coughing, fans, TV are continuous waves (Crest Factor < 2.3).
        rms_l = float(np.sqrt(np.mean(low_l ** 2)))
        rms_r = float(np.sqrt(np.mean(low_r ** 2)))
        current_rms = max(rms_l, rms_r)
        crest_factor = current_peak / (current_rms + 1e-6)
        if crest_factor < 2.2:
            # It is a continuous acoustic wave (voice, background chatter, or fan), NOT a mechanical tap!
            return

        # 6. Check vocal cord pitch harmonicity across rolling 1024-sample window
        harmonicity = self._compute_harmonicity(self.history_buffer)
        if harmonicity > 0.40:
            # Human vocal cord harmonic detected, reject!
            return

        # 7. Check refractory debouncing (prevent mechanical body ringing)
        with self.lock:
            if now - self.last_tap_time < self.refractory_period_s:
                return
                
            # Valid physical tap registered!
            self.last_tap_time = now
            self.current_taps += 1
            if current_peak > self.max_peak_in_group:
                self.max_peak_in_group = current_peak
                
            # Classify side
            if self.detect_sides and raw_chunk.shape[1] >= 2:
                if peak_l > 1.35 * peak_r:
                    tap_side = "left"
                elif peak_r > 1.35 * peak_l:
                    tap_side = "right"
                else:
                    tap_side = "center"
            else:
                tap_side = "center"
                
            if self.current_taps == 1:
                self.current_side = tap_side

            # Reset or start grouping timer
            if self.group_timer is not None:
                self.group_timer.cancel()
                
            if self.current_taps == 3:
                self.group_timer = threading.Timer(0.10, self._dispatch_gesture)
            elif self.current_taps > 3:
                self.group_timer = None
                return
            else:
                self.group_timer = threading.Timer(self.grouping_window_s, self._dispatch_gesture)
                
            self.group_timer.daemon = True
            self.group_timer.start()

    def _dispatch_gesture(self):
        with self.lock:
            taps = self.current_taps
            side = self.current_side
            peak = self.max_peak_in_group
            
            # Reset
            self.current_taps = 0
            self.current_side = "center"
            self.max_peak_in_group = 0.0
            self.group_timer = None
            
        if 1 <= taps <= 3:
            gesture = DetectedTapGesture(count=taps, side=side, peak=peak)
            print(f"[TapDetector] >> GESTURE DETECTED: {gesture}")
            if self.on_gesture_detected:
                self.on_gesture_detected(gesture)
        elif taps > 3:
            print(f"[TapDetector] Rejected {taps} pulses (continuous noise)")
