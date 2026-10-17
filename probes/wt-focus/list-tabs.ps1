# Lists all Windows Terminal windows and their tabs via UI Automation.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]
$winCond = New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, "CASCADIA_HOSTING_WINDOW_CLASS")
$tabCond = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
$sw = [Diagnostics.Stopwatch]::StartNew()
foreach ($w in $A::RootElement.FindAll($scope::Children, $winCond)) {
  "window $($w.Current.NativeWindowHandle) '$($w.Current.Name)'"
  foreach ($t in $w.FindAll($scope::Descendants, $tabCond)) {
    $sel = $t.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected
    "  tab '$($t.Current.Name)' selected=$sel automationId='$($t.Current.AutomationId)'"
  }
}
"elapsed $($sw.ElapsedMilliseconds) ms"
