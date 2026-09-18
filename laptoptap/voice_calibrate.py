import os
import sys
import time
import subprocess
from pathlib import Path

# Enable UTF-8 console output for Windows
if os.name == 'nt':
    os.system('chcp 65001 > nul 2>&1')

try:
    import winsound
    HAS_WINSOUND = True
except ImportError:
    HAS_WINSOUND = False

from config_manager import ConfigManager


def play_beep(success=True):
    if not HAS_WINSOUND:
        return
    try:
        if success:
            winsound.Beep(1200, 70)
        else:
            winsound.Beep(450, 100)
    except Exception:
        pass


def make_meter(val, max_len=10):
    val = max(0.0, min(1.0, val))
    filled = int(round(val * max_len))
    return "█" * filled + "░" * (max_len - filled)


class VoiceCalibrator:
    def __init__(self):
        self.config = ConfigManager()
        self.exe_path = Path(__file__).parent / "VoiceRecognizer.exe"
        if not self.exe_path.exists():
            print(f"\n[Error] VoiceRecognizer.exe was not found at: {self.exe_path}")
            print("Please build it first or check directory contents.")
            sys.exit(1)

    def capture_command_trials(self, command_name, target_count=4):
        print(f"\n" + "-" * 66)
        print(f"  🎯 COMMAND: « {command_name.upper()} »")
        print(f"-" * 66)
        print(f"  لطفاً کلمه «{command_name}» را {target_count} بار با صدای طبیعی و واضح بگویید.")
        print(f"  (Please say '{command_name}' {target_count} times clearly into your microphone.)")
        print(f"  • دکمه [Enter] را بزنید تا شروع به شنیدن کند:")
        input("    >>> Press [Enter] to start listening... ")

        # Launch recognizer with very low threshold (0.01) to catch every variation and measure true confidence
        proc = subprocess.Popen(
            [str(self.exe_path), "0.01"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8',
            bufsize=1
        )

        collected = []
        try:
            print(f"\n  [🎙️ Listening for '{command_name}'... Speak now!]")
            print(f"  (Tip: If you have captured at least 2 trials, you can press Ctrl+C to move to next word)\n")

            while len(collected) < target_count:
                line = proc.stdout.readline()
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue

                if line.startswith("STATUS:"):
                    continue

                if line.startswith("ERROR:"):
                    print(f"\n  ❌ [Engine Error] {line}")
                    break

                if line.startswith("VOICE_CMD:") or line.startswith("DEBUG_LOW_CONF:"):
                    parts = line.split(":")
                    if len(parts) >= 3:
                        is_low = line.startswith("DEBUG_LOW_CONF:")
                        raw_word = parts[1].strip()
                        raw_conf = parts[2].strip().replace(',', '.').replace('/', '.')
                        try:
                            conf = float(raw_conf)
                        except ValueError:
                            conf = 0.50

                        spoken_text = raw_word
                        if not is_low and len(parts) >= 4:
                            spoken_text = parts[3].strip()

                        # Check if matches target command
                        is_match = (
                            command_name.lower() in spoken_text.lower()
                            or command_name.lower() in raw_word.lower()
                        )

                        if is_match:
                            collected.append(conf)
                            meter = make_meter(conf)
                            play_beep(True)
                            print(f"    ✓ [Trial {len(collected)}/{target_count}] Confidence: {conf*100:5.1f}% [{meter}] Heard: '{spoken_text}'")
                        else:
                            # Inform user what was heard instead of staying silent
                            if conf >= 0.35:
                                print(f"    ℹ Heard: '{spoken_text}' ({conf*100:.0f}%) -> Please say '{command_name}' clearly.")
                            else:
                                print(f"    ~ [Ambient noise / low signal: {conf*100:.0f}%]")

        except KeyboardInterrupt:
            print(f"\n  [Stage skipped by user. {len(collected)} trial(s) recorded for '{command_name}']")
        finally:
            self._safe_close_proc(proc)

        return collected

    def _safe_close_proc(self, proc):
        try:
            if proc.poll() is None:
                if proc.stdin and not proc.stdin.closed:
                    try:
                        proc.stdin.write("quit\n")
                        proc.stdin.flush()
                    except Exception:
                        pass
                proc.terminate()
                try:
                    proc.wait(timeout=1.0)
                except Exception:
                    proc.kill()
        except Exception:
            pass

    def run_full_calibration(self):
        print("\n" + "=" * 66)
        print("    LAPTOP-TAP VOICE CALIBRATION WIZARD (100% PRECISION)        ")
        print("    کالیبراسیون و سنجش آکوستیک صدای شما برای دقت ۱۰۰٪          ")
        print("=" * 66)
        print("  این برنامه تن صدا، نویز محیط و حساسیت میکروفون پیش‌فرض ویندوز")
        print("  شما را بررسی می‌کند تا دستورات صوتی بدون خطا اجرا شوند.\n")
        print("  دستوراتی که بررسی می‌شوند:")
        print("   1. 'Copy'       (رایج‌ترین دستور)")
        print("   2. 'Paste'      (دستور سریع)")
        print("   3. 'Undo'       (برگشت عملیات)")
        print("   4. 'Screenshot' (چندسیلابی)\n")

        commands = ["copy", "paste", "undo", "screenshot"]
        results = {}

        for cmd in commands:
            confs = self.capture_command_trials(cmd, target_count=4)
            if confs:
                results[cmd] = confs
            else:
                print(f"  ⚠ هشدار: هیچ داده‌ای برای «{cmd}» ضبط نشد.")

        print("\n" + "=" * 66)
        print("                  VOICE ANALYSIS RESULTS                          ")
        print("                  نتایج آنالیز صوتی شما                           ")
        print("=" * 66)

        all_confs = []
        for cmd in commands:
            confs = results.get(cmd, [])
            if confs:
                all_confs.extend(confs)
                cmd_min = min(confs)
                cmd_avg = sum(confs) / len(confs)
                cmd_max = max(confs)
                print(f"  📊 {cmd.upper():<12} : Avg {cmd_avg*100:5.1f}% | Min {cmd_min*100:5.1f}% | Max {cmd_max*100:5.1f}% ({len(confs)} samples)")
            else:
                print(f"  📊 {cmd.upper():<12} : (No samples recorded)")

        if not all_confs:
            print("\n  ❌ خطایی رخ داد: هیچ صدایی در طول تست ضبط نشد.")
            print("  لطفاً میکروفون پیش‌فرض ویندوز خود را در Windows Sound Settings بررسی کنید.")
            input("\nPress Enter to exit...")
            return

        global_min = min(all_confs)
        global_avg = sum(all_confs) / len(all_confs)

        # Calculate optimal threshold:
        # Give a small safety margin below the minimum confidence so natural speech
        # is never rejected, while keeping it high enough to reject background noise.
        optimal_threshold = max(0.40, min(0.85, global_min - 0.08))

        print("\n" + "-" * 66)
        print("  ⚙️ تنظیمات نهایی محاسبه‌شده:")
        print(f"     • میانگین اطمینان صدای شما: {global_avg*100:.1f}%")
        print(f"     • کمترین اطمینان ثبت‌شده:   {global_min*100:.1f}%")
        print(f"     • آستانه بهینه پیشنهادی:     {optimal_threshold*100:.1f}% ({optimal_threshold:.2f})")
        print("-" * 66)

        self.config.set("voice_confidence_threshold", round(optimal_threshold, 2))
        self.config.set("enable_voice_commands", True)

        print("\n" + "=" * 66)
        print("  ✓ کالیبراسیون با موفقیت به پایان رسید!")
        print("  ✓ آستانه اطمینان به طور خودکار در تنظیمات ذخیره شد.")
        print("=" * 66 + "\n")
        play_beep(True)
        time.sleep(0.5)
        play_beep(True)

        input("Press [Enter] to exit calibration wizard... ")


if __name__ == "__main__":
    calibrator = VoiceCalibrator()
    try:
        calibrator.run_full_calibration()
    except KeyboardInterrupt:
        print("\n\nCalibration cancelled by user.")
