param(
    [Parameter(Mandatory = $true)][string]$Pdf,
    [Parameter(Mandatory = $true)][string]$Epub,
    [Parameter(Mandatory = $true)][string]$SumatraExe,
    [Parameter(Mandatory = $true)][string]$OutDir,
    [int]$Repeats = 3,
    [int]$PdfPages = 474,
    [int]$EpubPages = 12078,
    [switch]$Resume
)

# Fresh application profiles, unchanged documents, sequential runs, warm OS file cache.
# Build apps/pdf, apps/epub and apps/shell before invoking this script.
$ErrorActionPreference = 'Stop'
$profileRepo = Split-Path -Parent $PSScriptRoot
$profileOutput = [System.IO.Path]::GetFullPath($OutDir)
New-Item -ItemType Directory -Force -Path $profileOutput | Out-Null
Set-Location -LiteralPath $profileRepo

for ($profileRun = 1; $profileRun -le $Repeats; $profileRun++) {
    Write-Output "Starting repetition $profileRun/${Repeats}: Sumatra PDF"
    $profileReport = Join-Path $profileOutput "sumatra-pdf-ui-run$profileRun.json"
    $profileArgs = @('tools/profile-sumatra.py', '--exe', $SumatraExe, '--file', $Pdf,
        '--out', $profileReport,
        '--mode', 'ui', '--page-count', $PdfPages, '--steps', '60', '--timeout', '120')
    if ($profileRun -eq 1) { $profileArgs += @('--screenshot', (Join-Path $profileOutput 'sumatra-pdf.png')) }
    if (-not ($Resume -and (Test-Path -LiteralPath $profileReport))) {
        & python @profileArgs
        if ($LASTEXITCODE -ne 0) { Write-Warning 'Sumatra PDF profiler failed; preserve the report and continue' }
    }

    Write-Output "Starting repetition $profileRun/${Repeats}: IeumOffice PDF"
    $profileReport = Join-Path $profileOutput "ieum-pdf-ui-run$profileRun.json"
    if (-not ($Resume -and (Test-Path -LiteralPath $profileReport))) {
        & node tools/profile-pdf-scroll.mjs --file $Pdf --out $profileReport --shell --exact-pages --steps 60
        if ($LASTEXITCODE -ne 0) { Write-Warning 'PDF profiler failed; preserve the report and continue' }
    }

    Write-Output "Starting repetition $profileRun/${Repeats}: Sumatra EPUB"
    $profileReport = Join-Path $profileOutput "sumatra-epub-ui-run$profileRun.json"
    $profileArgs = @('tools/profile-sumatra.py', '--exe', $SumatraExe, '--file', $Epub,
        '--out', $profileReport,
        '--mode', 'ui', '--page-count', $EpubPages, '--steps', '60', '--timeout', '120')
    if ($profileRun -eq 1) { $profileArgs += @('--screenshot', (Join-Path $profileOutput 'sumatra-epub.png')) }
    if (-not ($Resume -and (Test-Path -LiteralPath $profileReport))) {
        & python @profileArgs
        if ($LASTEXITCODE -ne 0) { Write-Warning 'Sumatra EPUB profiler failed; preserve the report and continue' }
    }

    Write-Output "Starting repetition $profileRun/${Repeats}: IeumOffice EPUB"
    $profileReport = Join-Path $profileOutput "ieum-epub-ui-run$profileRun.json"
    if (-not ($Resume -and (Test-Path -LiteralPath $profileReport))) {
        & node tools/profile-epub-scroll.mjs --file $Epub --out $profileReport --shell --steps 60
        if ($LASTEXITCODE -ne 0) { Write-Warning 'EPUB profiler failed; preserve the report and continue' }
    }
}
