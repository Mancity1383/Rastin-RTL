import time
import sys
import numpy as np
import sounddevice as sd
from scipy.signal import butter, sosfilt
from config_manager import ConfigManager

class TapCalibrator:
    def __init__(self, sample_rate=44100, block_size=256):
        self.sample_rate = sample_rate
        self.block_size = block_size
        self.config = ConfigManager()
        
        # Dual-band filters
        nyquist = 0.5 * self.sample_rate
        self.sos_low = butter(2, [35.0 / nyquist, 450.0 / nyquist], btype='bandpass', output='sos')
        self.sos_high = butter(2, 1200.0 / nyquist, btype='highpass', output='sos')
        
        # Calibration data containers
        self.ambient_noise_peaks = []
        self.voice_peaks = []
        self.voice_harmonics = []
        self.single_taps = [] # list of {peak, duration_ms, ratio, harmonicity}
        self.double_taps = [] # list of {peaks: [p1, p2], interval_ms}
        self.triple_taps = [] # list of {peaks: [p1, p2, p3], intervals: [i1, i2]}

    def _compute_harmonicity(self, signal):
        min_lag = max(1, int(self.sample_rate / 400))
        max_lag = min(len(signal) - 1, int(self.sample_rate / 80))
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

    def record_seconds(self, duration_s, prompt):
        print(f"\n>>> {prompt} ({duration_s} seconds)...")
        for remaining in range(duration_s, 0, -1):
            sys.stdout.write(f"\r    [ {remaining}s remaining... ] ")
            sys.stdout.flush()
            time.sleep(1)
        sys.stdout.write("\r    [ Recording complete! ]           \n")
        sys.stdout.flush()

    def record_samples(self, duration_s):
        num_frames = int(self.sample_rate * duration_s)
        audio = sd.rec(num_frames, samplerate=self.sample_rate, channels=1, blocking=True)
        return audio[:, 0]

    def measure_ambient_and_voice(self):
        print("==================================================================")
        print("  STEP 0: Ambient Noise & Voice Calibration (کالیبراسیون نویز و صدا) ")
        print("==================================================================")
        print("1. Please stay COMPLETELY SILENT for 3 seconds to measure room noise.")
        input("   Press Enter when you are ready to start silence test...")
        silence_audio = self.record_samples(3.0)
        filtered_silence = sosfilt(self.sos_low, silence_audio)
        ambient_rms = float(np.sqrt(np.mean(filtered_silence ** 2)))
        ambient_peak = float(np.max(np.abs(filtered_silence)))
        print(f"   ✓ Ambient Noise Floor: RMS = {ambient_rms:.4f}, Peak = {ambient_peak:.4f}")

        print("\n2. Now please SPEAK or SAY A SENTENCE (or say 'Copy / Testing') for 3 seconds.")
        input("   Press Enter and start speaking normally...")
        voice_audio = self.record_samples(3.0)
        filtered_voice_low = sosfilt(self.sos_low, voice_audio)
        filtered_voice_high = sosfilt(self.sos_high, voice_audio)
        voice_peak = float(np.max(np.abs(filtered_voice_low)))
        voice_ratio = float(np.sum(filtered_voice_high ** 2) / (np.sum(filtered_voice_low ** 2) + 1e-9))
        voice_harm = self._compute_harmonicity(filtered_voice_low[:1024])
        print(f"   ✓ Voice Profile: Peak = {voice_peak:.4f}, High/Low Ratio = {voice_ratio:.4f}, Harmonicity = {voice_harm:.2f}")

        return ambient_peak, voice_peak, voice_ratio, voice_harm

    def capture_tap_series(self, target_count, series_name, description, repeats=5):
        print(f"\n==================================================================")
        print(f"  {series_name}: {repeats} Trials ({description})")
        print(f"==================================================================")
        print(f"لطفاً {repeats} بار ضربه {description} را با بندانگشت روی بدنه لپ‌تاپ بزنید.")
        print(f"بعد از آماده شدن، کلید Enter را بزنید تا برنامه شروع به شنیدن کند.")
        input("Press Enter to begin capturing this stage...")

        collected = []
        state_low = np.zeros((self.sos_low.shape[0], 2))
        state_high = np.zeros((self.sos_high.shape[0], 2))

        # Sensitive threshold during calibration to capture even soft knocks
        cal_thresh = 0.016
        
        # Audio stream capture
        q = []
        def callback(indata, frames, time_info, status):
            q.append(indata[:, 0].copy())

        stream = sd.InputStream(samplerate=self.sample_rate, channels=1, blocksize=256, callback=callback)
        stream.start()

        print(f"\nListening for {repeats} {series_name} trials... (Knock on laptop chassis now!)")

        current_pulses = []
        last_pulse_time = 0.0
        group_deadline = 0.0
        
        trial_num = 1
        start_wait = time.time()
        
        try:
            while trial_num <= repeats:
                if len(q) == 0:
                    time.sleep(0.005)
                    # Check if group timed out
                    if current_pulses and time.time() > group_deadline:
                        if len(current_pulses) == target_count:
                            collected.append(current_pulses)
                            p_str = ", ".join([f"{p['peak']:.3f}" for p in current_pulses])
                            if target_count > 1:
                                intervals = [int((current_pulses[i]['time'] - current_pulses[i-1]['time']) * 1000) for i in range(1, len(current_pulses))]
                                int_str = ", ".join([f"{it}ms" for it in intervals])
                                print(f"  ✓ [Trial {trial_num}/{repeats} OK] Captured {target_count} taps! Peaks: [{p_str}], Intervals: [{int_str}]")
                            else:
                                print(f"  ✓ [Trial {trial_num}/{repeats} OK] Captured Single Tap! Peak: {p_str}, Duration: {current_pulses[0]['dur_ms']:.1f}ms")
                            trial_num += 1
                        else:
                            print(f"  ⚠ [Received {len(current_pulses)} taps instead of {target_count}. Retrying trial {trial_num}...]")
                        current_pulses = []
                    continue

                chunk = q.pop(0)
                now = time.time()

                # Filter chunk
                low, state_low = sosfilt(self.sos_low, chunk, zi=state_low)
                high, state_high = sosfilt(self.sos_high, chunk, zi=state_high)
                
                peak = float(np.max(np.abs(low)))
                e_low = float(np.sum(low ** 2))
                e_high = float(np.sum(high ** 2))
                ratio = e_high / (e_low + 1e-9)

                # Check if sharp pulse
                if peak > cal_thresh and (now - last_pulse_time > 0.065):
                    dur_ms = 8.0
                    last_pulse_time = now
                    current_pulses.append({
                        "peak": peak,
                        "ratio": ratio,
                        "time": now,
                        "dur_ms": dur_ms
                    })
                    group_deadline = now + 0.42
                    
        finally:
            stream.stop()
            stream.close()

        return collected

    def run_full_calibration(self):
        print("\n" + "="*66)
        print("       LAPTOP-TAP INTELLIGENT HARDWARE CALIBRATION WIZARD       ")
        print("       تست و کالیبراسیون هوشمند ضربات اختصاصی لپ‌تاپ شما       ")
        print("="*66)
        print("این تست ویژگی‌های ارتعاشی منحصر به فرد شاسی لپ‌تاپ شما را اندازه می‌گیرد:")
        print("  1. اندازه‌گیری نویز محیط و الگوی صدای گفتار شما")
        print("  2. ثبت ۲۰ ضربه تکی (Single Tap)")
        print("  3. ثبت ۲۰ ضربه دوتایی (Double Tap)")
        print("  4. ثبت ۲۰ ضربه سه‌تایی (Triple Tap)")
        print("  5. تحلیل آماری دقیق و ذخیره خودکار بهترین مقادیر حساسیت و زمان‌بندی\n")

        # 1. Noise & Voice Profile
        amb_peak, voice_peak, voice_ratio, voice_harm = self.measure_ambient_and_voice()

        # 2. Single Taps (20 trials)
        single_results = self.capture_tap_series(1, "STAGE 1", "ضربه تکی (Single Tap)", repeats=20)

        # 3. Double Taps (20 trials)
        double_results = self.capture_tap_series(2, "STAGE 2", "ضربه دوتایی (Double Tap)", repeats=20)

        # 4. Triple Taps (20 trials)
        triple_results = self.capture_tap_series(3, "STAGE 3", "ضربه سه‌تایی (Triple Tap)", repeats=20)

        # 5. Analysis and Tuning
        self.analyze_and_save(amb_peak, voice_peak, single_results, double_results, triple_results)

    def analyze_and_save(self, amb_peak, voice_peak, single_res, double_res, triple_res):
        print("\n" + "="*66)
        print("                  ANALYSIS & CALIBRATION RESULTS                  ")
        print("                  نتایج آنالیز و تنظیم پارامترها                 ")
        print("="*66)

        all_tap_peaks = []
        for trial in single_res:
            all_tap_peaks.append(trial[0]["peak"])
        
        double_intervals = []
        for trial in double_res:
            all_tap_peaks.extend([trial[0]["peak"], trial[1]["peak"]])
            interval = (trial[1]["time"] - trial[0]["time"]) * 1000
            double_intervals.append(interval)

        triple_intervals = []
        for trial in triple_res:
            all_tap_peaks.extend([trial[0]["peak"], trial[1]["peak"], trial[2]["peak"]])
            i1 = (trial[1]["time"] - trial[0]["time"]) * 1000
            i2 = (trial[2]["time"] - trial[1]["time"]) * 1000
            triple_intervals.extend([i1, i2])

        min_tap_peak = float(np.min(all_tap_peaks))
        avg_tap_peak = float(np.mean(all_tap_peaks))
        max_tap_peak = float(np.max(all_tap_peaks))

        all_intervals = double_intervals + triple_intervals
        avg_interval = float(np.mean(all_intervals)) if all_intervals else 150.0
        min_interval = float(np.min(all_intervals)) if all_intervals else 90.0
        max_interval = float(np.max(all_intervals)) if all_intervals else 220.0

        print(f"\n📊 آمارهای فیزیکی ضربات شما:")
        print(f"   • نویز محیطی اتاق:                  {amb_peak:.4f}")
        print(f"   • کمترین قدرت ضربه شما (Min Peak):   {min_tap_peak:.4f}")
        print(f"   • میانگین قدرت ضربه (Avg Peak):     {avg_tap_peak:.4f}")
        print(f"   • بیشترین قدرت ضربه (Max Peak):     {max_tap_peak:.4f}")
        print(f"   • نسبت سیگنال به نویز (SNR):         {(avg_tap_peak / (amb_peak + 1e-6)):.1f}× برابر نویز محیط")
        print(f"\n⏱ آمارهای زمان‌بندی (تمپو و سرعت ضربه زدن شما):")
        print(f"   • کمترین فاصله بین دو ضربه متوالی:    {min_interval:.1f} میلی‌ثانیه")
        print(f"   • میانگین فاصله بین دو ضربه متوالی:  {avg_interval:.1f} میلی‌ثانیه")
        print(f"   • بیشترین فاصله بین دو ضربه متوالی:   {max_interval:.1f} میلی‌ثانیه")

        # Optimal calculations
        # 1. Target threshold: safely above ambient noise floor (2.5x), but well below min tap (0.6x)
        optimal_thresh = max(amb_peak * 2.5, min_tap_peak * 0.55)
        
        # 2. Optimal Sensitivity (maps threshold back to [0.1, 1.0])
        # formula: thresh = max_thresh - sens * (max_thresh - min_thresh)
        # sens = (max_thresh - thresh) / (max_thresh - min_thresh)
        min_thresh = 0.035
        max_thresh = 0.280
        calculated_sens = (max_thresh - optimal_thresh) / (max_thresh - min_thresh)
        optimal_sens = float(np.clip(calculated_sens, 0.25, 0.90))

        # 3. Optimal Grouping Window: max_interval + 130ms margin
        optimal_grouping_ms = int(max_interval + 140)
        optimal_grouping_ms = max(280, min(500, optimal_grouping_ms))

        # 4. Optimal Refractory Period: min_interval * 0.65 (to prevent body ringing while catching fast double taps)
        optimal_refractory_ms = int(min_interval * 0.68)
        optimal_refractory_ms = max(55, min(110, optimal_refractory_ms))

        print(f"\n⚙️ مقادیر بهینه محاسبه‌شده برای سیستم شما:")
        print(f"   • حساسیت بهینه (Sensitivity):       {int(optimal_sens * 100)}% ({optimal_sens:.2f})")
        print(f"   • پنجره زمانی دسته‌بندی (Grouping):    {optimal_grouping_ms} میلی‌ثانیه")
        print(f"   • دوره سکوت بازتاب (Refractory):     {optimal_refractory_ms} میلی‌ثانیه")

        # Save to config
        self.config.set("sensitivity", round(optimal_sens, 2))
        self.config.set("grouping_window_ms", optimal_grouping_ms)
        self.config.set("refractory_period_ms", optimal_refractory_ms)

        print("\n" + "="*66)
        print("  ✓ تمامی تنظیمات بهینه با موفقیت در فایل کانفیگ ذخیره شدند!")
        print("  ✓ اکنون برنامه LaptopTap بر مبنای ضربات اختصاصی شما کالیبره شده است.")
        print("="*66 + "\n")

if __name__ == "__main__":
    calibrator = TapCalibrator()
    try:
        calibrator.run_full_calibration()
    except KeyboardInterrupt:
        print("\nCalibration cancelled by user.")
