import time
import subprocess
import ctypes
from ctypes import wintypes

user32 = ctypes.windll.user32

# Virtual key constants
VK_LBUTTON        = 0x01
VK_RBUTTON        = 0x02
VK_CANCEL         = 0x03
VK_BACK           = 0x08
VK_TAB            = 0x09
VK_SHIFT          = 0x10
VK_CONTROL        = 0x11
VK_MENU           = 0x12  # Alt
VK_LWIN           = 0x5B
VK_RWIN           = 0x5C

VK_KEY_C          = 0x43  # 'C' key
VK_KEY_V          = 0x56  # 'V' key
VK_KEY_S          = 0x53  # 'S' key

VK_VOLUME_MUTE    = 0xAD
VK_VOLUME_DOWN    = 0xAE
VK_VOLUME_UP      = 0xAF
VK_MEDIA_NEXT_TRACK = 0xB0
VK_MEDIA_PREV_TRACK = 0xB1
VK_MEDIA_STOP       = 0xB2
VK_MEDIA_PLAY_PAUSE = 0xB3

# SendInput flags
INPUT_KEYBOARD    = 1
KEYEVENTF_EXTENDEDKEY = 0x0001
KEYEVENTF_KEYUP       = 0x0002
KEYEVENTF_SCANCODE    = 0x0008

PUL = ctypes.POINTER(ctypes.c_ulong)

class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ('wVk', wintypes.WORD),
        ('wScan', wintypes.WORD),
        ('dwFlags', wintypes.DWORD),
        ('time', wintypes.DWORD),
        ('dwExtraInfo', PUL)
    ]

class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [
        ('uMsg', wintypes.DWORD),
        ('wParamL', wintypes.WORD),
        ('wParamH', wintypes.WORD)
    ]

class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ('dx', wintypes.LONG),
        ('dy', wintypes.LONG),
        ('mouseData', wintypes.DWORD),
        ('dwFlags', wintypes.DWORD),
        ('time', wintypes.DWORD),
        ('dwExtraInfo', PUL)
    ]

class INPUT_I(ctypes.Union):
    _fields_ = [
        ('ki', KEYBDINPUT),
        ('mi', MOUSEINPUT),
        ('hi', HARDWAREINPUT)
    ]

class INPUT(ctypes.Structure):
    _fields_ = [
        ('type', wintypes.DWORD),
        ('ii', INPUT_I)
    ]


def _make_input(vk, is_up=False, is_extended=False):
    scan = user32.MapVirtualKeyW(vk, 0)
    flags = 0
    if is_up:
        flags |= KEYEVENTF_KEYUP
    if is_extended:
        flags |= KEYEVENTF_EXTENDEDKEY
        
    extra = ctypes.c_ulong(0)
    ii_ = INPUT_I()
    ii_.ki = KEYBDINPUT(vk, scan, flags, 0, ctypes.pointer(extra))
    return INPUT(ctypes.c_ulong(INPUT_KEYBOARD), ii_)


def send_single_key(vk, is_extended=False):
    """Press and release a single key (e.g. Media keys)."""
    inp_down = _make_input(vk, is_up=False, is_extended=is_extended)
    inp_up = _make_input(vk, is_up=True, is_extended=is_extended)
    user32.SendInput(1, ctypes.pointer(inp_down), ctypes.sizeof(inp_down))
    time.sleep(0.02)
    user32.SendInput(1, ctypes.pointer(inp_up), ctypes.sizeof(inp_up))


def send_hotkey(*vks):
    """Press all keys in order, then release all keys in reverse order."""
    # Press in order
    for vk in vks:
        is_ext = vk in (VK_LWIN, VK_RWIN)
        inp = _make_input(vk, is_up=False, is_extended=is_ext)
        user32.SendInput(1, ctypes.pointer(inp), ctypes.sizeof(inp))
        time.sleep(0.015)
        
    time.sleep(0.03)
    
    # Release in reverse order
    for vk in reversed(vks):
        is_ext = vk in (VK_LWIN, VK_RWIN)
        inp = _make_input(vk, is_up=True, is_extended=is_ext)
        user32.SendInput(1, ctypes.pointer(inp), ctypes.sizeof(inp))
        time.sleep(0.015)


class ActionExecutor:
    """Executes actions triggered by chassis taps or voice commands."""
    
    def __init__(self):
        pass

    def trigger(self, action_name):
        """Dispatch action based on action_name string."""
        if not action_name or action_name == "none":
            return
            
        print(f"[ActionExecutor] Executing action: {action_name}")
        try:
            if action_name == "copy":
                # Ctrl + C with exact VK_KEY_C (0x43) and scan code 0x2E (46)
                send_hotkey(VK_CONTROL, VK_KEY_C)
            elif action_name == "paste":
                # Ctrl + V with exact VK_KEY_V (0x56) and scan code 0x2F (47)
                send_hotkey(VK_CONTROL, VK_KEY_V)
            elif action_name == "screenshot":
                # Win + Shift + S
                send_hotkey(VK_LWIN, VK_SHIFT, VK_KEY_S)
            elif action_name == "task_view":
                # Win + Tab
                send_hotkey(VK_LWIN, VK_TAB)
            elif action_name == "play_pause":
                send_single_key(VK_MEDIA_PLAY_PAUSE, is_extended=True)
            elif action_name == "next_track":
                send_single_key(VK_MEDIA_NEXT_TRACK, is_extended=True)
            elif action_name == "prev_track":
                send_single_key(VK_MEDIA_PREV_TRACK, is_extended=True)
            elif action_name == "mute":
                send_single_key(VK_VOLUME_MUTE, is_extended=True)
            elif action_name == "volume_up":
                send_single_key(VK_VOLUME_UP, is_extended=True)
            elif action_name == "volume_down":
                send_single_key(VK_VOLUME_DOWN, is_extended=True)
            elif action_name == "lock":
                user32.LockWorkStation()
            elif action_name.startswith("cmd:"):
                cmd = action_name[4:].strip()
                subprocess.Popen(cmd, shell=True)
            else:
                print(f"[ActionExecutor] Unknown action: {action_name}")
        except Exception as e:
            print(f"[ActionExecutor] Error executing {action_name}: {e}")
