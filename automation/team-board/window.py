"""Open the shared board in a normal, maximized Windows application window."""

import ctypes
import json
import os
import shutil
import subprocess
import sys
import time
from contextlib import contextmanager
from ctypes import wintypes
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, build_opener

from board import DEFAULT_DATA
from dashboard import PORT, board_key
from window_icon import keep_window_icons


TITLE = "박한수 에이전트 대쉬보드"


def browser_path():
    for vendor, program in (("Microsoft/Edge", "msedge.exe"),
                            ("Google/Chrome", "chrome.exe")):
        for location in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"):
            root = os.environ.get(location)
            if root:
                path = Path(root) / vendor / "Application" / program
                if path.is_file():
                    return str(path)
        found = shutil.which(program)
        if found:
            return found
    raise RuntimeError("대시보드 창을 열려면 Microsoft Edge 또는 Google Chrome이 필요합니다.")


def ensure_server(directory, port):
    url = f"http://127.0.0.1:{port}/"
    opener = build_opener(ProxyHandler({}))
    process = None
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        try:
            with opener.open(url + "api/health", timeout=1) as response:
                health = json.load(response)
        except HTTPError as exc:
            raise RuntimeError(f"포트 {port}에서 다른 서비스가 응답했습니다.") from exc
        except (URLError, TimeoutError, ConnectionError):
            if process is None:
                with (directory / "server.log").open("ab") as log:
                    process = subprocess.Popen(
                        [sys.executable, "-X", "utf8", str(Path(__file__).with_name("dashboard.py")),
                         "--data-dir", str(directory), "serve", "--port", str(port)],
                        creationflags=subprocess.CREATE_NO_WINDOW,
                        stdin=subprocess.DEVNULL, stdout=log, stderr=log)
            elif process.poll() not in (None, 0):
                raise RuntimeError(f"칠판 서버를 시작하지 못했습니다.\n{directory / 'server.log'}")
            time.sleep(0.2)
        else:
            if health.get("app") != "team-board" or health.get("board") != board_key(directory):
                raise RuntimeError(f"포트 {port}에서 다른 칠판이 응답했습니다.")
            return url
    raise RuntimeError(f"칠판 서버가 응답하지 않습니다.\n{directory / 'server.log'}")


class AppWindow:
    def __init__(self):
        self.user = ctypes.WinDLL("user32", use_last_error=True)
        for name, args, result in (
            ("FindWindowExW", (wintypes.HWND, wintypes.HWND, wintypes.LPCWSTR, wintypes.LPCWSTR), wintypes.HWND),
            ("GetWindowTextW", (wintypes.HWND, wintypes.LPWSTR, ctypes.c_int), ctypes.c_int),
            ("GetPropW", (wintypes.HWND, wintypes.LPCWSTR), wintypes.HANDLE),
            ("SetPropW", (wintypes.HWND, wintypes.LPCWSTR, wintypes.HANDLE), wintypes.BOOL),
            ("IsWindowVisible", (wintypes.HWND,), wintypes.BOOL),
            ("ShowWindow", (wintypes.HWND, ctypes.c_int), wintypes.BOOL),
            ("SetForegroundWindow", (wintypes.HWND,), wintypes.BOOL),
        ):
            function = getattr(self.user, name)
            function.argtypes = args
            function.restype = result
        self.marker = "HansuPark.AgentBoard." + board_key(DEFAULT_DATA.resolve())

    def windows(self):
        previous = None
        while hwnd := self.user.FindWindowExW(None, previous, "Chrome_WidgetWin_1", None):
            if self.user.IsWindowVisible(hwnd):
                yield hwnd
            previous = hwnd

    def focus(self, hwnd):
        self.user.ShowWindow(hwnd, 3)  # SW_MAXIMIZE retains the normal caption and taskbar.
        self.user.SetForegroundWindow(hwnd)

    def open(self, browser, url, directory):
        for hwnd in self.windows():
            if self.user.GetPropW(hwnd, self.marker):
                self.focus(hwnd)
                return hwnd

        before = set(self.windows())
        subprocess.Popen(
            [browser, f"--app={url}", f"--user-data-dir={directory / 'window-profile'}",
             "--no-first-run", "--no-default-browser-check", "--disable-background-mode",
             "--start-maximized", "--window-size=1500,950"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        end = time.monotonic() + 18
        while time.monotonic() < end:
            for hwnd in self.windows():
                if hwnd in before:
                    continue
                title = ctypes.create_unicode_buffer(512)
                self.user.GetWindowTextW(hwnd, title, len(title))
                if title.value.startswith(TITLE):
                    self.user.SetPropW(hwnd, self.marker, 1)
                    self.focus(hwnd)
                    return hwnd
            time.sleep(0.2)
        raise RuntimeError("대시보드 창이 열렸는지 확인하지 못했습니다.")


@contextmanager
def single_instance(name):
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateMutexW.argtypes = (ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR)
    kernel.CreateMutexW.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
    handle = kernel.CreateMutexW(None, False, "Local\\" + name)
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        yield ctypes.get_last_error() != 183
    finally:
        kernel.CloseHandle(handle)


def launch():
    try:
        directory = DEFAULT_DATA.resolve()
        directory.mkdir(parents=True, exist_ok=True)
        with single_instance("HansuAgentBoardOpen-" + board_key(directory)) as opening:
            if not opening:
                return
            browser = browser_path()
            url = ensure_server(directory, PORT)
            window = AppWindow()
            hwnd = window.open(browser, url, directory)
        # A second shortcut click can now focus the board without starting another icon owner.
        with single_instance(f"HansuAgentBoardIcons-{hwnd}") as owns_icons:
            if owns_icons:
                keep_window_icons(hwnd, window.marker, TITLE)
    except Exception as exc:
        if sys.stderr is not None:
            raise
        ctypes.windll.user32.MessageBoxW(None, str(exc), TITLE, 16)


if __name__ == "__main__":
    launch()
