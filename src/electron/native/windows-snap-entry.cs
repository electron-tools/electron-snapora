// Precompiled UIA process entry. stdout remains the existing JSON-lines protocol.
using System;

namespace Snapora {
    internal static class WindowsSnapEntry {
        [MTAThread]
        private static int Main(string[] args) {
            if (args.Length == 1 && args[0] == "--server") {
                WindowsSnapshot.Serve(1800);
                return 0;
            }
            if (args.Length == 2 && args[0] == "--snapshot" &&
                (args[1] == "window" || args[1] == "panel" || args[1] == "fine")) {
                WindowsSnapshot.Run(1800, args[1] == "window");
                return 0;
            }
            Console.Error.WriteLine("Expected --server or --snapshot window|panel|fine.");
            return 2;
        }
    }
}
