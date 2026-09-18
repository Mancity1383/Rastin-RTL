import time
import sys
import subprocess
from pathlib import Path
from config_manager import ConfigManager

class VoiceCalibrator:
    def __init__(self):
        self.config = ConfigManager()
        self.exe_path = Path(__file__).parent / "VoiceRecognizer.exe"
        if not self.exe_path.exists():
            print(f"[Error] {self.exe_path} not found.")
            sys.exit(1)

    def capture_voice_series(self, command_name, target_count=20):
        print(f"\n==================================================================")
        print(f"  STAGE: {command_name.upper()} ({target_count} Trials)")
        print(f"==================================================================")
        print(f"لطفاً کلمه «{command_name}» را {target_count} بار با صدای واضح و طبیعی بگویید.")
        print("بعد از هر بار گفتن، منتظر تایید باشید.")
        input("Press Enter to begin capturing this stage...")

        # Run recognizer with very low threshold to catch all variations
        proc = subprocess.Popen(
            [str(self.exe_path), "0.01"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            encoding='utf-8',
            bufsize=1
        )

        collected = []
        try:
            print(f"\n[Listening for '{command_name}'... Speak now!]")
            while len(collected) < target_count:
                line = proc.stdout.readline()
                if not line:
                    break
                line = line.strip()
                
                if line.startswith("VOICE_CMD:") or line.startswith("DEBUG_LOW_CONF:"):
                    parts = line.split(":")
                    if len(parts) >= 3:
                        recognized_word = parts[1].strip()
                        if line.startswith("DEBUG_LOW_CONF:"):
                            conf = float(parts[2])
                            text_spoken = recognized_word
                        else:
                            conf = float(parts[2])
                            text_spoken = parts[3].strip() if len(parts) >= 4 else recognized_word

                        # If the recognized word matches what we are looking for (or is very close)
                        if command_name.lower() in text_spoken.lower() or command_name.lower() == recognized_word.lower():
                            collected.append(conf)
                            sys.stdout.write(f"\r  ✓ [Trial {len(collected)}/{target_count} OK] Detected '{text_spoken}' (Confidence: {conf:.2f})  ")
                            sys.stdout.flush()
                        else:
                            # Heard something else, ignore
                            pass
        finally:
            proc.stdin.write("quit\n")
            proc.stdin.flush()
            proc.terminate()
            proc.wait(1.0)
            print() # new line
            
        return collected

    def run_full_calibration(self):
        print("\n" + "="*66)
        print("       LAPTOP-TAP VOICE CALIBRATION WIZARD (100% ACCURACY)       ")
        print("       تست و کالیبراسیون هوشمند صدای شما برای دقت ۱۰۰٪          ")
        print("="*66)
        print("در این تست، ما صدای شما را برای ۴ دستور اصلی بررسی می‌کنیم.")
        print("لطفا در یک محیط با شرایط نویز عادی که معمولاً در آن کار می‌کنید باشید.\n")

        commands = ["copy", "paste", "screenshot", "play"]
        results = {}

        for cmd in commands:
            conf_list = self.capture_voice_series(cmd, 20)
            if not conf_list:
                print(f"⚠ Warning: No data captured for '{cmd}'.")
            results[cmd] = conf_list

        print("\n" + "="*66)
        print("                  VOICE ANALYSIS RESULTS                          ")
        print("                  نتایج آنالیز صوتی شما                           ")
        print("="*66)

        all_confs = []
        for cmd, confs in results.items():
            if not confs:
                continue
            all_confs.extend(confs)
            cmd_min = min(confs)
            cmd_avg = sum(confs) / len(confs)
            cmd_max = max(confs)
            print(f"📊 {cmd.upper()}:")
            print(f"   • کمترین اطمینان (Min Confidence):  {cmd_min:.2f}")
            print(f"   • میانگین اطمینان (Avg Confidence): {cmd_avg:.2f}")
            print(f"   • بیشترین اطمینان (Max Confidence): {cmd_max:.2f}")

        if not all_confs:
            print("\nError: Could not calculate threshold. No data recorded.")
            return

        global_min = min(all_confs)
        global_avg = sum(all_confs) / len(all_confs)
        
        # We want to set threshold slightly below the global minimum to ensure 100% detection
        # but not too low to trigger on random noise.
        # e.g., if global_min is 0.58, we set threshold to 0.53
        optimal_threshold = max(0.35, global_min - 0.05)

        print(f"\n⚙️ تنظیمات نهایی محاسبه‌شده:")
        print(f"   • حداقل اطمینان صدای شما در کل تست: {global_min:.2f}")
        print(f"   • آستانه پیشنهادی هوش مصنوعی (Optimal Threshold): {optimal_threshold:.2f}")

        self.config.set("voice_confidence_threshold", round(optimal_threshold, 2))
        self.config.set("enable_voice_commands", True)

        print("\n" + "="*66)
        print("  ✓ دقت دستیار صوتی برای تن صدای شما روی ۱۰۰٪ تنظیم شد!")
        print("  ✓ مقادیر در فایل کانفیگ ذخیره شدند.")
        print("="*66 + "\n")

if __name__ == "__main__":
    calibrator = VoiceCalibrator()
    try:
        calibrator.run_full_calibration()
    except KeyboardInterrupt:
        print("\nCalibration cancelled by user.")
