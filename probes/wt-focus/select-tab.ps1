# Selects the first Windows Terminal tab whose title contains -TitleContains and brings its window to front.
param([Parameter(Mandatory)][string]$TitleContains)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class Fg {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr p);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  public static bool Bring(IntPtr h) {
    uint fg = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
    uint me = GetCurrentThreadId();
    AttachThreadInput(me, fg, true);
    ShowWindow(h, 9);
    bool ok = SetForegroundWindow(h);
    AttachThreadInput(me, fg, false);
    return ok;
  }
}
"@
$A = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]
$winCond = New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, "CASCADIA_HOSTING_WINDOW_CLASS")
$tabCond = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
$sw = [Diagnostics.Stopwatch]::StartNew()
foreach ($w in $A::RootElement.FindAll($scope::Children, $winCond)) {
  foreach ($t in $w.FindAll($scope::Descendants, $tabCond)) {
    if ($t.Current.Name -like "*$TitleContains*") {
      $t.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
      $ok = [Fg]::Bring([IntPtr]$w.Current.NativeWindowHandle)
      "selected '$($t.Current.Name)' in window $($w.Current.NativeWindowHandle); foreground=$ok; $($sw.ElapsedMilliseconds) ms"
      exit 0
    }
  }
}
"no tab matching '$TitleContains' ($($sw.ElapsedMilliseconds) ms)"
exit 1
