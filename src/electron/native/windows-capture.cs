// Isolated screen-copy worker: physical monitor bounds in, cursor-free PNG out.
// Never changes global cursor state or reads accessibility/application content.
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

internal static class WindowsCapture {
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct MonitorInfo { public int Size; public Rect Bounds, WorkArea; public uint Flags; }
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromPoint(Point point, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr window, IntPtr dc);
    [DllImport("gdi32.dll", SetLastError = true)] private static extern bool BitBlt(
        IntPtr dest, int x, int y, int width, int height, IntPtr source, int sourceX, int sourceY, uint operation);

    private static void Main() {
        if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) return;
        Console.WriteLine("ready");
        string request;
        while ((request = Console.ReadLine()) != null) {
            try {
                var p = Array.ConvertAll(request.Split('|'), int.Parse);
                if (p.Length != 4 || p[2] <= 0 || p[3] <= 0 || (long)p[2] * p[3] > 128L * 1024 * 1024)
                    throw new ArgumentException("Invalid capture bounds");
                // Electron rounds display DIP sizes (e.g. 3200 / 1.5). Use the native
                // monitor rectangle so rounding never copies a neighbouring pixel row/column.
                var monitor = MonitorFromPoint(new Point { X = p[0] + p[2] / 2, Y = p[1] + p[3] / 2 }, 0);
                var info = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) };
                if (monitor == IntPtr.Zero || !GetMonitorInfo(monitor, ref info)) throw new InvalidOperationException("Monitor unavailable");
                var rect = info.Bounds;
                if (Math.Abs((long)rect.Left - p[0]) > 2 || Math.Abs((long)rect.Top - p[1]) > 2 ||
                    Math.Abs((long)rect.Right - rect.Left - p[2]) > 2 || Math.Abs((long)rect.Bottom - rect.Top - p[3]) > 2)
                    throw new InvalidOperationException("Monitor geometry changed");
                p[0] = rect.Left; p[1] = rect.Top; p[2] = rect.Right - rect.Left; p[3] = rect.Bottom - rect.Top;
                using (var bitmap = new Bitmap(p[2], p[3], PixelFormat.Format32bppRgb)) {
                    using (var graphics = Graphics.FromImage(bitmap)) {
                        var source = GetDC(IntPtr.Zero);
                        if (source == IntPtr.Zero) throw new InvalidOperationException("GetDC failed");
                        try {
                            var dest = graphics.GetHdc();
                            try {
                                // SRCCOPY | CAPTUREBLT includes ordinary layered windows, while DWM
                                // excludes WDA_EXCLUDEFROMCAPTURE windows. No cursor is drawn here.
                                if (!BitBlt(dest, 0, 0, p[2], p[3], source, p[0], p[1], 0x40CC0020))
                                    throw new InvalidOperationException("BitBlt failed: " + Marshal.GetLastWin32Error());
                            } finally { graphics.ReleaseHdc(dest); }
                        } finally { ReleaseDC(IntPtr.Zero, source); }
                    }
                    using (var png = new MemoryStream()) {
                        bitmap.Save(png, ImageFormat.Png);
                        Console.WriteLine(Convert.ToBase64String(png.ToArray()));
                    }
                }
            } catch (Exception) {
                // Keep protocol errors bounded; don't emit desktop data or machine paths to stderr.
                Console.WriteLine("error");
            }
        }
    }
}
