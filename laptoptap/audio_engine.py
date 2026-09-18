import time
import numpy as np
import sounddevice as sd
from scipy.signal import butter, sosfilt

class AudioEngine:
    """
    Captures low-latency audio from the internal microphone array and
    applies dual-band real-time DSP:
    1. Low band (35 Hz - 450 Hz): isolates solid chassis mechanical resonance.
    2. High band (> 1200 Hz): monitors airborne acoustic energy to detect human voice/plosives.
    """
    
    def __init__(self, sample_rate=48000, block_size=256, device_index=None, on_audio_chunk=None):
        self.sample_rate = sample_rate
        self.block_size = block_size
        self.device_index = device_index
        self.on_audio_chunk = on_audio_chunk
        self.stream = None
        self.is_running = False
        
        # Dual-band filter design
        nyquist = 0.5 * self.sample_rate
        low_band = [35.0 / nyquist, 450.0 / nyquist]
        high_cutoff = 1200.0 / nyquist
        
        # Low band: 2nd-order Butterworth bandpass (chassis resonance)
        self.sos_low = butter(2, low_band, btype='bandpass', output='sos')
        self.state_low_l = np.zeros((self.sos_low.shape[0], 2))
        self.state_low_r = np.zeros((self.sos_low.shape[0], 2))
        
        # High band: 2nd-order Butterworth highpass (speech / plosives / air hiss)
        self.sos_high = butter(2, high_cutoff, btype='highpass', output='sos')
        self.state_high_l = np.zeros((self.sos_high.shape[0], 2))
        self.state_high_r = np.zeros((self.sos_high.shape[0], 2))
        
        # Ring buffer for UI live waveform visualization
        self.waveform_history_len = 1024
        self.waveform_history = np.zeros(self.waveform_history_len, dtype=np.float32)

    @staticmethod
    def get_input_devices():
        devices = []
        try:
            device_list = sd.query_devices()
            for idx, dev in enumerate(device_list):
                if dev.get('max_input_channels', 0) > 0:
                    devices.append({
                        'index': idx,
                        'name': dev.get('name', f'Device {idx}'),
                        'channels': dev.get('max_input_channels', 1),
                        'default_samplerate': dev.get('default_samplerate', 48000)
                    })
        except Exception as e:
            print(f"[AudioEngine] Error querying devices: {e}")
        return devices

    @staticmethod
    def find_internal_mic_index():
        devices = AudioEngine.get_input_devices()
        for dev in devices:
            name_lower = dev['name'].lower()
            if 'array' in name_lower or 'realtek' in name_lower:
                return dev['index']
        try:
            default_in = sd.default.device[0]
            if default_in is not None and default_in >= 0:
                return default_in
        except Exception:
            pass
        return devices[0]['index'] if devices else None

    def start(self):
        if self.is_running:
            return
            
        dev_idx = self.device_index
        if dev_idx is None:
            dev_idx = self.find_internal_mic_index()
            
        try:
            dev_info = sd.query_devices(dev_idx)
            channels = min(2, dev_info.get('max_input_channels', 1))
            actual_sr = int(dev_info.get('default_samplerate', self.sample_rate))
            if actual_sr not in (44100, 48000, 96000):
                actual_sr = self.sample_rate
                
            self.sample_rate = actual_sr
            nyquist = 0.5 * self.sample_rate
            low_band = [35.0 / nyquist, 450.0 / nyquist]
            high_cutoff = 1200.0 / nyquist
            
            self.sos_low = butter(2, low_band, btype='bandpass', output='sos')
            self.state_low_l = np.zeros((self.sos_low.shape[0], 2))
            self.state_low_r = np.zeros((self.sos_low.shape[0], 2))
            
            self.sos_high = butter(2, high_cutoff, btype='highpass', output='sos')
            self.state_high_l = np.zeros((self.sos_high.shape[0], 2))
            self.state_high_r = np.zeros((self.sos_high.shape[0], 2))

            print(f"[AudioEngine] Opening stream on device #{dev_idx} ({dev_info['name']}) at {actual_sr}Hz, {channels}ch")
            self.stream = sd.InputStream(
                device=dev_idx,
                channels=channels,
                samplerate=actual_sr,
                blocksize=self.block_size,
                latency='low',
                callback=self._audio_callback
            )
            self.stream.start()
            self.is_running = True
            print("[AudioEngine] Audio capture started successfully.")
        except Exception as e:
            print(f"[AudioEngine] Failed to start audio stream: {e}")
            self.is_running = False

    def stop(self):
        if not self.is_running:
            return
        try:
            if self.stream:
                self.stream.stop()
                self.stream.close()
                self.stream = None
            self.is_running = False
            print("[AudioEngine] Audio stream stopped.")
        except Exception as e:
            print(f"[AudioEngine] Error stopping audio stream: {e}")

    def _audio_callback(self, indata, frames, time_info, status):
        if status:
            pass
            
        if not self.is_running or frames == 0:
            return
            
        channels = indata.shape[1]
        
        # Filter low band (chassis mechanical shock)
        low_l, self.state_low_l = sosfilt(self.sos_low, indata[:, 0], zi=self.state_low_l)
        if channels >= 2:
            low_r, self.state_low_r = sosfilt(self.sos_low, indata[:, 1], zi=self.state_low_r)
        else:
            low_r = low_l
            
        # Filter high band (speech / airborne voice)
        high_l, self.state_high_l = sosfilt(self.sos_high, indata[:, 0], zi=self.state_high_l)
        if channels >= 2:
            high_r, self.state_high_r = sosfilt(self.sos_high, indata[:, 1], zi=self.state_high_r)
        else:
            high_r = high_l

        # Update rolling waveform history for UI display
        step = len(low_l)
        if step < self.waveform_history_len:
            self.waveform_history[:-step] = self.waveform_history[step:]
            self.waveform_history[-step:] = low_l
        else:
            self.waveform_history[:] = low_l[-self.waveform_history_len:]
            
        # Forward processed signals to callback: (low_l, low_r, high_l, high_r, raw_chunk)
        if self.on_audio_chunk:
            self.on_audio_chunk(low_l, low_r, high_l, high_r, indata)
