// Read-only, bounded UIA snapshot. No names, values, messages or document text leave this worker.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Automation;

namespace Snapora {
    public static class WindowsSnapshot {
        [StructLayout(LayoutKind.Sequential)] struct NativeRect { public int Left, Top, Right, Bottom; }
        [StructLayout(LayoutKind.Sequential)] struct Point { public int X, Y; }
        delegate bool EnumProc(IntPtr hwnd, IntPtr param);
        [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr param);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
        [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
        [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out NativeRect rect);
        [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
        [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
        [DllImport("dwmapi.dll", EntryPoint="DwmGetWindowAttribute")] static extern int GetFrame(IntPtr hwnd, int attr, out NativeRect rect, int size);
        [DllImport("dwmapi.dll", EntryPoint="DwmGetWindowAttribute")] static extern int GetCloaked(IntPtr hwnd, int attr, out int value, int size);
        sealed class Window { public IntPtr Handle; public Rect Bounds; public int Z; public uint Pid; }
        sealed class Node { public AutomationElement Element; public Rect Clip; public int Depth; }

        static void Emit(Rect rect, Window window, string kind, string controlType = "Window") {
            Console.WriteLine(string.Format(CultureInfo.InvariantCulture,
                "{{\"x\":{0},\"y\":{1},\"width\":{2},\"height\":{3},\"windowZOrder\":{4},\"processId\":{5},\"kind\":\"{6}\",\"controlType\":\"{7}\"}}",
                rect.X, rect.Y, rect.Width, rect.Height, window.Z, window.Pid, kind, controlType));
            Console.Out.Flush();
        }

        static bool IsContainer(ControlType type) {
            return type == ControlType.Pane || type == ControlType.Group ||
                type == ControlType.Document || type == ControlType.List ||
                type == ControlType.Tree || type == ControlType.DataGrid ||
                type == ControlType.Table || type == ControlType.Tab ||
                type == ControlType.Custom || type == ControlType.ListItem;
        }

        // Keep compilation/UIA initialization off the capture path. Each command takes a fresh snapshot.
        public static void Serve(int budgetMs) {
            // Initialize UIA itself during warmup; do not enumerate application content.
            var desktop = AutomationElement.RootElement;
            Console.WriteLine("{\"ready\":true}");
            Console.Out.Flush();
            string command;
            while ((command = Console.ReadLine()) != null) {
                if (command != "window" && command != "panel" && command != "fine") continue;
                Run(budgetMs, command == "window");
            }
        }

        public static void Run(int budgetMs, bool windowsOnly) {
            // UIA rectangles are physical pixels; avoid DPI virtualization in Win32 enumeration too.
            SetThreadDpiAwarenessContext(new IntPtr(-4));
            var windows = new List<Window>();
            EnumWindows(delegate(IntPtr hwnd, IntPtr unused) {
                int cloaked;
                NativeRect r;
                if (!IsWindowVisible(hwnd) || IsIconic(hwnd) ||
                    (GetCloaked(hwnd, 14, out cloaked, 4) == 0 && cloaked != 0)) return true;
                if (GetFrame(hwnd, 9, out r, 16) != 0 && !GetWindowRect(hwnd, out r)) return true;
                if (r.Right <= r.Left || r.Bottom <= r.Top) return true;
                uint pid;
                GetWindowThreadProcessId(hwnd, out pid);
                var window = new Window { Handle = hwnd, Bounds = new Rect(r.Left, r.Top, r.Right-r.Left, r.Bottom-r.Top), Z = windows.Count, Pid = pid };
                windows.Add(window);
                Emit(window.Bounds, window, "window");
                return windows.Count < 128;
            }, IntPtr.Zero);
            // Flush fallback windows before any potentially unresponsive third-party UIA call.
            Console.WriteLine("{\"windowsReady\":true}");
            Console.Out.Flush();
            if (windowsOnly) {
                Console.WriteLine("{\"done\":true,\"visited\":0}");
                Console.Out.Flush();
                return;
            }
            var watch = Stopwatch.StartNew();
            Point cursor;
            GetCursorPos(out cursor);
            var targets = new List<Window>();
            foreach (var window in windows) {
                bool covered = false;
                foreach (var front in windows) {
                    if (front.Z >= window.Z) break;
                    if (front.Bounds.Contains(window.Bounds)) { covered = true; break; }
                }
                if (!covered) targets.Add(window);
            }
            // Spend the bounded query budget on the window under the pointer first.
            targets.Sort((a,b) => {
                bool ac = a.Bounds.Contains(cursor.X, cursor.Y), bc = b.Bounds.Contains(cursor.X, cursor.Y);
                return ac == bc ? a.Z.CompareTo(b.Z) : ac ? -1 : 1;
            });
            var cache = new CacheRequest();
            // Fetch each subtree in one provider call instead of one cross-process call per sibling.
            cache.TreeScope = TreeScope.Subtree;
            cache.TreeFilter = Automation.RawViewCondition;
            cache.AutomationElementMode = AutomationElementMode.None;
            cache.Add(AutomationElement.BoundingRectangleProperty);
            cache.Add(AutomationElement.IsOffscreenProperty);
            cache.Add(AutomationElement.ControlTypeProperty);
            int visited = 0;
            foreach (var window in targets) {
                if (watch.ElapsedMilliseconds >= budgetMs) break;
                long windowStarted = watch.ElapsedMilliseconds;
                int visitedBefore = visited;
                long deadline = Math.Min(budgetMs, watch.ElapsedMilliseconds + 650);
                try {
                    var root = AutomationElement.FromHandle(window.Handle).GetUpdatedCache(cache);
                    var queue = new Queue<Node>();
                    queue.Enqueue(new Node { Element = root, Clip = window.Bounds, Depth = 0 });
                    int count = 0;
                    while (queue.Count > 0 && count < 1600 && watch.ElapsedMilliseconds < deadline) {
                        var parent = queue.Dequeue();
                        if (parent.Depth >= 24) continue;
                        foreach (AutomationElement child in parent.Element.CachedChildren) {
                            if (count++ >= 1600 || watch.ElapsedMilliseconds >= deadline) break;
                            visited++;
                            var info = child.Cached;
                            var rect = info.BoundingRectangle;
                            rect.Intersect(parent.Clip);
                            if (!info.IsOffscreen) {
                                if (!rect.IsEmpty && rect.Width >= 64 && rect.Height >= 40 && IsContainer(info.ControlType)) Emit(rect, window, "container", info.ControlType.ProgrammaticName.Replace("ControlType.", ""));
                                // Structural nodes can have empty bounds but still own visible children.
                                queue.Enqueue(new Node { Element = child, Clip = rect.IsEmpty ? parent.Clip : rect, Depth = parent.Depth + 1 });
                            }
                        }
                    }
                } catch (ElementNotAvailableException) { }
                  catch (System.Runtime.InteropServices.COMException) { }
                  catch (InvalidOperationException) { }
                Console.WriteLine("{\"windowTiming\":true,\"processId\":" + window.Pid + ",\"z\":" + window.Z + ",\"durationMs\":" + (watch.ElapsedMilliseconds-windowStarted) + ",\"visited\":" + (visited-visitedBefore) + "}");
            }
            Console.WriteLine("{\"done\":true,\"visited\":" + visited + "}");
            Console.Out.Flush();
        }
    }
}
