import time
import numpy as np
import sounddevice as sd
from scipy.signal import butter, sosfilt

sr = 48000
sos_low = butter(2, [35/(sr/2), 450/(sr/2)], btype='bandpass', output='sos')
sos_high = butter(2, 1200/(sr/2), btype='highpass', output='sos')

def is_physical_knock(chunk):
    # chunk shape: (N,)
    low = sosfilt(sos_low, chunk)
    high = sosfilt(sos_high, chunk)
    
    e_low = float(np.sum(low ** 2))
    e_high = float(np.sum(high ** 2))
    
    peak = float(np.max(np.abs(low)))
    if peak < 0.04:
        return False, peak, 0.0, 0.0, "Too quiet"
        
    ratio = e_high / (e_low + 1e-9)
    if ratio > 0.08:
        return False, peak, ratio, 0.0, f"Rejected: High-frequency speech/noise ratio ({ratio:.3f} > 0.08)"
        
    # Check harmonicity (autocorrelation)
    min_lag = int(sr / 400)
    max_lag = int(sr / 80)
    sig_norm = low - np.mean(low)
    var = np.sum(sig_norm ** 2)
    if var > 1e-7:
        corr = np.correlate(sig_norm, sig_norm, mode='full')
        corr = corr[len(sig_norm)-1:]
        lags_corr = corr[min_lag:max_lag]
        harmonicity = float(np.max(lags_corr) / var)
    else:
        harmonicity = 0.0
        
    if harmonicity > 0.35:
        return False, peak, ratio, harmonicity, f"Rejected: Voice pitch harmonicity ({harmonicity:.2f} > 0.35)"
        
    return True, peak, ratio, harmonicity, "ACCEPTED: Physical Knock!"

# Test with synthetic speech vs synthetic tap
t = np.linspace(0, 0.02, int(sr * 0.02))
voice = (np.sin(2*np.pi*160*t) + 0.4*np.sin(2*np.pi*1800*t)) * 0.4
tap = (np.sin(2*np.pi*90*t) * np.exp(-t/0.005)) * 0.5

print("Test Synthetic Voice:", is_physical_knock(voice)[-1])
print("Test Synthetic Knock:", is_physical_knock(tap)[-1])
