# Read-only prototype worker. Keep UIA in a disposable MTA process, outside Electron.
param([int]$BudgetMs = 1800, [ValidateSet('window', 'panel', 'fine')][string]$Granularity = 'panel', [switch]$Server)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
Add-Type -Path (Join-Path $PSScriptRoot 'windows-snap.cs') -ReferencedAssemblies @(
    [System.Windows.Automation.AutomationElement].Assembly.Location,
    [System.Windows.Automation.ControlType].Assembly.Location,
    [System.Windows.Rect].Assembly.Location
)
if ($Server) {
    [Snapora.WindowsSnapshot]::Serve($BudgetMs)
} else {
    [Snapora.WindowsSnapshot]::Run($BudgetMs, $Granularity -eq 'window')
}
