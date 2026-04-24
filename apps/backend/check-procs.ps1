Get-Process | Where-Object { $_.Path -like '*node*' } | Format-Table Id,Path -AutoSize
$handleOutput = & cmd /c "handle.exe dist 2>&1" | Select-Object -First 30
Write-Host "Handle output:"
$handleOutput