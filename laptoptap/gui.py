import sys
import time
import numpy as np
from PyQt6.QtCore import Qt, QTimer, pyqtSignal, QObject
from PyQt6.QtGui import QPainter, QColor, QPen, QBrush, QFont, QIcon, QAction
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QLabel, QSlider, QComboBox, QCheckBox, QPushButton, QFrame,
    QSystemTrayIcon, QMenu, QStackedWidget, QGridLayout, QScrollArea
)

from config_manager import ConfigManager
from audio_engine import AudioEngine
from tap_detector import TapDetector, DetectedTapGesture
from action_executor import ActionExecutor

ACTION_LABELS = {
    "copy": "📋 Copy (Ctrl + C)",
    "paste": "📄 Paste (Ctrl + V)",
    "undo": "↩ Undo (Ctrl + Z)",
    "redo": "↪ Redo (Ctrl + Y)",
    "select_all": "📑 Select All (Ctrl + A)",
    "screenshot": "📸 Screenshot (Win + Shift + S)",
    "show_desktop": "🖥 Show / Hide Desktop (Win + D)",
    "task_view": "🗂 Task View (Win + Tab)",
    "switch_window": "🔄 Switch Window (Alt + Tab)",
    "close_window": "❌ Close Window (Alt + F4)",
    "lock": "🔒 Lock PC (Win + L)",
    "play_pause": "🎵 Play / Pause Media",
    "next_track": "⏭ Next Track",
    "prev_track": "⏮ Previous Track",
    "mute": "🔇 Toggle Mute",
    "volume_up": "🔊 Volume Up",
    "volume_down": "🔉 Volume Down",
    "open_calculator": "🔢 Open Calculator",
    "open_notepad": "📝 Open Notepad",
    "open_browser": "🌐 Open Browser",
    "open_terminal": "💻 Open Terminal",
    "none": "🚫 Do Nothing"
}

VOICE_COMMAND_DESCRIPTIONS = [
    ("Copy / Copy That", "📋 Copy to Clipboard (Ctrl + C)"),
    ("Paste / Paste That", "📄 Paste from Clipboard (Ctrl + V)"),
    ("Undo / Undo That", "↩ Undo previous action (Ctrl + Z)"),
    ("Redo", "↪ Redo reverted action (Ctrl + Y)"),
    ("Select All", "📑 Select entire text/items (Ctrl + A)"),
    ("Screenshot / Take Screenshot", "📸 Snip & Sketch (Win + Shift + S)"),
    ("Desktop / Show Desktop", "🖥 Minimize to Desktop (Win + D)"),
    ("Close Window / Close App", "❌ Close active application (Alt + F4)"),
    ("Lock PC / Lock Screen", "🔒 Securely lock computer (Win + L)"),
    ("Play / Pause Music", "🎵 Media Play or Pause toggle"),
    ("Next / Next Track", "⏭ Skip to next media track"),
    ("Previous / Previous Track", "⏮ Go back to previous media track"),
    ("Mute / Mute Sound", "🔇 Mute system audio"),
    ("Volume Up / Turn Up", "🔊 Increase system volume"),
    ("Volume Down / Turn Down", "🔉 Decrease system volume"),
    ("Calculator", "🔢 Launch Windows Calculator"),
    ("Notepad", "📝 Launch Windows Notepad"),
    ("Browser", "🌐 Open Default Internet Browser"),
    ("Terminal", "💻 Open Command Prompt / Terminal")
]


def make_card(title=None, title_color="#00f0ff"):
    """Creates a modern dark frameless card container avoiding Windows QGroupBox white artifacts."""
    frame = QFrame()
    frame.setStyleSheet("""
        QFrame {
            background-color: #121520;
            border: 1px solid #1f2537;
            border-radius: 8px;
        }
    """)
    layout = QVBoxLayout(frame)
    layout.setContentsMargins(10, 9, 10, 9)
    layout.setSpacing(6)
    if title:
        lbl = QLabel(title)
        lbl.setStyleSheet(f"color: {title_color}; font-weight: 700; font-size: 11px; background: transparent; border: none;")
        layout.addWidget(lbl)
    return frame, layout


class WaveformWidget(QWidget):
    """Compact oscilloscope showing chassis vibration, trigger threshold, and VU level bar."""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setMinimumHeight(75)
        self.setMaximumHeight(85)
        self.history = np.zeros(512, dtype=np.float32)
        self.current_peak = 0.0
        self.threshold = 0.05
        self.flash_alpha = 0.0

    def update_data(self, history, current_peak, threshold):
        if len(history) >= 512:
            self.history = history[-512:]
        else:
            self.history = history
        self.current_peak = current_peak
        self.threshold = threshold
        if self.flash_alpha > 0:
            self.flash_alpha = max(0.0, self.flash_alpha - 0.08)
        self.update()

    def flash(self):
        self.flash_alpha = 1.0
        self.update()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        
        w = self.width()
        h = self.height()
        
        vu_w = 10
        vu_margin = 6
        wave_w = w - vu_w - vu_margin * 2
        mid_y = h / 2.0
        
        # Deep dark background
        painter.fillRect(0, 0, w, h, QColor(10, 12, 18))
        
        # Grid line
        grid_pen = QPen(QColor(28, 34, 48), 1, Qt.PenStyle.DashLine)
        painter.setPen(grid_pen)
        painter.drawLine(0, int(mid_y), int(wave_w), int(mid_y))
        
        # Flash overlay on tap
        if self.flash_alpha > 0:
            flash_color = QColor(0, 240, 255, int(self.flash_alpha * 50))
            painter.fillRect(0, 0, int(wave_w), h, flash_color)
            
        # Threshold lines (Top & Bottom)
        scale = (mid_y - 8)
        thresh_y_top = mid_y - min(scale, self.threshold * scale * 3.5)
        thresh_y_bot = mid_y + min(scale, self.threshold * scale * 3.5)
        
        thresh_pen = QPen(QColor(255, 171, 0, 180), 1, Qt.PenStyle.DotLine)
        painter.setPen(thresh_pen)
        painter.drawLine(0, int(thresh_y_top), int(wave_w), int(thresh_y_top))
        painter.drawLine(0, int(thresh_y_bot), int(wave_w), int(thresh_y_bot))
        
        # Waveform line
        if len(self.history) > 1:
            wave_color = QColor(0, 240, 255) if self.current_peak < self.threshold else QColor(255, 64, 129)
            wave_pen = QPen(wave_color, 2)
            painter.setPen(wave_pen)
            
            pts = []
            n = len(self.history)
            dx = wave_w / float(n - 1)
            
            for i in range(n):
                val = float(self.history[i])
                y = mid_y - (val * scale * 3.5)
                y = max(3.0, min(h - 3.0, y))
                pts.append((i * dx, y))
                
            for i in range(len(pts) - 1):
                painter.drawLine(int(pts[i][0]), int(pts[i][1]), int(pts[i+1][0]), int(pts[i+1][1]))
                
        # VU Level Meter on the right
        vu_x = wave_w + vu_margin
        vu_h = h - 12
        vu_y = 6
        painter.fillRect(int(vu_x), int(vu_y), int(vu_w), int(vu_h), QColor(20, 24, 34))
        
        norm_peak = min(1.0, max(0.0, self.current_peak * 3.5))
        level_h = int(norm_peak * vu_h)
        if level_h > 0:
            bar_color = QColor(0, 230, 118) if self.current_peak < self.threshold else QColor(255, 23, 68)
            painter.fillRect(int(vu_x), int(vu_y + vu_h - level_h), int(vu_w), level_h, bar_color)
            
        painter.setPen(QPen(QColor(38, 46, 64), 1))
        painter.setBrush(Qt.BrushStyle.NoBrush)
        painter.drawRect(int(vu_x), int(vu_y), int(vu_w), int(vu_h))
        
        # Outer border
        painter.setPen(QPen(QColor(30, 36, 50), 1))
        painter.drawRect(0, 0, w - 1, h - 1)


class SignalBridge(QObject):
    gesture_signal = pyqtSignal(object)
    level_signal = pyqtSignal(float, float)
    voice_signal = pyqtSignal(str, float, str)


class MainWindow(QMainWindow):
    def __init__(self, config_manager, audio_engine, tap_detector, action_executor, voice_detector=None):
        super().__init__()
        self.config = config_manager
        self.audio_engine = audio_engine
        self.tap_detector = tap_detector
        self.executor = action_executor
        self.voice_detector = voice_detector
        
        self.bridge = SignalBridge()
        self.bridge.gesture_signal.connect(self.on_gesture_received)
        self.bridge.level_signal.connect(self.on_level_received)
        self.bridge.voice_signal.connect(self.on_voice_received)
        
        self.tap_detector.on_gesture_detected = lambda g: self.bridge.gesture_signal.emit(g)
        self.tap_detector.on_level_update = lambda p, t: self.bridge.level_signal.emit(p, t)
        if self.voice_detector:
            self.voice_detector.on_voice_command = lambda cmd, conf, txt=None: self.bridge.voice_signal.emit(cmd, conf, txt or cmd)
        
        self.current_peak = 0.0
        self.current_threshold = 0.05
        self.is_monitoring_paused = False
        
        self.init_ui()
        self.init_tray()
        
        initial_mode = self.config.get("active_mode", "knock")
        self.switch_mode(initial_mode)
        
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.refresh_display)
        self.timer.start(28)

    def init_ui(self):
        self.setWindowTitle("LaptopTap — Chassis Knock & Voice Shortcuts")
        self.resize(520, 640)
        self.setMinimumSize(460, 480)
        self.setStyleSheet("""
            QMainWindow {
                background-color: #0b0d13;
            }
            QWidget {
                color: #e2e8f0;
                font-family: 'Segoe UI Variable Display', 'Segoe UI', sans-serif;
            }
            QComboBox {
                background-color: #171b26;
                border: 1px solid #293044;
                border-radius: 5px;
                padding: 4px 8px;
                color: #ffffff;
                font-size: 11px;
            }
            QComboBox:hover {
                border: 1px solid #00f0ff;
                background-color: #1c2230;
            }
            QComboBox QAbstractItemView {
                background-color: #121520;
                border: 1px solid #293044;
                selection-background-color: #00f0ff;
                selection-color: #0b0d13;
                color: #ffffff;
                padding: 4px;
            }
            QSlider::groove:horizontal {
                border: none;
                height: 5px;
                background: #1c2230;
                border-radius: 2px;
            }
            QSlider::sub-page:horizontal {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #8b5cf6, stop:1 #00f0ff);
                border-radius: 2px;
            }
            QSlider::handle:horizontal {
                background: #ffffff;
                border: 2px solid #00f0ff;
                width: 14px;
                margin-top: -5px;
                margin-bottom: -5px;
                border-radius: 7px;
            }
            QCheckBox {
                spacing: 6px;
                font-size: 11px;
                color: #cbd5e1;
                background: transparent;
            }
            QCheckBox::indicator {
                width: 15px;
                height: 15px;
                border-radius: 3px;
                border: 1px solid #2f384c;
                background-color: #141722;
            }
            QCheckBox::indicator:checked {
                background-color: #00f0ff;
                border-color: #00f0ff;
            }
            QPushButton {
                background-color: #151824;
                border: 1px solid #262d3e;
                border-radius: 6px;
                padding: 6px 12px;
                font-size: 11px;
                font-weight: 600;
                color: #ffffff;
            }
            QPushButton:hover {
                background-color: #1e2434;
                border: 1px solid #00f0ff;
            }
            QPushButton:pressed {
                background-color: #0d0f16;
            }
        """)

        central = QWidget(self)
        self.setCentralWidget(central)
        main_layout = QVBoxLayout(central)
        main_layout.setContentsMargins(14, 12, 14, 12)
        main_layout.setSpacing(7)

        # 1. Header Bar (Fixed)
        header_layout = QHBoxLayout()
        title_box = QVBoxLayout()
        title_box.setSpacing(1)
        title_label = QLabel("⚡ LaptopTap")
        title_label.setStyleSheet("font-size: 18px; font-weight: 800; color: #ffffff;")
        title_sub = QLabel("Chassis Knock & Voice Shortcut System")
        title_sub.setStyleSheet("font-size: 10px; color: #64748b; font-weight: 500;")
        title_box.addWidget(title_label)
        title_box.addWidget(title_sub)
        header_layout.addLayout(title_box)
        
        self.status_badge = QLabel("● Knock Mode Active")
        self.status_badge.setStyleSheet("font-size: 10px; font-weight: bold; color: #00f0ff; background-color: #0c2b32; padding: 4px 10px; border-radius: 10px; border: 1px solid #00f0ff;")
        header_layout.addStretch()
        header_layout.addWidget(self.status_badge)
        main_layout.addLayout(header_layout)

        # 2. Segmented Mode Switcher (Fixed)
        mode_container = QFrame()
        mode_container.setStyleSheet("""
            QFrame {
                background-color: #121520;
                border: 1px solid #1f2537;
                border-radius: 8px;
                padding: 2px;
            }
        """)
        mode_layout = QHBoxLayout(mode_container)
        mode_layout.setContentsMargins(2, 2, 2, 2)
        mode_layout.setSpacing(4)

        self.btn_mode_knock = QPushButton("⚡ Chassis Knock Mode")
        self.btn_mode_knock.setCheckable(True)
        self.btn_mode_knock.setChecked(True)
        self.btn_mode_knock.clicked.connect(lambda: self.switch_mode("knock"))
        
        self.btn_mode_voice = QPushButton("🎙️ Voice Control Mode")
        self.btn_mode_voice.setCheckable(True)
        self.btn_mode_voice.setChecked(False)
        self.btn_mode_voice.clicked.connect(lambda: self.switch_mode("voice"))

        mode_layout.addWidget(self.btn_mode_knock, 1)
        mode_layout.addWidget(self.btn_mode_voice, 1)
        main_layout.addWidget(mode_container)

        # 3. Dynamic Event Trigger Banner (Fixed)
        self.event_badge = QLabel("Ready. Knock on chassis or switch to Voice Mode.")
        self.event_badge.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.event_badge.setStyleSheet("""
            background-color: #121522;
            border: 1px dashed #242c3e;
            border-radius: 6px;
            padding: 6px;
            font-size: 11px;
            font-weight: 600;
            color: #94a3b8;
        """)
        main_layout.addWidget(self.event_badge)

        # 4. Scrollable Middle Area (With NO horizontal scrollbar and sleek dark vertical bar)
        scroll_area = QScrollArea()
        scroll_area.setWidgetResizable(True)
        scroll_area.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        scroll_area.setFrameShape(QFrame.Shape.NoFrame)
        scroll_area.setStyleSheet("""
            QScrollArea {
                background: transparent;
                border: none;
            }
            QScrollBar:vertical {
                background: #0f121a;
                width: 6px;
                border-radius: 3px;
                margin: 0px;
            }
            QScrollBar::handle:vertical {
                background: #2b3348;
                border-radius: 3px;
                min-height: 25px;
            }
            QScrollBar::handle:vertical:hover {
                background: #00f0ff;
            }
            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {
                height: 0px;
            }
        """)

        scroll_content = QWidget()
        scroll_content.setStyleSheet("background: transparent;")
        scroll_content_layout = QVBoxLayout(scroll_content)
        scroll_content_layout.setContentsMargins(0, 2, 4, 2)
        scroll_content_layout.setSpacing(7)

        # Stacked Widget (Knock Panel vs Voice Panel)
        self.stacked_widget = QStackedWidget()
        self.stacked_widget.setStyleSheet("background: transparent;")

        # ====== PANEL 1: KNOCK MODE ======
        self.panel_knock = QWidget()
        self.panel_knock.setStyleSheet("background: transparent;")
        knock_layout = QVBoxLayout(self.panel_knock)
        knock_layout.setContentsMargins(0, 0, 0, 0)
        knock_layout.setSpacing(7)

        # Card 1: Oscilloscope
        card_osc, osc_vbox = make_card("Live Mechanical Vibration (Real-Time DSP)", "#00f0ff")
        self.waveform_widget = WaveformWidget(self)
        osc_vbox.addWidget(self.waveform_widget)
        knock_layout.addWidget(card_osc)

        # Card 2: Hardware & Sensitivity
        card_hw, hw_layout = make_card("Hardware & Shock Sensitivity", "#00f0ff")
        
        mic_row = QHBoxLayout()
        mic_lbl = QLabel("Microphone:")
        mic_lbl.setStyleSheet("color: #94a3b8; font-size: 11px; background: transparent;")
        self.combo_mic = QComboBox()
        self._populate_audio_devices()
        self.combo_mic.currentIndexChanged.connect(self.on_device_changed)
        mic_row.addWidget(mic_lbl)
        mic_row.addWidget(self.combo_mic, 1)
        hw_layout.addLayout(mic_row)

        sens_row = QHBoxLayout()
        sens_label = QLabel("Shock Sensitivity:")
        sens_label.setStyleSheet("color: #e2e8f0; font-size: 11px; background: transparent;")
        self.sens_val_label = QLabel(f"{int(self.config.get('sensitivity', 0.90) * 100)}%")
        self.sens_val_label.setStyleSheet("color: #00f0ff; font-weight: bold; font-size: 11px; background: transparent;")
        sens_row.addWidget(sens_label)
        sens_row.addStretch()
        sens_row.addWidget(self.sens_val_label)
        hw_layout.addLayout(sens_row)

        self.sens_slider = QSlider(Qt.Orientation.Horizontal)
        self.sens_slider.setRange(10, 100)
        self.sens_slider.setValue(int(self.config.get("sensitivity", 0.90) * 100))
        self.sens_slider.valueChanged.connect(self.on_sensitivity_changed)
        hw_layout.addWidget(self.sens_slider)
        knock_layout.addWidget(card_hw)

        # Card 3: Tap Shortcuts
        card_actions, actions_grid = make_card("Chassis Knock Shortcuts", "#00f0ff")
        grid = QGridLayout()
        grid.setSpacing(6)

        lbl_1 = QLabel("Single Knock (1×):")
        lbl_1.setStyleSheet("color: #cbd5e1; font-size: 11px; background: transparent;")
        self.combo_1 = QComboBox()
        self._populate_actions(self.combo_1, self.config.get("actions", {}).get("single_tap", "copy"))
        self.combo_1.currentTextChanged.connect(lambda txt: self._save_action("single_tap", self.combo_1))
        grid.addWidget(lbl_1, 0, 0)
        grid.addWidget(self.combo_1, 0, 1)

        lbl_2 = QLabel("Double Knock (2×):")
        lbl_2.setStyleSheet("color: #cbd5e1; font-size: 11px; background: transparent;")
        self.combo_2 = QComboBox()
        self._populate_actions(self.combo_2, self.config.get("actions", {}).get("double_tap", "paste"))
        self.combo_2.currentTextChanged.connect(lambda txt: self._save_action("double_tap", self.combo_2))
        grid.addWidget(lbl_2, 1, 0)
        grid.addWidget(self.combo_2, 1, 1)

        lbl_3 = QLabel("Triple Knock (3×):")
        lbl_3.setStyleSheet("color: #cbd5e1; font-size: 11px; background: transparent;")
        self.combo_3 = QComboBox()
        self._populate_actions(self.combo_3, self.config.get("actions", {}).get("triple_tap", "none"))
        self.combo_3.currentTextChanged.connect(lambda txt: self._save_action("triple_tap", self.combo_3))
        grid.addWidget(lbl_3, 2, 0)
        grid.addWidget(self.combo_3, 2, 1)
        
        actions_grid.addLayout(grid)
        knock_layout.addWidget(card_actions)

        self.stacked_widget.addWidget(self.panel_knock)

        # ====== PANEL 2: VOICE MODE ======
        self.panel_voice = QWidget()
        self.panel_voice.setStyleSheet("background: transparent;")
        voice_layout = QVBoxLayout(self.panel_voice)
        voice_layout.setContentsMargins(0, 0, 0, 0)
        voice_layout.setSpacing(7)

        card_voice, vs_vbox = make_card("Voice Control Engine (100% Offline & Native)", "#c084fc")
        
        voice_desc = QLabel("🎙️ Speak command naturally into microphone. Knock detection is muted in this mode.")
        voice_desc.setStyleSheet("font-size: 11px; color: #cbd5e1; background: transparent;")
        voice_desc.setWordWrap(True)
        vs_vbox.addWidget(voice_desc)

        # Voice Confidence Threshold Slider
        v_sens_row = QHBoxLayout()
        v_sens_lbl = QLabel("Voice Confidence Threshold:")
        v_sens_lbl.setStyleSheet("color: #e2e8f0; font-size: 11px; background: transparent;")
        conf_val = self.config.get("voice_confidence_threshold", 0.60)
        self.voice_sens_val_label = QLabel(f"{int(conf_val * 100)}%")
        self.voice_sens_val_label.setStyleSheet("color: #c084fc; font-weight: bold; font-size: 11px; background: transparent;")
        v_sens_row.addWidget(v_sens_lbl)
        v_sens_row.addStretch()
        v_sens_row.addWidget(self.voice_sens_val_label)
        vs_vbox.addLayout(v_sens_row)

        self.voice_sens_slider = QSlider(Qt.Orientation.Horizontal)
        self.voice_sens_slider.setRange(30, 85)
        self.voice_sens_slider.setValue(int(conf_val * 100))
        self.voice_sens_slider.setStyleSheet("""
            QSlider::groove:horizontal {
                height: 6px;
                background: #1e2436;
                border-radius: 3px;
            }
            QSlider::sub-page:horizontal {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #818cf8, stop:1 #c084fc);
                border-radius: 3px;
            }
            QSlider::handle:horizontal {
                background: #ffffff;
                border: 2px solid #c084fc;
                width: 14px;
                margin-top: -4px;
                margin-bottom: -4px;
                border-radius: 7px;
            }
        """)
        self.voice_sens_slider.valueChanged.connect(self.on_voice_sensitivity_changed)
        vs_vbox.addWidget(self.voice_sens_slider)

        # Scroll area for voice commands list
        v_scroll = QScrollArea()
        v_scroll.setWidgetResizable(True)
        v_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        v_scroll.setStyleSheet("""
            QScrollArea { border: 1px solid #1e2436; border-radius: 6px; background-color: #0d0f16; }
            QScrollBar:vertical { background: #10121a; width: 5px; border-radius: 2px; }
            QScrollBar::handle:vertical { background: #3b4562; border-radius: 2px; }
        """)
        v_scroll_content = QWidget()
        v_scroll_content.setStyleSheet("background: transparent;")
        v_scroll_layout = QVBoxLayout(v_scroll_content)
        v_scroll_layout.setContentsMargins(4, 4, 4, 4)
        v_scroll_layout.setSpacing(4)

        for phrase, desc in VOICE_COMMAND_DESCRIPTIONS:
            row = QHBoxLayout()
            lbl_phrase = QLabel(f"🗣️ \"{phrase}\"")
            lbl_phrase.setStyleSheet("font-weight: 700; color: #c084fc; font-size: 10px; background: transparent;")
            lbl_action = QLabel(f"➔  {desc}")
            lbl_action.setStyleSheet("color: #94a3b8; font-size: 10px; background: transparent;")
            row.addWidget(lbl_phrase)
            row.addStretch()
            row.addWidget(lbl_action)
            
            line_frame = QFrame()
            line_frame.setStyleSheet("background-color: #141722; border-radius: 4px; padding: 2px 6px; border: none;")
            line_frame.setLayout(row)
            v_scroll_layout.addWidget(line_frame)

        v_scroll.setWidget(v_scroll_content)
        v_scroll.setFixedHeight(130)
        vs_vbox.addWidget(v_scroll)
        voice_layout.addWidget(card_voice)

        self.stacked_widget.addWidget(self.panel_voice)
        scroll_content_layout.addWidget(self.stacked_widget)

        # Card 4: Preferences & Settings (Shared)
        card_opts, opts_vbox = make_card("System Preferences & Safety", "#00f0ff")
        opts_layout = QGridLayout()
        opts_layout.setSpacing(6)

        self.chk_typing = QCheckBox("Ignore knocks while typing")
        self.chk_typing.setChecked(self.config.get("suppress_typing", True))
        self.chk_typing.toggled.connect(lambda val: self.config.set("suppress_typing", val))
        
        self.chk_sides = QCheckBox("Distinguish Left vs Right chassis")
        self.chk_sides.setChecked(self.config.get("detect_sides", True))
        self.chk_sides.toggled.connect(lambda val: self.config.set("detect_sides", val))

        self.chk_feedback = QCheckBox("Audio click sound on trigger")
        self.chk_feedback.setChecked(self.config.get("enable_sound_feedback", True))
        self.chk_feedback.toggled.connect(lambda val: self.config.set("enable_sound_feedback", val))

        self.chk_notif = QCheckBox("Desktop notifications")
        self.chk_notif.setChecked(self.config.get("enable_notifications", True))
        self.chk_notif.toggled.connect(lambda val: self.config.set("enable_notifications", val))

        self.chk_autostart = QCheckBox("Start automatically with Windows")
        self.chk_autostart.setChecked(self.config.get("start_with_windows", False))
        self.chk_autostart.toggled.connect(lambda val: self.config.set("start_with_windows", val))

        opts_layout.addWidget(self.chk_typing, 0, 0)
        opts_layout.addWidget(self.chk_sides, 0, 1)
        opts_layout.addWidget(self.chk_feedback, 1, 0)
        opts_layout.addWidget(self.chk_notif, 1, 1)
        opts_layout.addWidget(self.chk_autostart, 2, 0, 1, 2)
        opts_vbox.addLayout(opts_layout)
        scroll_content_layout.addWidget(card_opts)

        scroll_area.setWidget(scroll_content)
        main_layout.addWidget(scroll_area, 1)

        # 5. Footer Controls Bar (ALWAYS visible at the very bottom!)
        footer_layout = QHBoxLayout()
        footer_layout.setContentsMargins(0, 3, 0, 0)
        footer_layout.setSpacing(8)

        self.btn_calibrate = QPushButton("🎯 Calibrate Taps")
        self.btn_calibrate.setStyleSheet("""
            QPushButton { background-color: #1e1b4b; border: 1px solid #6366f1; color: #c7d2fe; font-weight: bold; }
            QPushButton:hover { background-color: #312e81; border: 1px solid #818cf8; }
        """)
        self.btn_calibrate.clicked.connect(self.run_active_calibration)

        self.btn_toggle = QPushButton("Pause")
        self.btn_toggle.clicked.connect(self.toggle_monitoring)
        
        self.btn_minimize = QPushButton("Hide to Tray")
        self.btn_minimize.setStyleSheet("""
            QPushButton { background-color: #00f0ff; color: #0b0d13; font-weight: bold; border: none; }
            QPushButton:hover { background-color: #38bdf8; }
        """)
        self.btn_minimize.clicked.connect(self.hide)
        
        footer_layout.addWidget(self.btn_calibrate, 1)
        footer_layout.addWidget(self.btn_toggle, 1)
        footer_layout.addWidget(self.btn_minimize, 1)
        main_layout.addLayout(footer_layout)

    def switch_mode(self, mode: str):
        self.config.set("active_mode", mode)
        
        if mode == "knock":
            self.btn_mode_knock.setChecked(True)
            self.btn_mode_voice.setChecked(False)
            self.btn_mode_knock.setStyleSheet("""
                QPushButton {
                    background-color: #00f0ff;
                    color: #0b0d13;
                    border: none;
                    font-weight: 700;
                    border-radius: 6px;
                }
            """)
            self.btn_mode_voice.setStyleSheet("""
                QPushButton {
                    background-color: transparent;
                    color: #94a3b8;
                    border: none;
                    font-weight: 600;
                }
                QPushButton:hover { color: #ffffff; }
            """)
            
            self.stacked_widget.setCurrentWidget(self.panel_knock)
            self.status_badge.setText("● Knock Mode Active")
            self.status_badge.setStyleSheet("font-size: 10px; font-weight: bold; color: #00f0ff; background-color: #0c2b32; padding: 4px 10px; border-radius: 10px; border: 1px solid #00f0ff;")
            self.btn_calibrate.setText("🎯 Calibrate Taps")
            self.btn_calibrate.setStyleSheet("""
                QPushButton { background-color: #1e1b4b; border: 1px solid #6366f1; color: #c7d2fe; font-weight: bold; }
                QPushButton:hover { background-color: #312e81; border: 1px solid #818cf8; }
            """)
            self.event_badge.setText("Knock 1, 2, or 3 times on the laptop body to trigger shortcuts...")
            
            if self.voice_detector and self.voice_detector.is_running:
                self.voice_detector.stop()
            if not self.is_monitoring_paused and not self.audio_engine.is_running:
                self.audio_engine.start()
                
        elif mode == "voice":
            self.btn_mode_voice.setChecked(True)
            self.btn_mode_knock.setChecked(False)
            self.btn_mode_voice.setStyleSheet("""
                QPushButton {
                    background-color: #a855f7;
                    color: #ffffff;
                    border: none;
                    font-weight: 700;
                    border-radius: 6px;
                }
            """)
            self.btn_mode_knock.setStyleSheet("""
                QPushButton {
                    background-color: transparent;
                    color: #94a3b8;
                    border: none;
                    font-weight: 600;
                }
                QPushButton:hover { color: #ffffff; }
            """)
            
            self.stacked_widget.setCurrentWidget(self.panel_voice)
            self.status_badge.setText("● Voice Mode Active")
            self.status_badge.setStyleSheet("font-size: 10px; font-weight: bold; color: #c084fc; background-color: #261238; padding: 4px 10px; border-radius: 10px; border: 1px solid #a855f7;")
            self.btn_calibrate.setText("🎙️ Calibrate Voice")
            self.btn_calibrate.setStyleSheet("""
                QPushButton { background-color: #2e1065; border: 1px solid #a855f7; color: #e9d5ff; font-weight: bold; }
                QPushButton:hover { background-color: #3b0764; border: 1px solid #c084fc; }
            """)
            self.event_badge.setText("Listening for English voice commands... (Say 'Copy', 'Paste', 'Screenshot')")
            
            if self.audio_engine.is_running:
                self.audio_engine.stop()
            if not self.is_monitoring_paused and self.voice_detector and not self.voice_detector.is_running:
                self.voice_detector.start()

    def _populate_audio_devices(self):
        self.combo_mic.clear()
        devices = AudioEngine.get_input_devices()
        cur_dev = self.config.get("selected_input_device")
        for dev in devices:
            self.combo_mic.addItem(f"{dev['name']} (#{dev['index']})", dev['index'])
        if cur_dev is not None:
            idx = self.combo_mic.findData(cur_dev)
            if idx >= 0:
                self.combo_mic.setCurrentIndex(idx)

    def on_device_changed(self, idx):
        if idx < 0:
            return
        dev_idx = self.combo_mic.itemData(idx)
        self.config.set("selected_input_device", dev_idx)
        self.audio_engine.change_device(dev_idx)

    def _populate_actions(self, combo, current_key):
        combo.clear()
        for key, label in ACTION_LABELS.items():
            combo.addItem(label, key)
        idx = combo.findData(current_key)
        if idx >= 0:
            combo.setCurrentIndex(idx)

    def _save_action(self, tap_key, combo):
        act = combo.currentData()
        actions = self.config.get("actions", {})
        actions[tap_key] = act
        self.config.set("actions", actions)

    def on_sensitivity_changed(self, val):
        sens = val / 100.0
        self.sens_val_label.setText(f"{val}%")
        self.config.set("sensitivity", sens)

    def on_voice_sensitivity_changed(self, val):
        thresh = round(val / 100.0, 2)
        self.voice_sens_val_label.setText(f"{val}%")
        self.config.set("voice_confidence_threshold", thresh)
        if self.voice_detector and self.voice_detector.is_running:
            self.voice_detector.stop()
            self.voice_detector.start()

    def init_tray(self):
        self.tray_icon = QSystemTrayIcon(self)
        
        from PyQt6.QtGui import QPixmap
        pixmap = QPixmap(32, 32)
        pixmap.fill(Qt.GlobalColor.transparent)
        p = QPainter(pixmap)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        p.setBrush(QBrush(QColor(0, 240, 255)))
        p.setPen(Qt.PenStyle.NoPen)
        p.drawEllipse(4, 4, 24, 24)
        p.end()
        icon = QIcon(pixmap)
        
        self.tray_icon.setIcon(icon)
        self.tray_icon.setToolTip("LaptopTap — Chassis Knock & Voice Shortcuts")
        
        tray_menu = QMenu()
        act_show = QAction("Open Dashboard", self)
        act_show.triggered.connect(self.show_normal_and_raise)
        tray_menu.addAction(act_show)
        
        act_pause = QAction("Pause / Resume", self)
        act_pause.triggered.connect(self.toggle_monitoring)
        tray_menu.addAction(act_pause)
        
        tray_menu.addSeparator()
        act_quit = QAction("Exit", self)
        act_quit.triggered.connect(self.clean_quit)
        tray_menu.addAction(act_quit)
        
        self.tray_icon.setContextMenu(tray_menu)
        self.tray_icon.activated.connect(self.on_tray_activated)
        self.tray_icon.show()

    def show_normal_and_raise(self):
        self.show()
        self.setWindowState(self.windowState() & ~Qt.WindowState.WindowMinimized | Qt.WindowState.WindowActive)
        self.raise_()
        self.activateWindow()

    def on_tray_activated(self, reason):
        if reason == QSystemTrayIcon.ActivationReason.Trigger:
            if self.isVisible():
                self.hide()
            else:
                self.show_normal_and_raise()

    def toggle_monitoring(self):
        self.is_monitoring_paused = not self.is_monitoring_paused
        mode = self.config.get("active_mode", "knock")
        
        if self.is_monitoring_paused:
            if self.audio_engine.is_running:
                self.audio_engine.stop()
            if self.voice_detector and self.voice_detector.is_running:
                self.voice_detector.stop()
            self.status_badge.setText("⏸ Monitoring Paused")
            self.status_badge.setStyleSheet("font-size: 10px; font-weight: bold; color: #ffab00; background-color: #2b2210; padding: 4px 10px; border-radius: 10px; border: 1px solid #ffab00;")
            self.btn_toggle.setText("Resume")
        else:
            self.btn_toggle.setText("Pause")
            self.switch_mode(mode)

    def on_level_received(self, peak, threshold):
        self.current_peak = peak
        self.current_threshold = threshold

    def refresh_display(self):
        if self.config.get("active_mode", "knock") == "knock":
            history = self.audio_engine.waveform_history
            self.waveform_widget.update_data(history, self.current_peak, self.current_threshold)

    def on_gesture_received(self, gesture: DetectedTapGesture):
        if self.config.get("active_mode", "knock") != "knock":
            return
            
        self.waveform_widget.flash()
        
        actions = self.config.get("actions", {})
        action_name = None
        
        if gesture.count == 2 and gesture.side in ("left", "right"):
            key = f"{gesture.side}_double_tap"
            action_name = actions.get(key)
            
        if not action_name:
            if gesture.count == 1:
                action_name = actions.get("single_tap", "copy")
            elif gesture.count == 2:
                action_name = actions.get("double_tap", "paste")
            elif gesture.count >= 3:
                action_name = actions.get("triple_tap", "none")
                
        action_title = ACTION_LABELS.get(action_name, action_name)
        side_text = f" ({gesture.side.capitalize()} side)" if gesture.side != "center" else ""
        text = f"⚡ {gesture.count}× Knock{side_text} ➔ {action_title}"
        
        self.event_badge.setText(text)
        self.event_badge.setStyleSheet("""
            background-color: #0b2f3a;
            border: 1px solid #00f0ff;
            border-radius: 6px;
            padding: 6px;
            font-size: 11px;
            font-weight: bold;
            color: #00f0ff;
        """)
        
        if self.config.get("enable_notifications", True) and not self.isVisible():
            self.tray_icon.showMessage("LaptopTap Knock", text, QSystemTrayIcon.MessageIcon.Information, 1200)

        if action_name and action_name != "none":
            self.executor.trigger(action_name)

    def on_voice_received(self, word: str, confidence: float, spoken_text: str = ""):
        if self.config.get("active_mode", "knock") != "voice":
            return
            
        voice_actions = self.config.get("voice_actions", {})
        action_name = voice_actions.get(word.lower(), word.lower())
            
        action_title = ACTION_LABELS.get(action_name, action_name)
        display_text = spoken_text if spoken_text else word
        text = f"🎙️ Spoken: \"{display_text.upper()}\" ({int(confidence*100)}%) ➔ {action_title}"
        
        self.event_badge.setText(text)
        self.event_badge.setStyleSheet("""
            background-color: #2b123d;
            border: 1px solid #a855f7;
            border-radius: 6px;
            padding: 6px;
            font-size: 11px;
            font-weight: bold;
            color: #f3e8ff;
        """)
        
        if self.config.get("enable_notifications", True) and not self.isVisible():
            self.tray_icon.showMessage("LaptopTap Voice", text, QSystemTrayIcon.MessageIcon.Information, 1200)

        if action_name and action_name != "none":
            self.executor.trigger(action_name)

    def run_active_calibration(self):
        mode = self.config.get("active_mode", "knock")
        if mode == "knock":
            self.run_tap_calibration()
        else:
            self.run_voice_calibration()

    def run_tap_calibration(self):
        import subprocess
        from pathlib import Path
        if self.audio_engine and self.audio_engine.is_running:
            self.audio_engine.stop()
        cal_bat = Path(__file__).parent / "calibrate.bat"
        if cal_bat.exists():
            subprocess.Popen(f'cmd.exe /c start "" "{cal_bat}"', shell=True)
        else:
            subprocess.Popen('cmd.exe /c start cmd /k py calibrate.py', shell=True, cwd=str(Path(__file__).parent))

    def run_voice_calibration(self):
        import subprocess
        from pathlib import Path
        if self.voice_detector and self.voice_detector.is_running:
            self.voice_detector.stop()
        cal_bat = Path(__file__).parent / "voice_calibrate.bat"
        if cal_bat.exists():
            subprocess.Popen(f'cmd.exe /c start "" "{cal_bat}"', shell=True)
        else:
            subprocess.Popen('cmd.exe /c start cmd /k py voice_calibrate.py', shell=True, cwd=str(Path(__file__).parent))

    def changeEvent(self, event):
        super().changeEvent(event)
        from PyQt6.QtCore import QEvent
        if event.type() == QEvent.Type.ActivationChange and self.isActiveWindow():
            new_conf = self.config.get("voice_confidence_threshold", 0.60)
            if hasattr(self, 'voice_sens_slider'):
                self.voice_sens_slider.blockSignals(True)
                self.voice_sens_slider.setValue(int(new_conf * 100))
                self.voice_sens_val_label.setText(f"{int(new_conf * 100)}%")
                self.voice_sens_slider.blockSignals(False)
            mode = self.config.get("active_mode", "knock")
            if not self.is_monitoring_paused:
                if mode == "voice" and self.voice_detector and not self.voice_detector.is_running:
                    self.voice_detector.start()
                elif mode == "knock" and self.audio_engine and not self.audio_engine.is_running:
                    self.audio_engine.start()

    def closeEvent(self, event):
        if self.tray_icon.isVisible():
            self.hide()
            if self.config.get("enable_notifications", True):
                self.tray_icon.showMessage(
                    "LaptopTap Running in Background",
                    "LaptopTap is active in your system tray.",
                    QSystemTrayIcon.MessageIcon.Information,
                    1500
                )
            event.ignore()
        else:
            self.clean_quit()

    def clean_quit(self):
        self.audio_engine.stop()
        if self.voice_detector:
            self.voice_detector.stop()
        self.tray_icon.hide()
        QApplication.quit()
