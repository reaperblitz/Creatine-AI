[CmdletBinding()]
param(
    [Alias('v')]
    [string]$Version,

    [Alias('b')]
    [string]$Binary,

    [switch]$NoModifyPath,

    [Alias('h')]
    [switch]$Help
)

$ErrorActionPreference = 'Stop'

if ($Help) {
    Write-Host @"
Creatine Installer (Windows PowerShell)

Usage: install.ps1 [-Version <version>] [-Binary <path>] [-NoModifyPath]

Options:
    -h, -Help               Display this help message
    -v, -Version <version>  Install a specific version (e.g., 1.4)
    -b, -Binary <path>     Install from a local binary instead of downloading
    -NoModifyPath           Don't modify system/user PATH environment variable

Examples:
    irm https://creatine.puter.site/install.ps1 | iex
    .\install.ps1 -Version 1.4
    .\install.ps1 -Binary .\path\to\creatine.exe
"@
    exit 0
}

# ANSI Escape Sequences for Terminal Colors
$e = [char]27
$MUTED  = "$e[0;2m"
$RED    = "$e[0;31m"
$ORANGE = "$e[38;5;214m"
$NC     = "$e[0m"

$INSTALL_DIR = Join-Path $env:USERPROFILE ".creatine\bin"
if (-not (Test-Path $INSTALL_DIR)) {
    New-Item -ItemType Directory -Force -Path $INSTALL_DIR | Out-Null
}

if ($Binary) {
    if (-not (Test-Path $Binary)) {
        Write-Host "${RED}Error: Binary not found at $Binary${NC}"
        exit 1
    }
    $specificVersion = "local"
    Write-Host "`n${MUTED}Installing ${NC}creatine${MUTED}from: ${NC}$Binary"
    Copy-Item -Path $Binary -Destination (Join-Path$INSTALL_DIR "creatine.exe") -Force
} else {
    # System Architecture Detection
    $arch = "x64"
    if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64" -or $env:PROCESSOR_ARCHITEW6432 -eq "ARM64") {
        $arch = "arm64"
    }

    # Check for AVX2 support on x64
    $needsBaseline =$false
    if ($arch -eq "x64") {
        try {
            $psDef = '[DllImport("kernel32.dll")] public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);'
            $type = Add-Type -MemberDefinition$psDef -Name "Kernel32Helper" -Namespace "Win32" -PassThru
            if (-not ($type::IsProcessorFeaturePresent(40))) {
                $needsBaseline =$true
            }
        } catch {
            $needsBaseline =$false
        }
    }

    $target = "windows-$arch"
    if ($needsBaseline) {$target += "-baseline" }
    $filename = "creatine-$target.zip"

    # Fetch Version Information
    if (-not $Version) {
        try {
            $latestRelease = Invoke-RestMethod -Uri "https://api.github.com/repos/reaperblitz/Creatine-AI/releases/latest" -Headers @{ "User-Agent" = "PowerShell-Installer" }
            $specificVersion =$latestRelease.tag_name -replace '^v', ''
            $url = "https://github.com/reaperblitz/Creatine-AI/releases/latest/download/$filename"
        } catch {
            Write-Host "${RED}Failed to fetch version information${NC}"
            exit 1
        }
    } else {
        $specificVersion = $Version -replace '^v', ''$url = "https://github.com/reaperblitz/Creatine-AI/releases/download/v$specificVersion/$filename"
    }

    # Check if requested version is already installed
    $existing = Get-Command creatine -ErrorAction SilentlyContinue
    if ($existing) {
        $installedVer = & creatine --version 2>$null
        if ($installedVer -eq$specificVersion) {
            Write-Host "${MUTED}Version ${NC}$specificVersion${MUTED} already installed${NC}"
            exit 0
        }
    }

    Write-Host "`n${MUTED}Installing ${NC}creatine ${MUTED}version: ${NC}$specificVersion"

    $tempDir = Join-Path $env:TEMP "creatine_install_$PID"
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    $zipPath = Join-Path $tempDir $filename

    try {
        Write-Host "${ORANGE}Downloading $filename...${NC}"
        Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
        Expand-Archive -Path $zipPath -DestinationPath $tempDir -Force

        $extractedExe = Get-ChildItem -Path $tempDir -Filter "creatine*.exe" -Recurse | Select-Object -First 1
        if (-not $extractedExe) {
            $extractedExe = Get-ChildItem -Path $tempDir -Filter "creatine*" -Recurse | Select-Object -First 1
        }

        if ($extractedExe) {
            Move-Item -Path $extractedExe.FullName -Destination (Join-Path $INSTALL_DIR "creatine.exe") -Force
        } else {
            Write-Host "${RED}Error: Executable not found inside archive${NC}"
            exit 1
        }
    } finally {
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Add $INSTALL_DIR to User PATH
if (-not $NoModifyPath) {
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $pathParts = $userPath -split ';'
    if ($pathParts -notcontains $INSTALL_DIR) {
        $newPath = "$userPath;$INSTALL_DIR"
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        $env:Path = "$env:Path;$INSTALL_DIR"
        Write-Host "${MUTED}Successfully added ${NC}creatine ${MUTED}to User `$PATH${NC}"
    } else {
        Write-Host "Directory already in User PATH, skipping."
    }
}

# Display Success Logo and Completion Message
Write-Host ""
Write-Host "${MUTED}${NC}         ▄     "
Write-Host "${MUTED}▄▄▄█ █▀▀█ █▀▀▀ █▀▀█ ${NC}▀█▀ ▀█▀ █▀▀▄ █▀▀▀"
Write-Host "${MUTED}█    █ ▀▀ █▀▀  █▀▀█ ${NC}█   █   █  █ █▀▀ "
Write-Host "${MUTED}▀▄▄▄ ▀ ▀▀ ▀▀▀▀ ▀  ▀ ${NC}▀   ▀▀▀ ▀  ▀ ▀▀▀▀"
Write-Host ""
Write-Host "${MUTED}Creatine includes free models, to start:${NC}"
Write-Host ""
Write-Host "cd <project>  ${MUTED}# Open directory${NC}"
Write-Host "creatine      ${MUTED}# Run command${NC}"
Write-Host ""
Write-Host "${MUTED}For more information visit${NC}https://creatine.puter.site"
Write-Host ""