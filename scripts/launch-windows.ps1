param(
    [string]$NodePath = '',
    [string]$LauncherPath = '',
    [switch]$NoPopup
)

$projectRoot = Split-Path -Parent $PSScriptRoot
$logPath = Join-Path $projectRoot 'runtime\launcher.log'

function Show-LauncherFailure([string]$message) {
    if ($NoPopup) { return }
    $shell = New-Object -ComObject WScript.Shell
    [void]$shell.Popup("$message`n`n诊断记录：$logPath", 0, '智游足迹', 0x10)
}

if ([string]::IsNullOrWhiteSpace($NodePath)) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($null -ne $nodeCommand) { $NodePath = $nodeCommand.Source }
}
if ([string]::IsNullOrWhiteSpace($LauncherPath)) {
    $LauncherPath = Join-Path $PSScriptRoot 'windows-desktop-launcher.mjs'
}

if ([string]::IsNullOrWhiteSpace($NodePath) -or -not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
    Show-LauncherFailure '未找到 Node.js，无法启动网站。请安装 Node.js 25.9.0 或更高版本。'
    exit 10
}
if (-not (Test-Path -LiteralPath $LauncherPath -PathType Leaf)) {
    Show-LauncherFailure '启动文件不完整，请检查智游足迹项目目录。'
    exit 11
}

& $NodePath $LauncherPath
$launcherExit = $LASTEXITCODE
if ($launcherExit -eq 2) {
    Show-LauncherFailure '智游足迹可能已经运行，或者本机端口已被占用。'
}
elseif ($launcherExit -ne 0) {
    Show-LauncherFailure '智游足迹未能启动或未能正常关闭。'
}
exit $launcherExit
