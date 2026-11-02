param(
    [string]$ProjectRoot = '',
    [string]$ShortcutPath = ''
)

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Split-Path -Parent $PSScriptRoot
}
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
$wrapperPath = Join-Path $ProjectRoot 'scripts\launch-windows.ps1'
if (-not (Test-Path -LiteralPath $wrapperPath -PathType Leaf)) {
    throw "未找到启动脚本：$wrapperPath"
}

if ([string]::IsNullOrWhiteSpace($ShortcutPath)) {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $ShortcutPath = Join-Path $desktop '智游足迹.lnk'
}
$ShortcutPath = [System.IO.Path]::GetFullPath($ShortcutPath)

$edgeCandidates = @(@(
    $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe' }),
    $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe' }),
    $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe' })
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) })
if ($edgeCandidates.Count -eq 0) {
    throw '未找到 Microsoft Edge，无法创建智游足迹快捷方式。'
}

$windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $windowsPowerShell -PathType Leaf)) {
    throw '未找到 Windows PowerShell，无法创建快捷方式。'
}

$shortcutDirectory = Split-Path -Parent $ShortcutPath
if (-not (Test-Path -LiteralPath $shortcutDirectory -PathType Container)) {
    [void](New-Item -ItemType Directory -Path $shortcutDirectory)
}
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = $windowsPowerShell
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$wrapperPath`""
$shortcut.WorkingDirectory = $ProjectRoot
$shortcut.IconLocation = "$($edgeCandidates[0]),0"
$shortcut.Description = '启动智游足迹；关闭应用窗口后自动停止本机服务'
$shortcut.Save()
Write-Output $ShortcutPath
