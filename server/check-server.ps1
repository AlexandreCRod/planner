# Checks that the deployed sync server accepts your API_TOKEN.
# The token is read as hidden input and never stored or printed.
# Usage: .\check-server.ps1 -Url https://planner-sync.<your-subdomain>.workers.dev
param([Parameter(Mandatory = $true)][string]$Url)

$secure = Read-Host "Paste your API_TOKEN (input is hidden)" -AsSecureString
$token = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))

try {
    $status = Invoke-RestMethod -Uri "$Url/api/status" -Headers @{ Authorization = "Bearer $token" }
    Write-Host ""
    Write-Host "OK - the server accepted your password." -ForegroundColor Green
    Write-Host ("Items stored in the cloud: {0}" -f ($(if ($status.counts.items) { $status.counts.items } else { 0 })))
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Write-Host ""
    if ($code -eq 401) {
        Write-Host "Rejected (401): this is not the password saved with 'wrangler secret put API_TOKEN'." -ForegroundColor Red
    } else {
        Write-Host "Request failed: $($_.Exception.Message)" -ForegroundColor Red
    }
} finally {
    $token = $null
}
