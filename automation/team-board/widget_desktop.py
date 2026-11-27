"""Pin a Tk window to the Windows desktop's interactive icon layer."""

import ctypes
import os
from ctypes import wintypes as W


class _Windows:
    def __init__(self):
        dll = ctypes.WinDLL("user32", use_last_error=True)

        def bind(name, result, *arguments):
            function = getattr(dll, name)
            function.argtypes = arguments
            function.restype = result
            return function

        self.enum_callback = ctypes.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)
        self.enum = bind("EnumWindows", W.BOOL, self.enum_callback, W.LPARAM)
        self.descendants = bind("EnumChildWindows", W.BOOL, W.HWND, self.enum_callback, W.LPARAM)
        self.shell = bind("GetShellWindow", W.HWND)
        self.pid = bind("GetWindowThreadProcessId", W.DWORD, W.HWND, ctypes.POINTER(W.DWORD))
        self.window_class = bind("GetClassNameW", ctypes.c_int, W.HWND, W.LPWSTR, ctypes.c_int)
        self.child = bind("FindWindowExW", W.HWND, W.HWND, W.HWND, W.LPCWSTR, W.LPCWSTR)
        self.ancestor = bind("GetAncestor", W.HWND, W.HWND, W.UINT)
        self.visible = bind("IsWindowVisible", W.BOOL, W.HWND)
        self.exists = bind("IsWindow", W.BOOL, W.HWND)
        self.style = bind("GetWindowLongW", W.LONG, W.HWND, ctypes.c_int)
        self.set_style = bind("SetWindowLongW", W.LONG, W.HWND, ctypes.c_int, W.LONG)
        self.parent = bind("SetParent", W.HWND, W.HWND, W.HWND)
        self.rect = bind("GetWindowRect", W.BOOL, W.HWND, ctypes.POINTER(W.RECT))
        self.to_client = bind("ScreenToClient", W.BOOL, W.HWND, ctypes.POINTER(W.POINT))
        self.position = bind("SetWindowPos", W.BOOL, W.HWND, W.HWND, ctypes.c_int, ctypes.c_int,
                             ctypes.c_int, ctypes.c_int, W.UINT)
        self.window = bind("GetWindow", W.HWND, W.HWND, W.UINT)
        self.get_context = getattr(dll, "GetWindowDpiAwarenessContext", None)
        self.set_context = getattr(dll, "SetProcessDpiAwarenessContext", None)
        if self.get_context and self.set_context:
            self.get_context.argtypes, self.get_context.restype = [W.HWND], W.HANDLE
            self.set_context.argtypes, self.set_context.restype = [W.HANDLE], W.BOOL

    def owner_pid(self, hwnd):
        pid = W.DWORD()
        if hwnd:
            self.pid(hwnd, ctypes.byref(pid))
        return pid.value

    def class_name(self, hwnd):
        value = ctypes.create_unicode_buffer(96)
        self.window_class(hwnd, value, len(value))
        return value.value

    def icon_layer(self):
        """Locate *the desktop* DefView without matching ordinary Explorer folders."""
        shell = self.shell()
        if not shell:
            return None
        shell_pid = self.owner_pid(shell)
        containers = [shell]

        @self.enum_callback
        def collect(hwnd, _):
            if self.visible(hwnd) and self.class_name(hwnd) == "WorkerW" and self.owner_pid(hwnd) == shell_pid:
                containers.append(hwnd)
            return True

        self.enum(collect, 0)
        for container in containers:
            if not self.visible(container):
                continue
            view = self.child(container, None, "SHELLDLL_DefView", None)
            if not view:
                found = []

                @self.enum_callback
                def locate(hwnd, _):
                    if self.class_name(hwnd) == "SHELLDLL_DefView":
                        found.append(hwnd)
                        return False
                    return True

                self.descendants(container, locate, 0)
                view = found[0] if found else None
            if view and self.owner_pid(view) == shell_pid and self.child(view, None, "SysListView32", None):
                return self.ancestor(view, 1), view
        return None


def enable_desktop_dpi():
    """Match Explorer before creating Tk windows. Respect an existing DPI setting."""
    if os.name == "nt":
        api = _Windows()
        shell = api.shell()
        if shell and api.get_context and api.set_context:
            context = api.get_context(shell)
            if context:
                api.set_context(context)


class DesktopMount:
    """Keep only the widget HWND above the desktop icons, under normal applications."""

    def __init__(self, root, on_window_lost=None):
        self.root = root
        self.on_window_lost = on_window_lost
        self.api = _Windows()
        self.hwnd = None
        self.host = None
        self.attached = False
        self.error = ""
        self._watch = None
        self._styles = None
        self._last_rect = None

    def _ours(self, hwnd):
        return bool(hwnd and self.api.exists(hwnd) and self.api.owner_pid(hwnd) == os.getpid())

    def _tk_wrapper(self):
        self.root.update_idletasks()
        inner = self.root.winfo_id()
        outer = self.api.ancestor(inner, 1)  # Tk has a separate native toplevel wrapper.
        if self._ours(outer) and self.api.class_name(outer) == "TkTopLevel":
            return outer
        if self._ours(inner) and self.api.class_name(inner) == "TkTopLevel":
            return inner
        raise RuntimeError("위젯의 Windows 창을 찾지 못했습니다.")

    def screen_rect(self):
        hwnd = self.hwnd if self._ours(self.hwnd) else self._tk_wrapper()
        rect = W.RECT()
        if not self.api.rect(hwnd, ctypes.byref(rect)):
            raise ctypes.WinError(ctypes.get_last_error())
        return rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top

    @staticmethod
    def _change(fn, *args):
        # Both SetParent and SetWindowLong may legitimately return zero on success.
        ctypes.set_last_error(0)
        previous = fn(*args)
        error = ctypes.get_last_error()
        if not previous and error:
            raise ctypes.WinError(error)

    def _place(self, rect, *, frame=False, raise_in_host=False):
        if not self._ours(self.hwnd):
            raise RuntimeError("위젯 창이 종료되었습니다.")
        x, y, width, height = rect
        point = W.POINT(round(x), round(y))
        if self.attached and not self.api.to_client(self.host, ctypes.byref(point)):
            raise ctypes.WinError(ctypes.get_last_error())
        flags = 0x0010 | 0x0200  # SWP_NOACTIVATE | SWP_NOOWNERZORDER
        if frame:
            flags |= 0x0020
        if not (raise_in_host and self.attached):
            flags |= 0x0004  # SWP_NOZORDER
        if not self.api.position(self.hwnd, None, point.x, point.y, width, height, flags):
            raise ctypes.WinError(ctypes.get_last_error())
        self._last_rect = rect

    def move(self, x, y):
        _, _, width, height = self.screen_rect()
        self._place((int(x), int(y), width, height))

    def resize(self, width, height):
        x, y, _, _ = self.screen_rect()
        self._place((x, y, max(1, int(width)), max(1, int(height))))

    def _restore(self, rect):
        if self._ours(self.hwnd) and self._styles is not None:
            parent, style, exstyle = self._styles
            self._change(self.api.parent, self.hwnd, parent if parent and self.api.exists(parent) else None)
            self._change(self.api.set_style, self.hwnd, -16, style)
            self._change(self.api.set_style, self.hwnd, -20, exstyle)
            self.attached = False
            self.host = None
            self._place(rect, frame=True)

    def _mount(self):
        api = self.api
        if not self._ours(self.hwnd):
            self.hwnd = self._tk_wrapper()
            self._styles = None
        layer = api.icon_layer()
        if not layer:
            raise RuntimeError("Explorer 바탕화면을 기다리고 있습니다.")
        host, view = layer
        if self.attached and api.ancestor(self.hwnd, 1) == host:
            # Explorer can raise the DefView during display/wallpaper changes. Check
            # sibling order first, so multiple desktop widgets can peacefully coexist.
            sibling = api.window(self.hwnd, 3)  # GW_HWNDPREV
            while sibling:
                if sibling == view:
                    self._place(self.screen_rect(), raise_in_host=True)
                    break
                sibling = api.window(sibling, 3)
            return
        rect = self._last_rect or self.screen_rect()
        if self._styles is None:
            self._styles = (api.ancestor(self.hwnd, 1) if api.style(self.hwnd, -16) & 0x40000000 else None,
                            api.style(self.hwnd, -16), api.style(self.hwnd, -20))
        _, style, exstyle = self._styles
        try:
            # Desktop siblings work with both the classic WorkerW host and Explorer's
            # raised DefView layout. No wallpaper spawning messages or shell mutations.
            child_style = (style & ~(0x80000000 | 0x00CF0000)) | 0x40000000
            self._change(api.set_style, self.hwnd, -16, child_style)
            self._change(api.set_style, self.hwnd, -20, (exstyle & ~0x40000) | 0x80)
            self._change(api.parent, self.hwnd, host)
            self.host, self.attached = host, True
            self._place(rect, frame=True, raise_in_host=True)
            if api.ancestor(self.hwnd, 1) != host:
                raise RuntimeError("바탕화면에 위젯을 연결하지 못했습니다.")
        except (OSError, RuntimeError):
            self._restore(rect)
            raise

    def attach(self):
        try:
            self._mount()
            self.error = ""
        except (OSError, RuntimeError) as exc:
            self.error = str(exc)
            self.attached = False
        if self._watch is None:
            self._watch = self.root.after(2500, self._check)
        return self.attached

    def _check(self):
        self._watch = None
        # When Explorer destroys this native parent, Windows may destroy its
        # cross-process children too. The Tcl interpreter remains alive with stale
        # HWNDs; rebuilding the actual view is the application's responsibility.
        if self._styles is not None and not self._ours(self.hwnd) and self.on_window_lost:
            self.attached = False
            self.error = "Explorer가 바탕화면을 다시 만들었습니다."
            self.on_window_lost()
            return
        self.attach()

    def detach(self):
        if self._watch is not None:
            self.root.after_cancel(self._watch)
            self._watch = None
        if self._ours(self.hwnd) and self._styles is not None:
            self._restore(self.screen_rect())
        self.host, self.attached, self._styles = None, False, None
