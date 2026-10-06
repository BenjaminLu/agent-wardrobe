// Windows counterpart of native-input.swift: mouse and keyboard through user32 SendInput.
// Built by scripts/build-native.cjs with the .NET Framework 4 csc.exe, so it stays C# 5.
// computer-input.cjs translates the JSON actions into argv: [--focus HWND] move|click|drag|scroll|type|key|position|frontmost|preflight ...
// Coordinates are physical pixels: the process opts into per-monitor DPI awareness before touching the cursor.
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class NativeInput {
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);

    const uint MOUSE = 0, KEYBOARD = 1;
    const uint KEYUP = 0x2, UNICODE = 0x4, EXTENDED = 0x1, WHEEL = 0x800, HWHEEL = 0x1000, MOVE = 0x1, ABSOLUTE = 0x8000, VIRTUALDESK = 0x4000;

    static int Fail(string message) { Console.Error.Write(message); return 1; }
    static void Send(INPUT[] inputs) {
        if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) != inputs.Length)
            throw new Exception("SendInput was blocked (error " + Marshal.GetLastWin32Error() + "); a higher-integrity window may be in front.");
        Thread.Sleep(20);
    }
    static INPUT Mouse(uint flags, int data) { INPUT i = new INPUT(); i.type = MOUSE; i.u.mi.dwFlags = flags; i.u.mi.mouseData = unchecked((uint)data); return i; }
    static INPUT Key(ushort vk, ushort scan, uint flags) { INPUT i = new INPUT(); i.type = KEYBOARD; i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags; return i; }
    static void Tap(ushort vk, bool extended) { uint e = extended ? EXTENDED : 0; Send(new INPUT[] { Key(vk, 0, e), Key(vk, 0, e | KEYUP) }); }
    // A real (absolute, virtual-desktop) mouse move through SendInput, so apps see the drag; SetCursorPos then fixes any rounding pixel.
    static void Move(int x, int y) {
        int left = GetSystemMetrics(76), top = GetSystemMetrics(77), width = Math.Max(2, GetSystemMetrics(78)), height = Math.Max(2, GetSystemMetrics(79));
        INPUT move = Mouse(MOVE | ABSOLUTE | VIRTUALDESK, 0);
        move.u.mi.dx = (int)Math.Round((x - left) * 65535.0 / (width - 1)); move.u.mi.dy = (int)Math.Round((y - top) * 65535.0 / (height - 1));
        Send(new INPUT[] { move });
        POINT p; GetCursorPos(out p);
        if ((p.X != x || p.Y != y) && !SetCursorPos(x, y)) throw new Exception("Could not move the pointer");
    }
    static void Button(string button, bool down) {
        uint flag = button == "right" ? 0x8u : button == "middle" ? 0x20u : 0x2u;
        Send(new INPUT[] { Mouse(down ? flag : flag << 1, 0) });
    }
    static void Focus(IntPtr hwnd) {
        if (!IsWindow(hwnd)) throw new Exception("Observed app is no longer available");
        IntPtr front = GetForegroundWindow();
        if (front == hwnd) return;
        if (IsIconic(hwnd)) ShowWindow(hwnd, 9);
        // Windows only lets the foreground thread hand focus over, so borrow its input state for the switch.
        uint pid; uint other = GetWindowThreadProcessId(front, out pid), me = GetCurrentThreadId();
        bool attached = other != 0 && other != me && AttachThreadInput(me, other, true);
        BringWindowToTop(hwnd); SetForegroundWindow(hwnd);
        if (attached) AttachThreadInput(me, other, false);
        Thread.Sleep(150);
    }

    static int Main(string[] args) {
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { SetProcessDPIAware(); }
        try {
            int at = 0;
            if (args.Length > 1 && args[0] == "--focus") { Focus(new IntPtr(long.Parse(args[1]))); at = 2; }
            if (args.Length <= at) return Fail("Invalid input");
            string action = args[at];
            Func<int, int> num = delegate(int k) { return int.Parse(args[at + k]); };
            switch (action) {
                case "preflight": Console.Write("{\"ok\":true,\"dpiAware\":true}"); return 0;
                case "position": { POINT p; GetCursorPos(out p); Console.Write("{\"x\":" + p.X + ",\"y\":" + p.Y + "}"); return 0; }
                case "frontmost": {
                    IntPtr hwnd = GetForegroundWindow(); uint pid; GetWindowThreadProcessId(hwnd, out pid);
                    Console.Write("{\"pid\":" + pid + ",\"window\":" + hwnd.ToInt64() + "}"); return 0;
                }
                case "move": Move(num(1), num(2)); break;
                case "click": {
                    Move(num(1), num(2)); string button = args[at + 3]; int count = num(4);
                    for (int i = 0; i < count; i++) { Button(button, true); Button(button, false); }
                    break;
                }
                case "drag": {
                    int x = num(1), y = num(2), tx = num(3), ty = num(4);
                    Move(x, y); Button("left", true); Thread.Sleep(50);
                    for (int i = 1; i <= 8; i++) { Move(x + (tx - x) * i / 8, y + (ty - y) * i / 8); Thread.Sleep(15); }
                    Thread.Sleep(50); Button("left", false); break;
                }
                case "scroll": {
                    int dx = num(1), dy = num(2);
                    if (dy != 0) Send(new INPUT[] { Mouse(WHEEL, dy) });
                    if (dx != 0) Send(new INPUT[] { Mouse(HWHEEL, dx) });
                    break;
                }
                case "type": {
                    string text = Encoding.UTF8.GetString(Convert.FromBase64String(args[at + 1]));
                    foreach (char c in text) {
                        // A Unicode packet for \n arrives as Ctrl+J in many apps; press the real keys instead.
                        if (c == '\r') continue;
                        if (c == '\n') { Tap(0x0D, false); continue; }
                        if (c == '\t') { Tap(0x09, false); continue; }
                        Send(new INPUT[] { Key(0, c, UNICODE), Key(0, c, UNICODE | KEYUP) });
                    }
                    break;
                }
                case "key": {
                    ushort vk = (ushort)num(1); bool extended = args[at + 2] == "1";
                    string[] mods = args[at + 3] == "-" ? new string[0] : args[at + 3].Split(',');
                    int pressed = 0;
                    try { foreach (string m in mods) { Send(new INPUT[] { Key((ushort)int.Parse(m), 0, 0) }); pressed++; } Tap(vk, extended); }
                    finally { for (int i = pressed - 1; i >= 0; i--) SendInput(1, new INPUT[] { Key((ushort)int.Parse(mods[i]), 0, KEYUP) }, Marshal.SizeOf(typeof(INPUT))); }
                    break;
                }
                default: return Fail("Unsupported action");
            }
            Console.Write("{\"ok\":true}");
            return 0;
        } catch (Exception error) { return Fail(error.Message); }
    }
}
