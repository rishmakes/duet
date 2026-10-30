# Pack the Windows build into a Microsoft Store package (.msix), after `tauri build` has run.
# The Store signs the package itself, so this one is left unsigned.
#   pwsh scripts/store-msix.ps1 -Version 0.13.1 -Out Duet.msix
# With -Register it is installed on this PC for a check instead (needs Developer Mode, no signing).
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Out = "Duet.msix",
  [switch]$Register
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$built = Join-Path $root "src-tauri\target\release"
$stage = Join-Path $built "msix"

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage, (Join-Path $stage "Assets") | Out-Null

# the program, ffmpeg beside it, and what they carry
Copy-Item (Join-Path $built "duet-app.exe") $stage
$ffmpeg = Get-ChildItem $built -Filter "ffmpeg*.exe" | Select-Object -First 1
if (-not $ffmpeg) { throw "ffmpeg was not found next to duet-app.exe." }
Copy-Item $ffmpeg.FullName (Join-Path $stage "ffmpeg.exe")
Get-ChildItem $built -Filter "*.dll" | Copy-Item -Destination $stage
$licences = Join-Path $built "ffmpeg-licences"
if (Test-Path $licences) { Copy-Item $licences $stage -Recurse }

$icons = Join-Path $root "src-tauri\icons"
foreach ($n in "StoreLogo", "Square44x44Logo", "Square150x150Logo") {
  Copy-Item (Join-Path $icons "$n.png") (Join-Path $stage "Assets\$n.png")
}

# the Store wants four numbers; the last is always 0
$four = ($Version -replace '^v', '') + ".0"
(Get-Content (Join-Path $root "src-tauri\store\AppxManifest.xml") -Raw).Replace("__VERSION__", $four) |
  Set-Content (Join-Path $stage "AppxManifest.xml") -Encoding UTF8

if ($Register) {
  Add-AppxPackage -Register (Join-Path $stage "AppxManifest.xml")
  Write-Output "Installed from $stage"
  exit 0
}

$kits = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
$makeappx = Get-ChildItem $kits -Recurse -Filter makeappx.exe | Where-Object { $_.FullName -like "*\x64\*" } | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $makeappx) { throw "makeappx.exe was not found. Install the Windows SDK." }
& $makeappx.FullName pack /o /d $stage /p (Join-Path $root $Out)
if ($LASTEXITCODE -ne 0) { throw "makeappx could not pack Duet." }
Write-Output "Packed $Out"
