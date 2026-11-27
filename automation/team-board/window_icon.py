"""Taskbar identity and caption/switcher icons for the board's Windows app window."""

import ctypes
import subprocess
import sys
import time
import uuid
from ctypes import wintypes as W
from pathlib import Path


ICON = Path(__file__).resolve().parent / "web" / "agent-board.ico"
APP_ID = "HansuPark.AgentMissionControl"
GUID = ctypes.c_ubyte * 16


class PropertyKey(ctypes.Structure):
    _fields_ = [("fmtid", GUID), ("pid", W.DWORD)]


class StringVariant(ctypes.Structure):
    # PROPVARIANT contains four WORDs followed by a union up to two pointers wide.
    _fields_ = [("vt", W.WORD), ("reserved", W.WORD * 3),
                ("text", W.LPWSTR), ("padding", ctypes.c_void_p)]


def set_relaunch_identity(hwnd, title):
    """Give the shell a stable icon and a relaunch command even after the window closes."""
    iid = GUID.from_buffer_copy(uuid.UUID("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99").bytes_le)
    fmtid = GUID.from_buffer_copy(uuid.UUID("9f4c2855-9f79-4b39-a8d0-e1d42de1d5f3").bytes_le)
    shell = ctypes.OleDLL("shell32")
    shell.SHGetPropertyStoreForWindow.argtypes = [
        W.HWND, ctypes.POINTER(GUID), ctypes.POINTER(ctypes.c_void_p)]
    ole = ctypes.windll.ole32
    initialized = ole.CoInitialize(None)
    if initialized < 0 and initialized != -2147417850:  # RPC_E_CHANGED_MODE is already initialized.
        raise OSError(f"CoInitialize failed: {initialized:#x}")
    store = ctypes.c_void_p()
    try:
        shell.SHGetPropertyStoreForWindow(hwnd, ctypes.byref(iid), ctypes.byref(store))
        vtable = ctypes.cast(store, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
        set_value = ctypes.WINFUNCTYPE(
            ctypes.c_long, ctypes.c_void_p, ctypes.POINTER(PropertyKey),
            ctypes.POINTER(StringVariant))(vtable[6])
        launcher = Path(sys.executable).with_name("pythonw.exe")
        args = [str(launcher), "-X", "utf8", str(Path(__file__).with_name("window.py").resolve())]
        # Set ID last: Windows uses the companion values when associating the group.
        for prop, text in ((2, subprocess.list2cmdline(args)), (3, f"{ICON},0"),
                           (4, title), (5, APP_ID)):
            key = PropertyKey(fmtid, prop)
            value = StringVariant(vt=31, text=text)  # VT_LPWSTR; SetValue copies it.
            hr = set_value(store, ctypes.byref(key), ctypes.byref(value))
            if hr < 0:
                raise OSError(f"Shell property {prop} failed: {hr:#x}")
    finally:
        if store:
            ctypes.WINFUNCTYPE(W.ULONG, ctypes.c_void_p)(vtable[2])(store)
        if initialized >= 0:
            ole.CoUninitialize()


def keep_window_icons(hwnd, marker, title):
    """Own the HICONs set on the browser's HWND until that particular window closes."""
    user = ctypes.WinDLL("user32", use_last_error=True)
    user.GetPropW.argtypes = (W.HWND, W.LPCWSTR)
    user.GetPropW.restype = W.HANDLE
    user.LoadImageW.argtypes = (W.HINSTANCE, W.LPCWSTR, W.UINT, ctypes.c_int, ctypes.c_int, W.UINT)
    user.LoadImageW.restype = W.HANDLE
    user.DestroyIcon.argtypes = (W.HICON,)
    user.SendMessageTimeoutW.argtypes = (W.HWND, W.UINT, W.WPARAM, W.LPARAM, W.UINT, W.UINT,
                                         ctypes.POINTER(ctypes.c_size_t))
    user.SendMessageTimeoutW.restype = W.LPARAM

    set_relaunch_identity(hwnd, title)
    icons = []
    try:
        for x, y in ((49, 50), (11, 12)):  # SM_CX/YSMICON, SM_CX/YICON
            handle = user.LoadImageW(None, str(ICON), 1, user.GetSystemMetrics(x),
                                     user.GetSystemMetrics(y), 0x10)  # IMAGE_ICON, LR_LOADFROMFILE
            if not handle:
                raise ctypes.WinError(ctypes.get_last_error())
            icons.append(handle)
        while user.GetPropW(hwnd, marker):
            # Chromium may replace caption icons during navigation.
            for size, handle in enumerate(icons):
                current = ctypes.c_size_t()
                if user.SendMessageTimeoutW(hwnd, 0x7F, size, 0, 2, 250, ctypes.byref(current)):
                    if current.value != handle:
                        user.SendMessageTimeoutW(hwnd, 0x80, size, handle, 2, 250, ctypes.byref(current))
            time.sleep(3)
    finally:
        for handle in icons:
            user.DestroyIcon(handle)
