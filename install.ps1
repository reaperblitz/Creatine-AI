[CmdletBinding()]
param(
    [Alias('h')]
    [switch]$Help,

    [switch]$NoModifyPath
)

$ErrorActionPreference = 'Stop'

if ($Help) {
    Write-Host @"
Creatine Installer (Bun Source Mode)

Usage: install.ps1 [-NoModifyPath]

Options:
    -h, -Help        Display this help message
    -NoModifyPath    Don't modify system/user PATH environment variable

Examples:
    irm https://raw.githubusercontent.com/reaperblitz/Creatine-AI/main/install.ps1 | iex
"@
    exit 0
}

# ANSI Escape Sequences for Terminal Colors
$e = [char]27
$MUTED  = "$e[0;2m"
$RED    = "$e[0;31m"
$ORANGE = "$e[38;5;214m"
$NC     = "$e[0m"

# 1. Check for Bun Requirement
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Host "${RED}Error: Bun is required to install Creatine from source.${NC}"
    Write-Host "Please install Bun first: ${ORANGE}powershell -c `"irm bun.sh/install.ps1 | iex`"${NC}"
    exit 1
}

# Set up installation paths (Fixed missing spaces after Join-Path)
$CREATINE_HOME = Join-Path$env:USERPROFILE ".creatine"
$APP_DIR       = Join-Path$CREATINE_HOME "app"
$BIN_DIR       = Join-Path$CREATINE_HOME "bin"

New-Item -ItemType Directory -Force -Path $BIN_DIR | Out-Null

Write-Host "`n${MUTED}Installing ${NC}creatine ${MUTED}from source using Bun...${NC}"

# 2. Download or Clone Source Code into ~/.creatine/app
if (Get-Command git -ErrorAction SilentlyContinue) {
    if (Test-Path $APP_DIR) {
        Write-Host "${ORANGE}Updating existing source repository...${NC}"
        git -C "$APP_DIR" pull --quiet
    } else {
        Write-Host "${ORANGE}Cloning GitHub repository...${NC}"
        git clone --quiet https://github.com/reaperblitz/Creatine-AI.git "$APP_DIR"
    }
} else {
    Write-Host "${ORANGE}Git not found. Downloading repository ZIP...${NC}"
    $tempZip = Join-Path $env:TEMP "creatine_src_$PID.zip"
    $tempExtract = Join-Path $env:TEMP "creatine_src_$PID"
    
    try {
        Invoke-WebRequest -Uri "https://github.com/reaperblitz/Creatine-AI/archive/refs/heads/main.zip" -OutFile $tempZip -UseBasicParsing
        Expand-Archive -Path $tempZip -DestinationPath $tempExtract -Force
        
        $extractedFolder = Get-ChildItem -Path $tempExtract -Directory | Select-Object -First 1
        if (Test-Path $APP_DIR) { Remove-Item -Path $APP_DIR -Recurse -Force }
        Move-Item -Path $extractedFolder.FullName -Destination $APP_DIR -Force
    } finally {
        Remove-Item -Path $tempZip -Force -ErrorAction SilentlyContinue
        Remove-Item -Path $tempExtract -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# 3. Install Dependencies & Build with Bun
Write-Host "${ORANGE}Installing dependencies with bun...${NC}"
Push-Location $APP_DIR
try {
    bun install --silent
    if ($LASTEXITCODE -ne 0) {
        Write-Host "${RED}Failed to run 'bun install'${NC}"
        exit 1
    }

    # 4. Build Binary or Setup Executable Wrapper
    $entryPoint = "src/index.ts"
    if (-not (Test-Path $entryPoint)) { $entryPoint = "index.ts" }

    if (Test-Path $entryPoint) {
        Write-Host "${ORANGE}Compiling binary with bun...${NC}"
        bun build --compile --minify $entryPoint --outfile "$BIN_DIR\creatine.exe"
        if ($LASTEXITCODE -ne 0) {
            Write-Host "${RED}Failed to compile binary with bun build${NC}"
            exit 1
        }
    } else {
        $wrapperPath = Join-Path $BIN_DIR "creatine.cmd"
        "@echo off`r`nbun run `"$APP_DIR\$entryPoint`" %*" | Out-File -FilePath $wrapperPath -Encoding ascii
    }
} finally {
    Pop-Location
}

# 5. Add ~/.creatine/bin to User PATH
if (-not $NoModifyPath) {
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $normalizedBin = $BIN_DIR.TrimEnd('\')
    
    # Check PATH flexible to trailing slashes
    $alreadyInPath = ($userPath -split ';') | Where-Object { $_.TrimEnd('\') -eq $normalizedBin }
    
    if (-not $alreadyInPath) {
        $newPath = "$userPath;$BIN_DIR"
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        $env:Path = "$env:Path;$BIN_DIR"
        Write-Host "${MUTED}Successfully added ${NC}creatine ${MUTED}to User `$PATH${NC}"
    } else {
        Write-Host "Directory already in User PATH, skipping."
    }
}

# Display Success Message
Write-Host ""
Write-Host "${MUTED}${NC}        ▄     "
Write-Host "${MUTED}▄▄▄█ █▀▀█ █▀▀▀ █▀▀█ ${NC}▀█▀ ▀█▀ █▀▀▄ █▀▀▀"
Write-Host "${MUTED}█    █ ▀▀ █▀▀  █▀▀█ ${NC}█   █   █  █ █▀▀ "
Write-Host "${MUTED}▀▄▄▄ ▀ ▀▀ ▀▀▀▀ ▀  ▀ ${NC}▀   ▀▀▀ ▀  ▀ ▀▀▀▀"
Write-Host ""
Write-Host "${MUTED}Creatine installed successfully from source!${NC}"
Write-Host ""
Write-Host "cd <project>  ${MUTED}# Open project directory${NC}"
Write-Host "creatine      ${MUTED}# Run command${NC}"
Write-Host ""