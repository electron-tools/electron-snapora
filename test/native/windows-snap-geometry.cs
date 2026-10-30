// Regression entry compiled only in tests, sharing the actual worker geometry policy.
using System;
using System.Windows;
using System.Windows.Automation;

internal static class GeometryTests {
    private static void Check(string raw, string parent, ControlType role, bool expected) {
        if (Snapora.WindowsSnapshot.IsDisplacedSurface(Rect.Parse(raw), Rect.Parse(parent), role) != expected)
            throw new Exception("Unexpected bounds policy: " + raw);
    }
    private static void Main() {
        Check("0,0,2304,1298", "449,327,2304,1298", ControlType.Document, true);
        Check("0,0,1985,1170", "360,435,1985,1170", ControlType.Pane, true);
        Check("360,435,1985,1170", "360,435,1985,1170", ControlType.Document, false);
        Check("449,327,2304,1298", "900,327,2304,1298", ControlType.Pane, true);
        Check("3582,923,1239,1005", "3454,753,1239,1005", ControlType.Document, true);
        Check("449,327,2304,1298", "449,327,2304,1298", ControlType.Document, false);
        Check("449,327,2304,1298", "447,327,2307,1299", ControlType.Pane, false);
        Check("-997,100,1000,800", "-1000,100,1000,800", ControlType.Pane, false);
        Check("900,399,1200,1000", "449,327,2304,1298", ControlType.Pane, false);
        Check("0,-500,1000,1600", "0,0,1000,800", ControlType.Document, false);
        Check("0,0,1000,800", "0,40,1000,760", ControlType.Group, false);
        Check("Empty", "0,0,1000,800", ControlType.Pane, false);
        Console.WriteLine("native bounds checks passed");
    }
}
