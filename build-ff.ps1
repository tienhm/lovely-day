param([string]$Src, [string]$Dst)
Add-Type -Assembly 'System.IO.Compression'
Add-Type -Assembly 'System.IO.Compression.FileSystem'
$src = (Resolve-Path $Src).Path
$zip = [System.IO.Compression.ZipFile]::Open($Dst, 'Create')
Get-ChildItem -Recurse -File $src | ForEach-Object {
    $rel = $_.FullName.Substring($src.Length + 1).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel) | Out-Null
}
$zip.Dispose()
