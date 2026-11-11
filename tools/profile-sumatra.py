"""Measure an installed SumatraPDF with isolated settings and read-only documents.

The bench mode uses Sumatra's own 72-dpi renderer. The UI mode visits the
same proportional page sequence as profile-pdf-scroll.mjs. UI readiness is
navigation acknowledgement, not a guarantee that every pixel has painted.
Only the process started here is queried or closed.
"""

import argparse
import ctypes as c
from ctypes import wintypes as w
import json
import pathlib
import re
import subprocess
import struct
import tempfile
import threading
import time
import zlib


class Memory(c.Structure):
    _fields_ = [("cb", w.DWORD), ("PageFaultCount", w.DWORD)] + [
        (name, c.c_size_t)
        for name in (
            "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
            "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage",
            "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage", "PrivateUsage",
        )
    ]


class CopyData(c.Structure):
    _fields_ = [("tag", c.c_size_t), ("size", w.DWORD), ("data", c.c_void_p)]


kernel = c.WinDLL("kernel32", use_last_error=True)
psapi = c.WinDLL("psapi", use_last_error=True)
user = c.WinDLL("user32", use_last_error=True)
kernel.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
kernel.OpenProcess.restype = w.HANDLE
kernel.CloseHandle.argtypes = [w.HANDLE]
psapi.GetProcessMemoryInfo.argtypes = [w.HANDLE, c.POINTER(Memory), w.DWORD]
user.SendMessageTimeoutW.argtypes = [w.HWND, w.UINT, w.WPARAM, w.LPARAM, w.UINT, w.UINT, c.POINTER(c.c_size_t)]
user.SendMessageTimeoutW.restype = w.LPARAM
user.GetWindowThreadProcessId.argtypes = [w.HWND, c.POINTER(w.DWORD)]
user.GetClassNameW.argtypes = [w.HWND, w.LPWSTR, c.c_int]
user.GetWindowTextW.argtypes = [w.HWND, w.LPWSTR, c.c_int]
user.PostMessageW.argtypes = [w.HWND, w.UINT, w.WPARAM, w.LPARAM]
user.SetWindowPos.argtypes = [w.HWND, w.HWND, c.c_int, c.c_int, c.c_int, c.c_int, w.UINT]
user.GetClientRect.argtypes = [w.HWND, c.POINTER(w.RECT)]
user.GetDC.argtypes = [w.HWND]
user.GetDC.restype = w.HDC
user.ReleaseDC.argtypes = [w.HWND, w.HDC]
user.PrintWindow.argtypes = [w.HWND, w.HDC, w.UINT]
user.GetDpiForWindow.argtypes = [w.HWND]
gdi = c.WinDLL("gdi32", use_last_error=True)
gdi.CreateCompatibleDC.argtypes = [w.HDC]
gdi.CreateCompatibleDC.restype = w.HDC
gdi.CreateCompatibleBitmap.argtypes = [w.HDC, c.c_int, c.c_int]
gdi.CreateCompatibleBitmap.restype = w.HBITMAP
gdi.SelectObject.argtypes = [w.HDC, w.HGDIOBJ]
gdi.SelectObject.restype = w.HGDIOBJ
gdi.GetDIBits.argtypes = [w.HDC, w.HBITMAP, w.UINT, w.UINT, c.c_void_p, c.c_void_p, w.UINT]
gdi.DeleteObject.argtypes = [w.HGDIOBJ]
gdi.DeleteDC.argtypes = [w.HDC]
CALLBACK = c.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)
user.EnumWindows.argtypes = [CALLBACK, w.LPARAM]
user.EnumChildWindows.argtypes = [w.HWND, CALLBACK, w.LPARAM]


def windows(pid, parent=None):
    found = []

    @CALLBACK
    def visit(hwnd, _):
        owner = w.DWORD()
        user.GetWindowThreadProcessId(hwnd, c.byref(owner))
        if owner.value == pid:
            name, title = c.create_unicode_buffer(256), c.create_unicode_buffer(1024)
            user.GetClassNameW(hwnd, name, len(name))
            user.GetWindowTextW(hwnd, title, len(title))
            found.append({"hwnd": hwnd, "class": name.value, "title": title.value})
        return True

    if parent:
        user.EnumChildWindows(parent, visit, 0)
    else:
        user.EnumWindows(visit, 0)
    return found


def command(hwnd, text):
    buf = c.create_unicode_buffer(text)
    data = CopyData(0x44646557, c.sizeof(buf), c.cast(buf, c.c_void_p))
    result = c.c_size_t()
    ok = user.SendMessageTimeoutW(hwnd, 0x4A, 0, c.addressof(data), 2, 1000, c.byref(result))
    return bool(ok and result.value)


def screenshot(hwnd, path):
    rect = w.RECT()
    user.GetClientRect(hwnd, c.byref(rect))
    width, height = rect.right, rect.bottom
    dc = user.GetDC(hwnd)
    memory_dc = gdi.CreateCompatibleDC(dc)
    bitmap = gdi.CreateCompatibleBitmap(dc, width, height)
    old = gdi.SelectObject(memory_dc, bitmap)
    try:
        if not user.PrintWindow(hwnd, memory_dc, 3):
            raise RuntimeError("PrintWindow failed")
        gdi.SelectObject(memory_dc, old)
        header = struct.pack("<IiiHHIIiiII", 40, width, -height, 1, 32, 0, width*height*4, 0, 0, 0, 0)
        pixels = c.create_string_buffer(width*height*4)
        info = c.create_string_buffer(header + bytes(16))
        if not gdi.GetDIBits(memory_dc, bitmap, 0, height, pixels, info, 0):
            raise RuntimeError("GetDIBits failed")
        raw = pixels.raw
        rgb = bytearray(width*height*3)
        rgb[0::3], rgb[1::3], rgb[2::3] = raw[2::4], raw[1::4], raw[0::4]
        scan = b"".join(b"\0" + rgb[y*width*3:(y+1)*width*3] for y in range(height))
        def chunk(kind, data):
            return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind+data))
        pathlib.Path(path).write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(scan)) + chunk(b"IEND", b""))
        return {"width": width, "height": height, "dpi": user.GetDpiForWindow(hwnd)}
    finally:
        gdi.SelectObject(memory_dc, old)
        gdi.DeleteObject(bitmap)
        gdi.DeleteDC(memory_dc)
        user.ReleaseDC(hwnd, dc)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", required=True)
    parser.add_argument("--file", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--mode", choices=["bench", "ui"], default="bench")
    parser.add_argument("--pages", default="1")
    parser.add_argument("--page-count", type=int)
    parser.add_argument("--steps", type=int, default=60)
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--screenshot")
    args = parser.parse_args()
    if args.steps < 2 or args.steps % 2:
        parser.error("--steps must be an even number >= 2")
    if args.mode == "ui" and not args.page_count:
        parser.error("--page-count is required for UI mode")
    source = pathlib.Path(args.file).resolve(strict=True)
    before = source.stat()
    profile = pathlib.Path(tempfile.mkdtemp(prefix="sumatra-profile-"))
    (profile / "SumatraPDF-settings.txt").write_text(
        "CheckForUpdates = false\nRememberOpenedFiles = false\nRememberStatePerDocument = false\n"
        "ShowToc = false\nUseTabs = false\nDefaultZoom = 75\nDefaultDisplayMode = continuous\n",
        encoding="utf-8",
    )
    argv = [str(pathlib.Path(args.exe).resolve(strict=True)), "-appdata", str(profile)]
    if args.mode == "bench":
        argv += ["-bench", str(source), args.pages]
    else:
        argv += ["-new-window", "-view", "continuous", "-zoom", "75", str(source)]
    result = {"application": "SumatraPDF", "mode": args.mode, "fileBytes": before.st_size,
              "profile": str(profile), "steps": args.steps, "samples": [],
              "pageCount": args.page_count, "zoomVirtualPercent": 75 if args.mode == "ui" else None}
    started = time.perf_counter()
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = 4 if args.mode == "ui" else 0
    log = tempfile.TemporaryFile()
    process = subprocess.Popen(argv, stdout=log, stderr=subprocess.STDOUT, startupinfo=startup)
    handle = kernel.OpenProcess(0x410, False, process.pid)
    if not handle:
        process.terminate()
        raise c.WinError(c.get_last_error())
    stop = threading.Event()
    budget = threading.Event()

    def sample(phase):
        mem = Memory()
        mem.cb = c.sizeof(mem)
        if not psapi.GetProcessMemoryInfo(handle, c.byref(mem), c.sizeof(mem)):
            return None
        row = {"phase": phase, "elapsedMs": round((time.perf_counter()-started)*1000),
               "privateBytes": mem.PrivateUsage, "workingSetBytes": mem.WorkingSetSize,
               "osPeakPrivateBytes": mem.PeakPagefileUsage, "osPeakWorkingSetBytes": mem.PeakWorkingSetSize}
        result["samples"].append(row)
        if mem.PrivateUsage > 3 * 1024**3:
            budget.set()
        return row

    def monitor():
        while not stop.wait(0.05):
            sample("monitor")
            if time.perf_counter()-started > args.timeout or budget.is_set():
                process.terminate()
                return

    watcher = threading.Thread(target=monitor, daemon=True)
    watcher.start()
    hwnd = None
    try:
        if args.mode == "ui":
            deadline = started + min(120, args.timeout)
            while time.perf_counter() < deadline and process.poll() is None:
                candidates = [v for v in windows(process.pid) if v["class"] == "SUMATRA_PDF_FRAME"]
                if candidates:
                    hwnd = candidates[0]["hwnd"]
                    if command(hwnd, f'[GotoPage("{source}",1)]'):
                        break
                time.sleep(0.025)
            else:
                raise RuntimeError("Document navigation did not become ready")
            result["readyMs"] = round((time.perf_counter()-started)*1000)
            result["readyCriterion"] = "document loaded and page navigation acknowledged"
            user.SetWindowPos(hwnd, None, 60, 60, 1280, 960, 0x14)
            time.sleep(0.2)
            result["window"] = windows(process.pid, hwnd)
            sample(0)
            visited = []
            for step in range(1, args.steps+1):
                progress = step*2/args.steps if step <= args.steps/2 else 2-step*2/args.steps
                page = 1 + int((args.page_count-1)*progress + 0.5)
                tick = time.perf_counter()
                ack = command(hwnd, f'[GotoPage("{source}",{page})]')
                visited.append({"step": step, "page": page, "ack": ack,
                                "commandMs": round((time.perf_counter()-tick)*1000, 3)})
                if not ack:
                    raise RuntimeError(f"Page {page} was not acknowledged")
                time.sleep(0.2)
                if step % 5 == 0:
                    row = sample(step)
                    print(json.dumps(row), flush=True)
                if budget.is_set() or process.poll() is not None:
                    raise RuntimeError("Process stopped or memory budget reached")
            result["visited"] = visited
            time.sleep(3)
            sample("settled")
            if args.screenshot:
                result["screenshot"] = screenshot(hwnd, args.screenshot)
            result["completed"] = True
            user.PostMessageW(hwnd, 0x10, 0, 0)
        process.wait(timeout=args.timeout)
        result["exitCode"] = process.returncode
    except Exception as error:
        result["failure"] = str(error)
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=10)
        stop.set()
        watcher.join(timeout=1)
        sample("exited")
        kernel.CloseHandle(handle)
        log.seek(0)
        output = log.read().decode("utf-8", errors="replace")
        log.close()
        version = re.search(r"\bver ([\d.]+)", output)
        result["version"] = version[1] if version else None
        # The application logs local filenames. Keep that text beside the private result.
        log_path = pathlib.Path(args.out).resolve().with_suffix(".log")
        log_path.write_text(output, encoding="utf-8")
        result["log"] = str(log_path)
        if args.mode == "bench":
            load = re.search(r"^load: ([\d.]+) ms", output, re.M)
            count = re.search(r"^page count: (\d+)", output, re.M)
            finished = re.search(r"^Finished \(in ([\d.]+) ms\)", output, re.M)
            result["loadMs"] = float(load[1]) if load else None
            result["pageCount"] = int(count[1]) if count else None
            result["engineTotalMs"] = float(finished[1]) if finished else None
            result["rendered"] = [{"page": int(p), "ms": float(t)} for p,t in re.findall(r"^pagerender\s+(\d+): ([\d.]+) ms", output, re.M)]
            result["completed"] = bool(finished and result["rendered"] and "Error:" not in output)
        rows = result["samples"]
        result["peakPrivateBytes"] = max((x["osPeakPrivateBytes"] for x in rows), default=0)
        result["sampledPeakPrivateBytes"] = max((x["privateBytes"] for x in rows), default=0)
        result["wallMs"] = round((time.perf_counter()-started)*1000)
        after = source.stat()
        result["inputUnchanged"] = (before.st_size, before.st_mtime_ns) == (after.st_size, after.st_mtime_ns)
        pathlib.Path(args.out).resolve().write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({k:v for k,v in result.items() if k not in ("samples", "window", "visited", "rendered")}, ensure_ascii=True))
    return 0 if result.get("completed") else 1


if __name__ == "__main__":
    raise SystemExit(main())
