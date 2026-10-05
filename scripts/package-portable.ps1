$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
$cargo = Join-Path $cargoBin "cargo.exe"
$targetDir = Join-Path $env:USERPROFILE ".cargo\target\prompt-clip-portable"
$portableDir = Join-Path $projectRoot "PromptClipPortable"
$builtApp = Join-Path $targetDir "release\prompt-clip.exe"

if (-not (Test-Path $cargo)) {
  throw "Rust Cargo was not found at $cargo. Install Rust before packaging."
}

$env:PATH = "$cargoBin;$env:PATH"
$env:CARGO_TARGET_DIR = $targetDir

Push-Location $projectRoot
try {
  npm run tauri -- build --no-bundle
  if ($LASTEXITCODE -ne 0) {
    throw "Tauri portable build failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}

if (-not (Test-Path $builtApp)) {
  throw "The built executable was not found at $builtApp."
}

New-Item -ItemType Directory -Path $portableDir -Force | Out-Null
Copy-Item -LiteralPath $builtApp -Destination (Join-Path $portableDir "prompt-clip-logo.exe") -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "啟動 Prompt Clip.bat") -Destination $portableDir -Force
Write-Output "Portable app created at $portableDir"
