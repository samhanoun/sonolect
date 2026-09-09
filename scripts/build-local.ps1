param([switch]$Release)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    & npx --yes pnpm@9.15.0 --filter '@sonolect/desktop' build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    if (Test-Path 'C:\Program Files\LLVM\bin\libclang.dll') { $env:LIBCLANG_PATH = 'C:\Program Files\LLVM\bin' }
    $cargoArguments = @('build', '--locked', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml', '--features', 'tauri/custom-protocol')
    $profile = 'debug'
    if ($Release) { $cargoArguments += '--release'; $profile = 'release' }
    & cargo @cargoArguments
    if ($LASTEXITCODE -ne 0) { throw 'Native build failed.' }
    $destination = Join-Path $projectRoot 'build/Sonolect Local'
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    Copy-Item -LiteralPath (Join-Path $projectRoot "apps/desktop/src-tauri/target/$profile/sonolect_desktop.exe") -Destination (Join-Path $destination 'Sonolect.exe')
    $modelPath = Join-Path $projectRoot 'local-test/ggml-base.bin'
    if (Test-Path -LiteralPath $modelPath) {
        $expectedHash = '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe'
        if ((Get-FileHash -LiteralPath $modelPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'Model checksum mismatch.' }
        New-Item -ItemType Directory -Force -Path (Join-Path $destination 'models') | Out-Null
        Copy-Item -LiteralPath $modelPath -Destination (Join-Path $destination 'models/ggml-base.bin')
    }
    Write-Output "Local desktop build: $destination"
} finally { Pop-Location }
