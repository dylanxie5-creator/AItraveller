param([Parameter(Mandatory=$true)][string]$LockPath)
$ErrorActionPreference = 'Stop'
$lockStream = $null
try {
    try {
        $lockStream = [System.IO.FileStream]::new($LockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    } catch {
        $lockException = $_.Exception
        while ($null -ne $lockException.InnerException) { $lockException = $lockException.InnerException }
        if (($lockException.HResult -band 65535) -eq 32) { [Console]::Out.WriteLine('BUSY') }
        else { [Console]::Out.WriteLine('FAILED') }
        [Console]::Out.Flush()
        exit 1
    }
    [Console]::Out.WriteLine('READY')
    [Console]::Out.Flush()
    # Parent death or deliberate stdin close releases the OS handle, not the file.
    [Console]::In.ReadToEnd() | Out-Null
} finally {
    if ($null -ne $lockStream) { $lockStream.Dispose() }
}
