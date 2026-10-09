$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
$cargo = Join-Path $cargoBin "cargo.exe"
$targetDir = Join-Path $env:USERPROFILE ".cargo\target\prompt-clip-portable"
$builtApp = Join-Path $targetDir "release\prompt-clip.exe"
$releaseDir = Join-Path $projectRoot "release"
$releaseApp = Join-Path $releaseDir "Prompt Clip.exe"

if (-not (Test-Path $cargo)) {
  throw "Rust Cargo was not found at $cargo. Install Rust before building."
}

$env:PATH = "$cargoBin;$env:PATH"
$env:CARGO_TARGET_DIR = $targetDir

Push-Location $projectRoot
try {
  npm run tauri -- build --no-bundle
  if ($LASTEXITCODE -ne 0) {
    throw "Windows app build failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}

if (-not (Test-Path $builtApp)) {
  throw "The built executable was not found at $builtApp."
}

New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
Copy-Item -LiteralPath $builtApp -Destination $releaseApp -Force
Write-Output "Single-file app created at $releaseApp"
