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
    State-of-the-Art Scientific Acoustic Shock Detector for Laptop Chassis:
    Implements multi-stage physical acoustic filtering based on structural wave propagation:
    1. Rise-Time / Attack Velocity Gate (<3.5ms for solid chassis shock vs >10ms for airborne sound).
    2. Spectral Band Energy Ratio: Low (35-450Hz chassis flex) vs High (>1200Hz airborne speech/claps).
    3. Crest Factor & Transient Impulsiveness Analysis.
    4. True Harmonicity Voice Shield (Autocorrelation pitch detection across 80-400Hz).
    5. Anti-Ringing Refractory Lockout (prevents plastic bounce double-counting).
    6. Non-blocking state machine with fail-safe auto-reset for multi-tap combos.
    7. Hardware Keyboard Typing Suppression.
    """

    def __init__(self, config_manager, on_gesture_detected=None, on_level_update=None, sample_rate=48000):
        self.config_manager = config_manager
        self.on_gesture_detected = on_gesture_detected
        self.on_level_update = on_level_update
        self.sample_rate = sample_rate
        
        # Continuous rolling ring buffers (2048 samples ~ 42.6ms)
        self.buf_len = 2048
        self.buf_low_l = np.zeros(self.buf_len, dtype=np.float32)
        self.buf_low_r = np.zeros(self.buf_len, dtype=np.float32)
        self.buf_high_l = np.zeros(self.buf_len, dtype=np.float32)
        self.buf_high_r = np.zeros(self.buf_len, dtype=np.float32)
        
        # Adaptive noise floor tracking (Asymmetric dual-rate leaky tracker)
        self.noise_floor = 0.0015
        self.noise_alpha_slow = 0.005
        self.noise_alpha_fast = 0.025
        
        # Gesture state machine
        self.last_tap_time = 0.0
        self.current_taps = 0
        self.current_side = "center"
        self.max_peak_in_group = 0.0
        self.group_timer = None
        self.reset_timer = None
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

    def notify_speech_active(self, duration_s=0.60):
        """Mute tap detector whenever VoiceRecognizer is actively receiving speech."""
        self.voice_speech_active_until = max(self.voice_speech_active_until, time.time() + duration_s)

    @property
    def sensitivity(self):
        return self.config_manager.get("sensitivity", 0.90)

    @property
    def grouping_window_s(self):
        return self.config_manager.get("grouping_window_ms", 400) / 1000.0

    @property
    def refractory_period_s(self):
        return self.config_manager.get("refractory_period_ms", 110) / 1000.0

    @property
    def suppress_typing(self):
        return self.config_manager.get("suppress_typing", True)

    @property
    def typing_cooldown_s(self):
        return self.config_manager.get("typing_cooldown_ms", 400) / 1000.0

    @property
    def detect_sides(self):
        return self.config_manager.get("detect_sides", True)

    @property
    def max_hf_ratio(self):
        return self.config_manager.get("max_hf_ratio", 0.36)

    @property
    def max_rise_time_ms(self):
        return self.config_manager.get("max_rise_time_ms", 4.5)

    def calculate_threshold(self):
        """
        Dynamically calibrated threshold adapted to laptop chassis sensitivity.
        Maps sensitivity [0.1, 1.0] -> base threshold [0.010, 0.120].
        At sensitivity 0.90 -> threshold is ~0.021 (well above room noise floor ~0.001).
        """
        sens = max(0.10, min(1.0, self.sensitivity))
        min_thresh = 0.010
        max_thresh = 0.120
        base = max_thresh - sens * (max_thresh - min_thresh)
        # Never drop below 3x noise floor
        return max(base, self.noise_floor * 3.2, 0.008)

    def _compute_harmonicity(self, signal):
        """
        Calculates normalized autocorrelation in pitch lag range (80 Hz - 400 Hz).
        Human vowels and speech have harmonicity > 0.38.
        Mechanical taps and impulses have harmonicity < 0.22.
        """
        min_lag = max(1, int(self.sample_rate / 400)) # ~120 samples
        max_lag = min(len(signal) - 1, int(self.sample_rate / 80)) # ~600 samples
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

    def _compute_rise_time_ms(self, signal, peak_idx, peak_val):
        """
        Measures the attack rise time (ms) from 20% amplitude up to peak.
        Mechanical strikes transfer shock in < 3.0ms.
        Airborne speech, coughs, and ambient sounds take > 7.0ms to build up.
        """
        if peak_idx <= 2 or peak_val < 1e-5:
            return 1.0
        thresh_20 = 0.20 * peak_val
        pre_peak = np.abs(signal[:peak_idx])
        below = np.where(pre_peak < thresh_20)[0]
        start_idx = below[-1] if len(below) > 0 else 0
        rise_samples = peak_idx - start_idx
        return (rise_samples / float(self.sample_rate)) * 1000.0

    def process_chunk(self, low_l, low_r, high_l, high_r, raw_chunk):
        now = time.time()
        step = len(low_l)
        
        # Update rolling history ring buffers
        if step < self.buf_len:
            self.buf_low_l[:-step] = self.buf_low_l[step:]
            self.buf_low_l[-step:] = low_l
            self.buf_low_r[:-step] = self.buf_low_r[step:]
            self.buf_low_r[-step:] = low_r
            self.buf_high_l[:-step] = self.buf_high_l[step:]
            self.buf_high_l[-step:] = high_l
            self.buf_high_r[:-step] = self.buf_high_r[step:]
            self.buf_high_r[-step:] = high_r
        else:
            self.buf_low_l[:] = low_l[-self.buf_len:]
            self.buf_low_r[:] = low_r[-self.buf_len:]
            self.buf_high_l[:] = high_l[-self.buf_len:]
            self.buf_high_r[:] = high_r[-self.buf_len:]
            
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

        # 3. Check active speech lockout
        if now < self.voice_speech_active_until:
            return

        # 4. Check sustained sound duration (reject continuous talking, singing, TV)
        # Physical chassis knocks ring down within 35ms (~6-7 blocks). Continuous sounds stay loud > 8 blocks.
        if self.consecutive_loud_blocks > 7:
            self.is_in_sustained_sound = True
            return
            
        if self.is_in_sustained_sound:
            return

        # 5. HIGH-FREQUENCY AIRBORNE REJECTION (Spectral Energy Ratio)
        # Physics: Solid chassis absorbs high frequencies (>1200Hz) dramatically.
        # Airborne sound (speech, plosives 'P'/'T'/'S', clapping, keyboard clicks) radiates massive HF energy.
        e_low = float(np.sum(low_l ** 2) + np.sum(low_r ** 2))
        e_high = float(np.sum(high_l ** 2) + np.sum(high_r ** 2))
        hf_ratio = e_high / (e_low + 1e-7)
        if hf_ratio > self.max_hf_ratio:
            # Significant airborne high-frequency acoustic content (speech / clapping / hiss) -> Reject!
            return

        # 6. CREST FACTOR FILTER (Peak-to-RMS ratio over recent analysis window)
        win = 512
        recent_low = self.buf_low_l[-win:] if peak_l >= peak_r else self.buf_low_r[-win:]
        win_peak = float(np.max(np.abs(recent_low)))
        win_rms = float(np.sqrt(np.mean(recent_low ** 2)))
        crest_factor = win_peak / (win_rms + 1e-6)
        if crest_factor < 2.05:
            # Continuous sinusoidal or gaussian acoustic wave, not a mechanical shock -> Reject!
            return

        # 7. ATTACK RISE-TIME GATE
        # Mechanical knuckle tap delivers instantaneous shock in < 3.5ms.
        # Human vocal envelope builds up much slower (> 8ms).
        peak_idx = int(np.argmax(np.abs(recent_low)))
        rise_time_ms = self._compute_rise_time_ms(recent_low, peak_idx, win_peak)
        if rise_time_ms > self.max_rise_time_ms:
            # Slow envelope attack -> Reject!
            return

        # 8. TRUE HARMONICITY PITCH REJECTION (Voice Shield)
        # Checks 1024-sample window for periodic vocal fold vibration (80 - 400 Hz)
        harmonicity = self._compute_harmonicity(self.buf_low_l[-1024:])
        if harmonicity > 0.38:
            # Vocal chord fundamental detected -> Reject!
            return

        # 9. REFRACTORY DEBOUNCING (Anti-Ringing Lockout)
        with self.lock:
            if now - self.last_tap_time < self.refractory_period_s:
                # Still within mechanical ring-down bounce cooldown
                return
                
            # Valid physical chassis tap registered!
            self.last_tap_time = now
            self.current_taps += 1
            if current_peak > self.max_peak_in_group:
                self.max_peak_in_group = current_peak
                
            # Classify side based on stereo microphone energy
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
                self.group_timer = None
                
            if self.reset_timer is not None:
                self.reset_timer.cancel()
                self.reset_timer = None

            if self.current_taps == 3:
                # 3 taps reached: dispatch promptly (fast response)
                self.group_timer = threading.Timer(0.12, self._dispatch_gesture)
                self.group_timer.daemon = True
                self.group_timer.start()
            elif self.current_taps > 3:
                # Overflow (e.g. continuous table banging or vibration):
                # Set a fail-safe auto-reset timer to cleanly reset state after 250ms of quiet!
                self.reset_timer = threading.Timer(0.25, self._reset_state)
                self.reset_timer.daemon = True
                self.reset_timer.start()
                return
            else:
                # 1 or 2 taps: wait for the grouping window in case another tap follows
                self.group_timer = threading.Timer(self.grouping_window_s, self._dispatch_gesture)
                self.group_timer.daemon = True
                self.group_timer.start()

    def _reset_state(self):
        """Cleanly resets tap state after an overflow (>3 taps)."""
        with self.lock:
            rejected = self.current_taps
            self.current_taps = 0
            self.current_side = "center"
            self.max_peak_in_group = 0.0
            self.group_timer = None
            self.reset_timer = None
        if rejected > 3:
            print(f"[TapDetector] Ignored burst of {rejected} pulses (continuous rumble/noise). State cleanly reset.")

    def _dispatch_gesture(self):
        with self.lock:
            taps = self.current_taps
            side = self.current_side
            peak = self.max_peak_in_group
            
            # Reset state for next gesture
            self.current_taps = 0
            self.current_side = "center"
            self.max_peak_in_group = 0.0
            self.group_timer = None
            self.reset_timer = None
            
        if 1 <= taps <= 3:
            gesture = DetectedTapGesture(count=taps, side=side, peak=peak)
            print(f"[TapDetector] >> PRECISION GESTURE DETECTED: {gesture}")
            if self.on_gesture_detected:
                self.on_gesture_detected(gesture)
        elif taps > 3:
            print(f"[TapDetector] Rejected {taps} pulses (continuous noise)")
