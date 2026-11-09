# Create the first OWNER of the real workspace (ADR-021) with PowerShell's own masked password prompt.
# The password stays in this process's memory: it is handed to the bootstrap CLI through a process-only environment variable that is
# removed afterwards. It is never echoed, written to a file, a log or the command history.
#   & .\otsi-vie\tools\dev\bootstrap-owner.ps1 -Email you@example.com -Name "Your Name" -Organization "Your Club"
param(
    [Parameter(Mandatory = $true)][string]$Email,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Organization
)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$first = Read-Host -AsSecureString 'Password (at least 12 characters)'
$second = Read-Host -AsSecureString 'Repeat the password'
$plain = [System.Net.NetworkCredential]::new('', $first).Password
if ($plain -ne [System.Net.NetworkCredential]::new('', $second).Password) { Write-Host 'The passwords differ. Nothing was created.'; exit 2 }
if ($plain.Length -lt 12) { Write-Host 'The password is shorter than 12 characters. Nothing was created.'; exit 2 }
$env:OTSI_VIE_BOOTSTRAP_PASSWORD = $plain
try {
    & (Join-Path $root '.venv\Scripts\python.exe') (Join-Path $root 'otsi-vie\tools\dev\local_stack.py') bootstrap-owner --email $Email --name $Name --organization $Organization
} finally {
    Remove-Item Env:OTSI_VIE_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
    $plain = $null
}
