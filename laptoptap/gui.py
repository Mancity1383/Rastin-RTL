import sys
import time
import numpy as np
from PyQt6.QtCore import Qt, QTimer, pyqtSignal, QObject
from PyQt6.QtGui import QPainter, QColor, QPen, QBrush, QFont, QIcon, QAction
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QLabel, QSlider, QComboBox, QCheckBox, QPushButton, QFrame,
    QSystemTrayIcon, QMenu, QTabWidget, QGroupBox, QGridLayout
)

from config_manager import ConfigManager
from audio_engine import AudioEngine
from tap_detector import TapDetector, DetectedTapGesture
from action_executor import ActionExecutor

ACTION_LABELS = {
    "play_pause": "🎵 Play / Pause Media",
    "next_track": "⏭ Next Track",
    "prev_track": "⏮ Previous Track",
    "mute": "🔇 Toggle Mute",
    "volume_up": "🔊 Volume Up",
    "volume_down": "🔉 Volume Down",
    "copy": "📋 Copy (Ctrl + C)",
    "paste": "📄 Paste (Ctrl + V)",
    "screenshot": "📸 Screenshot (Win + Shift + S)",
    "lock": "🔒 Lock PC (Win + L)",
    "task_view": "🗂 Task View (Win + Tab)",
    "none": "🚫 Do Nothing"
}

class WaveformWidget(QWidget):
    """Real-time oscilloscope showing chassis mechanical vibration and trigger threshold."""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setMinimumHeight(120)
        self.history = np.zeros(512, dtype=np.float32)
        self.current_peak = 0.0
        self.threshold = 0.05
        self.flash_alpha = 0.0 # Flashes when a tap triggers

    def update_data(self, history, current_peak, threshold):
        # Downsample or take last 512 samples
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
        mid_y = h / 2.0
        
        # Background
        bg_color = QColor(18, 20, 26)
        painter.fillRect(0, 0, w, h, bg_color)
        
        # Grid lines
        grid_pen = QPen(QColor(35, 38, 48), 1, Qt.PenStyle.DashLine)
        painter.setPen(grid_pen)
        painter.drawLine(0, int(mid_y), w, int(mid_y))
        
        # Flash overlay if tap detected
        if self.flash_alpha > 0:
            flash_color = QColor(0, 229, 255, int(self.flash_alpha * 50))
            painter.fillRect(0, 0, w, h, flash_color)
            
        # Draw threshold lines (symmetric top and bottom)
        # Map threshold [0.0, 1.0] to height
        scale = (mid_y - 10)
        thresh_y_top = mid_y - min(scale, self.threshold * scale * 3.5)
        thresh_y_bot = mid_y + min(scale, self.threshold * scale * 3.5)
        
        thresh_pen = QPen(QColor(255, 171, 0, 180), 1, Qt.PenStyle.DotLine)
        painter.setPen(thresh_pen)
        painter.drawLine(0, int(thresh_y_top), w, int(thresh_y_top))
        painter.drawLine(0, int(thresh_y_bot), w, int(thresh_y_bot))
        
        # Draw threshold label
        painter.setPen(QColor(255, 171, 0, 180))
        font = QFont("Segoe UI", 8)
        painter.setFont(font)
        painter.drawText(8, int(thresh_y_top) - 4, f"Threshold: {self.threshold:.3f}")
        
        # Draw waveform
        if len(self.history) > 1:
            wave_color = QColor(0, 229, 255) if self.current_peak < self.threshold else QColor(255, 64, 129)
            wave_pen = QPen(wave_color, 2)
            painter.setPen(wave_pen)
            
            pts = []
            n = len(self.history)
            dx = w / float(n - 1)
            
            for i in range(n):
                val = float(self.history[i])
                y = mid_y - (val * scale * 3.5)
                y = max(4.0, min(h - 4.0, y))
                pts.append((i * dx, y))
                
            for i in range(len(pts) - 1):
                painter.drawLine(int(pts[i][0]), int(pts[i][1]), int(pts[i+1][0]), int(pts[i+1][1]))
                
        # Border
        border_pen = QPen(QColor(48, 54, 68), 1)
        painter.setPen(border_pen)
        painter.setBrush(Qt.BrushStyle.NoBrush)
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
        
        # Attach bridge to detector callbacks
        self.tap_detector.on_gesture_detected = lambda g: self.bridge.gesture_signal.emit(g)
        self.tap_detector.on_level_update = lambda p, t: self.bridge.level_signal.emit(p, t)
        if self.voice_detector:
            self.voice_detector.on_voice_command = lambda cmd, conf, txt=None: self.bridge.voice_signal.emit(cmd, conf, txt or cmd)
        
        self.current_peak = 0.0
        self.current_threshold = 0.05
        
        self.init_ui()
        self.init_tray()
        
        # Start UI refresh timer (35 FPS)
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.refresh_display)
        self.timer.start(28)

    def init_ui(self):
        self.setWindowTitle("LaptopTap — Chassis Knock & Voice Shortcuts")
        self.setFixedSize(580, 750)
        self.setStyleSheet("""
            QMainWindow {
                background-color: #0f1115;
            }
            QWidget {
                color: #e2e8f0;
                font-family: 'Segoe UI', sans-serif;
            }
            QGroupBox {
                background-color: #171920;
                border: 1px solid #282c37;
                border-radius: 8px;
                margin-top: 12px;
                padding-top: 14px;
                font-weight: bold;
                font-size: 13px;
                color: #00e5ff;
            }
            QGroupBox::title {
                subcontrol-origin: margin;
                subcontrol-position: top left;
                padding-left: 8px;
            }
            QComboBox {
                background-color: #1f232b;
                border: 1px solid #363c4a;
                border-radius: 6px;
                padding: 5px 10px;
                color: #ffffff;
                font-size: 12px;
            }
            QComboBox:hover {
                border: 1px solid #00e5ff;
            }
            QSlider::groove:horizontal {
                border: none;
                height: 6px;
                background: #282c37;
                border-radius: 3px;
            }
            QSlider::sub-page:horizontal {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #7c4dff, stop:1 #00e5ff);
                border-radius: 3px;
            }
            QSlider::handle:horizontal {
                background: #ffffff;
                border: 2px solid #00e5ff;
                width: 16px;
                margin-top: -5px;
                margin-bottom: -5px;
                border-radius: 8px;
            }
            QCheckBox {
                spacing: 8px;
                font-size: 12px;
                color: #cbd5e1;
            }
            QCheckBox::indicator {
                width: 18px;
                height: 18px;
                border-radius: 4px;
                border: 1px solid #363c4a;
                background-color: #1f232b;
            }
            QCheckBox::indicator:checked {
                background-color: #00e5ff;
                border-color: #00e5ff;
            }
            QPushButton {
                background-color: #1f232b;
                border: 1px solid #363c4a;
                border-radius: 6px;
                padding: 8px 16px;
                font-size: 12px;
                font-weight: 600;
                color: #ffffff;
            }
            QPushButton:hover {
                background-color: #2b303c;
                border: 1px solid #00e5ff;
            }
            QPushButton:pressed {
                background-color: #14161c;
            }
        """)

        central = QWidget(self)
        self.setCentralWidget(central)
        main_layout = QVBoxLayout(central)
        main_layout.setContentsMargins(20, 18, 20, 18)
        main_layout.setSpacing(14)

        # Header
        header_layout = QHBoxLayout()
        title_label = QLabel("⚡ LaptopTap")
        title_label.setStyleSheet("font-size: 20px; font-weight: 700; color: #ffffff;")
        header_layout.addWidget(title_label)
        
        self.status_badge = QLabel("● Active (Monitoring)")
        self.status_badge.setStyleSheet("font-size: 12px; font-weight: bold; color: #00e676; background-color: #10261c; padding: 4px 10px; border-radius: 12px;")
        header_layout.addStretch()
        header_layout.addWidget(self.status_badge)
        main_layout.addLayout(header_layout)
        
        subtitle = QLabel("Turn physical taps on your laptop chassis or desk into instant Windows shortcuts.")
        subtitle.setStyleSheet("font-size: 12px; color: #94a3b8;")
        subtitle.setWordWrap(True)
        main_layout.addWidget(subtitle)

        # Oscilloscope Waveform Box
        osc_group = QGroupBox("Live Chassis Vibration (Waveform)")
        osc_layout = QVBoxLayout(osc_group)
        self.waveform_widget = WaveformWidget(self)
        osc_layout.addWidget(self.waveform_widget)
        main_layout.addWidget(osc_group)

        # Live Event Trigger Badge
        self.event_badge = QLabel("Knock 1, 2, or 3 times on the laptop body to test...")
        self.event_badge.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.event_badge.setStyleSheet("""
            background-color: #171a22;
            border: 1px dashed #333a4a;
            border-radius: 8px;
            padding: 10px;
            font-size: 13px;
            font-weight: 600;
            color: #94a3b8;
        """)
        main_layout.addWidget(self.event_badge)

        # Settings: Sensitivity
        sens_group = QGroupBox("Detection Sensitivity")
        sens_layout = QVBoxLayout(sens_group)
        sens_row = QHBoxLayout()
        sens_label = QLabel("Sensitivity:")
        sens_label.setStyleSheet("color: #e2e8f0; font-size: 12px;")
        self.sens_val_label = QLabel(f"{int(self.config.get('sensitivity', 0.7) * 100)}%")
        self.sens_val_label.setStyleSheet("color: #00e5ff; font-weight: bold; font-size: 12px;")
        sens_row.addWidget(sens_label)
        sens_row.addStretch()
        sens_row.addWidget(self.sens_val_label)
        sens_layout.addLayout(sens_row)

        self.sens_slider = QSlider(Qt.Orientation.Horizontal)
        self.sens_slider.setRange(10, 100)
        self.sens_slider.setValue(int(self.config.get("sensitivity", 0.70) * 100))
        self.sens_slider.valueChanged.connect(self.on_sensitivity_changed)
        sens_layout.addWidget(self.sens_slider)
        
        sens_hint = QLabel("🛡️ Voice Shield Active: Harmonic pitch & high-frequency filtering blocks speech and music from false triggering.")
        sens_hint.setStyleSheet("font-size: 11px; color: #38bdf8; margin-top: 4px;")
        sens_hint.setWordWrap(True)
        sens_layout.addWidget(sens_hint)
        main_layout.addWidget(sens_group)

        # Settings: Action Mappings
        actions_group = QGroupBox("Tap Shortcut Mappings")
        actions_grid = QGridLayout(actions_group)
        actions_grid.setSpacing(10)

        # 1 Tap
        lbl_1 = QLabel("Single Knock (1×):")
        self.combo_1 = QComboBox()
        self._populate_actions(self.combo_1, self.config.get("actions", {}).get("single_tap", "play_pause"))
        self.combo_1.currentTextChanged.connect(lambda txt: self._save_action("single_tap", self.combo_1))
        actions_grid.addWidget(lbl_1, 0, 0)
        actions_grid.addWidget(self.combo_1, 0, 1)

        # 2 Taps
        lbl_2 = QLabel("Double Knock (2×):")
        self.combo_2 = QComboBox()
        self._populate_actions(self.combo_2, self.config.get("actions", {}).get("double_tap", "copy"))
        self.combo_2.currentTextChanged.connect(lambda txt: self._save_action("double_tap", self.combo_2))
        actions_grid.addWidget(lbl_2, 1, 0)
        actions_grid.addWidget(self.combo_2, 1, 1)

        # 3 Taps
        lbl_3 = QLabel("Triple Knock (3×):")
        self.combo_3 = QComboBox()
        self._populate_actions(self.combo_3, self.config.get("actions", {}).get("triple_tap", "paste"))
        self.combo_3.currentTextChanged.connect(lambda txt: self._save_action("triple_tap", self.combo_3))
        actions_grid.addWidget(lbl_3, 2, 0)
        actions_grid.addWidget(self.combo_3, 2, 1)

        main_layout.addWidget(actions_group)

        # Options checkboxes
        opts_layout = QHBoxLayout()
        self.chk_typing = QCheckBox("Ignore knocks while typing")
        self.chk_typing.setChecked(self.config.get("suppress_typing", True))
        self.chk_typing.toggled.connect(lambda val: self.config.set("suppress_typing", val))
        
        self.chk_sides = QCheckBox("Distinguish Left / Right chassis")
        self.chk_sides.setChecked(self.config.get("detect_sides", True))
        self.chk_sides.toggled.connect(lambda val: self.config.set("detect_sides", val))
        
        opts_layout.addWidget(self.chk_typing)
        opts_layout.addWidget(self.chk_sides)
        main_layout.addLayout(opts_layout)

        # Voice Commands group
        voice_group = QGroupBox("🎙️ Voice Commands (English Speech Control)")
        voice_layout = QVBoxLayout(voice_group)
        self.chk_voice = QCheckBox("Enable Voice Commands (Say 'Copy', 'Paste', 'Screenshot', 'Lock', 'Play')")
        self.chk_voice.setChecked(self.config.get("enable_voice_commands", True))
        self.chk_voice.toggled.connect(self.on_voice_toggle)
        voice_layout.addWidget(self.chk_voice)
        
        voice_hint = QLabel("💡 100% Offline & Native: Instant response when you say 'Copy' or 'Paste'.")
        voice_hint.setStyleSheet("font-size: 11px; color: #a78bfa;")
        voice_layout.addWidget(voice_hint)
        main_layout.addWidget(voice_group)

        # Footer Buttons
        footer_layout = QHBoxLayout()
        self.btn_calibrate = QPushButton("🎯 Calibrate Taps")
        self.btn_calibrate.setStyleSheet("background-color: #2e1065; border: 1px solid #7c3aed; color: #c4b5fd;")
        self.btn_calibrate.clicked.connect(self.run_calibration)

        self.btn_voice_calibrate = QPushButton("🎙️ Calibrate Voice")
        self.btn_voice_calibrate.setStyleSheet("background-color: #311b92; border: 1px solid #651fff; color: #b388ff;")
        self.btn_voice_calibrate.clicked.connect(self.run_voice_calibration)

        self.btn_toggle = QPushButton("Pause")
        self.btn_toggle.clicked.connect(self.toggle_monitoring)
        
        self.btn_minimize = QPushButton("Hide to Tray")
        self.btn_minimize.setStyleSheet("background-color: #00e5ff; color: #0f1115; font-weight: bold;")
        self.btn_minimize.clicked.connect(self.hide)
        
        footer_layout.addWidget(self.btn_calibrate)
        footer_layout.addWidget(self.btn_voice_calibrate)
        footer_layout.addWidget(self.btn_toggle)
        footer_layout.addWidget(self.btn_minimize)
        main_layout.addLayout(footer_layout)

    def _populate_actions(self, combo, current_key):
        combo.clear()
        for key, label in ACTION_LABELS.items():
            combo.addItem(label, key)
        # Select current
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

    def init_tray(self):
        self.tray_icon = QSystemTrayIcon(self)
        
        # Create a simple colored dot pixmap for tray icon
        from PyQt6.QtGui import QPixmap
        pixmap = QPixmap(32, 32)
        pixmap.fill(Qt.GlobalColor.transparent)
        p = QPainter(pixmap)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        p.setBrush(QBrush(QColor(0, 229, 255)))
        p.setPen(Qt.PenStyle.NoPen)
        p.drawEllipse(4, 4, 24, 24)
        p.end()
        icon = QIcon(pixmap)
        
        self.tray_icon.setIcon(icon)
        self.tray_icon.setToolTip("LaptopTap — Chassis Knock Shortcuts")
        
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
        if self.audio_engine.is_running:
            self.audio_engine.stop()
            self.status_badge.setText("⏸ Paused")
            self.status_badge.setStyleSheet("font-size: 12px; font-weight: bold; color: #ffab00; background-color: #2b2210; padding: 4px 10px; border-radius: 12px;")
            self.btn_toggle.setText("Resume Detection")
        else:
            self.audio_engine.start()
            self.status_badge.setText("● Active (Monitoring)")
            self.status_badge.setStyleSheet("font-size: 12px; font-weight: bold; color: #00e676; background-color: #10261c; padding: 4px 10px; border-radius: 12px;")
            self.btn_toggle.setText("Pause Detection")

    def on_level_received(self, peak, threshold):
        self.current_peak = peak
        self.current_threshold = threshold

    def refresh_display(self):
        # Update waveform widget with latest audio history
        history = self.audio_engine.waveform_history
        self.waveform_widget.update_data(history, self.current_peak, self.current_threshold)

    def on_gesture_received(self, gesture: DetectedTapGesture):
        # Flash the waveform widget
        self.waveform_widget.flash()
        
        # Determine action from config
        actions = self.config.get("actions", {})
        action_name = None
        
        # Check specific side double tap first if configured
        if gesture.count == 2 and gesture.side in ("left", "right"):
            key = f"{gesture.side}_double_tap"
            action_name = actions.get(key)
            
        if not action_name:
            if gesture.count == 1:
                action_name = actions.get("single_tap", "play_pause")
            elif gesture.count == 2:
                action_name = actions.get("double_tap", "copy")
            elif gesture.count >= 3:
                action_name = actions.get("triple_tap", "paste")
                
        action_title = ACTION_LABELS.get(action_name, action_name)
        side_text = f" ({gesture.side.capitalize()} side)" if gesture.side != "center" else ""
        text = f"⚡ {gesture.count}× Knock{side_text} ➔ Triggered: {action_title}"
        
        self.event_badge.setText(text)
        self.event_badge.setStyleSheet("""
            background-color: #0b2f3a;
            border: 1px solid #00e5ff;
            border-radius: 8px;
            padding: 10px;
            font-size: 13px;
            font-weight: bold;
            color: #00e5ff;
        """)
        
        # Trigger action!
        if action_name and action_name != "none":
            self.executor.trigger(action_name)
        
    def on_voice_toggle(self, checked):
        self.config.set("enable_voice_commands", checked)
        if self.voice_detector:
            if checked and not self.voice_detector.is_running:
                self.voice_detector.start()
            elif not checked and self.voice_detector.is_running:
                self.voice_detector.stop()

    def on_voice_received(self, word: str, confidence: float, spoken_text: str = ""):
        # Mute tap detector during and after speech
        self.tap_detector.notify_speech_active(0.60)
        voice_actions = self.config.get("voice_actions", {})
        action_name = voice_actions.get(word.lower())
        if not action_name:
            action_name = word.lower()
            
        action_title = ACTION_LABELS.get(action_name, action_name)
        display_text = spoken_text if spoken_text else word
        text = f"🎙️ Spoken: \"{display_text.upper()}\" ({int(confidence*100)}%) ➔ Triggered: {action_title}"
        
        self.event_badge.setText(text)
        self.event_badge.setStyleSheet("""
            background-color: #2b123d;
            border: 1px solid #d500f9;
            border-radius: 8px;
            padding: 10px;
            font-size: 13px;
            font-weight: bold;
            color: #f3e5f5;
        """)
        
        # Trigger action!
        if action_name and action_name != "none":
            self.executor.trigger(action_name)

    def run_calibration(self):
        import subprocess
        from pathlib import Path
        cal_bat = Path(__file__).parent / "calibrate.bat"
        if cal_bat.exists():
            subprocess.Popen(f'cmd.exe /c start "" "{cal_bat}"', shell=True)
        else:
            subprocess.Popen('cmd.exe /c start cmd /k py calibrate.py', shell=True, cwd=str(Path(__file__).parent))

    def run_voice_calibration(self):
        import subprocess
        from pathlib import Path
        cal_bat = Path(__file__).parent / "voice_calibrate.bat"
        if cal_bat.exists():
            subprocess.Popen(f'cmd.exe /c start "" "{cal_bat}"', shell=True)
        else:
            subprocess.Popen('cmd.exe /c start cmd /k py voice_calibrate.py', shell=True, cwd=str(Path(__file__).parent))

    def closeEvent(self, event):
        # Minimize to tray instead of quitting if tray is available
        if self.tray_icon.isVisible():
            self.hide()
            self.tray_icon.showMessage(
                "LaptopTap Running",
                "LaptopTap is active in the tray. Knock laptop or say 'Copy' / 'Paste'!",
                QSystemTrayIcon.MessageIcon.Information,
                2000
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

