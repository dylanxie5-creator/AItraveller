$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
    Add-Type -AssemblyName System.Security
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    if ($request.value -isnot [string] -or $request.value.Length -eq 0) { throw 'Invalid input' }
    if ($request.operation -eq 'protect') {
        $plainBytes = [System.Text.Encoding]::UTF8.GetBytes($request.value)
        $protectedBytes = [System.Security.Cryptography.ProtectedData]::Protect($plainBytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
        $result = [Convert]::ToBase64String($protectedBytes)
    } elseif ($request.operation -eq 'unprotect') {
        $protectedBytes = [Convert]::FromBase64String($request.value)
        $plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect($protectedBytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
        $result = [System.Text.UTF8Encoding]::new($false, $true).GetString($plainBytes)
    } else { throw 'Invalid operation' }
    [Console]::Out.WriteLine((@{result=$result} | ConvertTo-Json -Compress))
} catch {
    # Never emit system exception details, request bodies, or credentials.
    [Console]::Out.WriteLine('{"error":"AI_CREDENTIALS_UNAVAILABLE"}')
    exit 1
}
