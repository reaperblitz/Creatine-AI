<#
.SYNOPSIS
    Creatine installer (bun source install).

.DESCRIPTION
    Installs the CLI from the GitHub repository into ~/.creatine:
      1. clone (or update) the repository into ~/.creatine/app
      2. install its dependencies and run it with bun
      3. write a "creatine" launcher into ~/.creatine/bin
      4. add ~/.creatine/bin to PATH
      5. print the success message

.NOTES
    This file must stay pure ASCII and must not have a byte order mark.
    Windows PowerShell 5.1 decodes a file without a BOM as ANSI, which mangles
    the logo, while "irm ... | iex" keeps a BOM as a leading character and then
    fails to parse. The logo below is therefore written with \u escapes.

.EXAMPLE
    irm https://raw.githubusercontent.com/reaperblitz/Creatine-AI/main/install.ps1 | iex

.EXAMPLE
    $installer = irm https://raw.githubusercontent.com/reaperblitz/Creatine-AI/main/install.ps1
    & ([scriptblock]::Create($installer)) -NoModifyPath
#>
[CmdletBinding()]
param(
    [Alias('h')]
    [switch]$Help,

    [switch]$NoModifyPath
)

$ErrorActionPreference = 'Stop'
# Keep native exit codes observable on PowerShell 7.4+ instead of throwing.
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

# `exit` inside "irm ... | iex" closes the session it was pasted into, so only
# exit when this script runs from a file or with arguments.
$Inline = [string]::IsNullOrEmpty($MyInvocation.InvocationName)

$AppName = 'creatine'
$RepoUrl = if ($env:CREATINE_REPO_URL) { $env:CREATINE_REPO_URL } else { 'https://github.com/reaperblitz/Creatine-AI.git' }

# Windows PowerShell 5.1 does not interpret ANSI escapes in Write-Host output.
$IsWindowsPowerShell = $PSVersionTable.PSVersion.Major -lt 6
$e = [char]27
$MUTED = if ($IsWindowsPowerShell) { '' } else { "$e[0;2m" }
$RED = if ($IsWindowsPowerShell) { '' } else { "$e[0;31m" }
$ORANGE = if ($IsWindowsPowerShell) { '' } else { "$e[38;5;214m" }
$NC = if ($IsWindowsPowerShell) { '' } else { "$e[0m" }

# \u2588 full block, \u2580 upper half block, \u2584 lower half block.
$Logo = @"
                             \u2584
\u2584\u2584\u2584\u2588 \u2588\u2580\u2580\u2588 \u2588\u2580\u2580\u2580 \u2588\u2580\u2580\u2588 \u2580\u2588\u2580 \u2580\u2588\u2580 \u2588\u2580\u2580\u2584 \u2588\u2580\u2580\u2580
\u2588    \u2588 \u2580\u2580 \u2588\u2580\u2580  \u2588\u2580\u2580\u2588 \u2588   \u2588   \u2588  \u2588 \u2588\u2580\u2580
\u2580\u2584\u2584\u2584 \u2580 \u2580\u2580 \u2580\u2580\u2580\u2580 \u2580  \u2580 \u2580   \u2580\u2580\u2580 \u2580  \u2580 \u2580\u2580\u2580\u2580
"@ -split "`n" | ForEach-Object { [regex]::Unescape($_.TrimEnd("`r", " ")) } | Where-Object { $_ }

function Write-Info { param([string]$Message) Write-Host "${ORANGE}$Message${NC}" }
function Write-Detail { param([string]$Message) Write-Host "${MUTED}$Message${NC}" }
function Stop-WithError {
    param([string]$Message)
    Write-Host "${RED}$Message${NC}"
    if ($Inline) { throw $Message }
    exit 1
}
function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$File,
        [string[]]$Arguments = @()
    )
    # Native stderr must not be captured, otherwise a non zero exit code is
    # turned into a terminating NativeCommandError under $ErrorActionPreference.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $File @Arguments | Out-Host
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
    return $code
}

if ($Help) {
    Write-Host @"
Creatine Installer (bun source install)

Clones the repository into ~/.creatine/app, installs its dependencies with bun,
writes a '$AppName' launcher into ~/.creatine/bin and adds it to PATH.

Usage: install.ps1 [-NoModifyPath]

Options:
    -h, -Help        Display this help message
    -NoModifyPath    Don't modify the user PATH, only print the steps

Environment:
    CREATINE_REPO_URL   Repository to install from (default: $RepoUrl)

Examples:
    irm https://raw.githubusercontent.com/reaperblitz/Creatine-AI/main/install.ps1 | iex

To pass options, run the script block instead of piping it into iex:
    `$installer = irm https://raw.githubusercontent.com/reaperblitz/Creatine-AI/main/install.ps1
    & ([scriptblock]::Create(`$installer)) -NoModifyPath
"@
    return
}

# 1. Check for Bun Requirement
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Host "${RED}Error: Bun is required to install Creatine from source.${NC}"
    Write-Host "Please install Bun first: ${ORANGE}powershell -c `"irm bun.sh/install.ps1 | iex`"${NC}"
    if ($Inline) { return }
    exit 1
}

# 2. Set up installation paths
$CreatineHome = Join-Path $env:USERPROFILE ".creatine"
$AppDir = Join-Path $CreatineHome "app"
$BinDir = Join-Path $CreatineHome "bin"
$PackageDir = Join-Path $AppDir "packages\opencode"
$EntryPoint = "src/index.ts"
$Launcher = Join-Path $BinDir "$AppName.cmd"

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

Write-Host "`n${MUTED}Installing ${NC}$AppName ${MUTED}from source using Bun...${NC}"

# 3. Download or Clone Source Code into ~/.creatine/app
if (Test-Path (Join-Path $AppDir ".git")) {
    Write-Info "Updating existing source repository..."
    # "bun install" rewrites bun.lock in the checkout, and a rebase configured for
    # the branch makes "git pull" refuse those changes. Sync to the remote tip
    # instead, which keeps this script re-runnable.
    if ((Invoke-Native -File git -Arguments @("-C", $AppDir, "fetch", "--quiet", "--depth", "1", "origin")) -ne 0) {
        Stop-WithError "Failed to fetch $RepoUrl"
    }
    if ((Invoke-Native -File git -Arguments @("-C", $AppDir, "reset", "--quiet", "--hard", "FETCH_HEAD")) -ne 0) {
        Stop-WithError "Failed to update $AppDir. Delete it and run this script again: Remove-Item -Recurse -Force '$AppDir'"
    }
} elseif (Get-Command git -ErrorAction SilentlyContinue) {
    if (Test-Path $AppDir) {
        Write-Info "Removing existing directory that is not a git checkout..."
        Remove-Item -Path $AppDir -Recurse -Force
    }
    Write-Info "Cloning GitHub repository..."
    if ((Invoke-Native -File git -Arguments @("clone", "--quiet", "--depth", "1", $RepoUrl, $AppDir)) -ne 0) {
        Stop-WithError "Failed to clone $RepoUrl"
    }
} else {
    Write-Info "Git not found. Downloading repository archive..."
    if (-not $RepoUrl.TrimEnd('/').StartsWith('https://github.com/')) {
        Stop-WithError "Git is required to install from a non GitHub repository ($RepoUrl)"
    }
    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "creatine_install_$([guid]::NewGuid().ToString('N'))"
    $tempZip = "$tempDir.zip"
    $archiveError = $null
    try {
        New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
        $downloadArgs = @{ Uri = "$($RepoUrl.TrimEnd('/'))/archive/HEAD.zip"; OutFile = $tempZip }
        if ($IsWindowsPowerShell) { $downloadArgs["UseBasicParsing"] = $true }
        Invoke-WebRequest @downloadArgs
        Expand-Archive -Path $tempZip -DestinationPath $tempDir -Force
        $extracted = Get-ChildItem -Path $tempDir -Directory | Select-Object -First 1
        if (-not $extracted) {
            $archiveError = "the archive did not contain a source directory"
        } else {
            if (Test-Path $AppDir) {
                Remove-Item -Path $AppDir -Recurse -Force
            }
            Move-Item -Path $extracted.FullName -Destination $AppDir -Force
        }
    } catch {
        $archiveError = $_.Exception.Message
    } finally {
        Remove-Item -Path $tempZip -Force -ErrorAction SilentlyContinue
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($archiveError) {
        Stop-WithError "Failed to download the repository archive: $archiveError"
    }
}

if (-not (Test-Path (Join-Path $PackageDir $EntryPoint))) {
    Stop-WithError "Expected $PackageDir\$EntryPoint to exist. The repository layout changed, so this installer needs to be updated."
}

# 4. Install Dependencies with Bun
Write-Info "Installing dependencies with bun..."
Push-Location $AppDir
try {
    # HUSKY=0 keeps the git hooks of the checkout untouched (and avoids a failure
    # when the sources came from the archive instead of git).
    $env:HUSKY = "0"
    if ((Invoke-Native -File bun -Arguments @("install")) -ne 0) {
        Write-Info "Retrying install with the minimum release age guard disabled..."
        if ((Invoke-Native -File bun -Arguments @("install", "--minimum-release-age=0")) -ne 0) {
            Stop-WithError "Failed to run 'bun install' in $AppDir. If a native module failed to build, install the Visual Studio Build Tools ('Desktop development with C++') and run this script again."
        }
    }
} finally {
    Pop-Location
}

# 5. Write the launcher into ~/.creatine/bin
Write-Info "Writing launcher to $Launcher..."
$launcherScript = @"
@echo off
REM Generated by install.ps1. Runs the Creatine CLI from ~/.creatine/app with bun.
bun run --cwd "$PackageDir" "$EntryPoint" %*
exit /b %ERRORLEVEL%
"@
Set-Content -Path $Launcher -Value $launcherScript -Encoding ascii

# 6. Verify the launcher before touching PATH
Write-Info "Verifying installation..."
$previous = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$versionRaw = & $Launcher --version 2>&1
$versionExitCode = $LASTEXITCODE
$ErrorActionPreference = $previous
$versionOutput = ($versionRaw | Out-String).Trim()
if ($versionExitCode -ne 0) {
    Write-Host "${RED}Verification failed. '$Launcher --version' printed:${NC}"
    Write-Host $versionOutput
    Stop-WithError "PATH was left unchanged. Fix the errors above and run '$Launcher --version' manually."
}

# 7. Add ~/.creatine/bin to the User PATH
$normalizedBin = $BinDir.TrimEnd('\')
$manualStep = "  Add it manually: `$env:Path = `"$BinDir;`$env:Path`""

if ($NoModifyPath) {
    Write-Detail "Skipping PATH modification (-NoModifyPath)."
    Write-Host $manualStep
} else {
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $userEntries = @()
    if ($userPath) { $userEntries = @($userPath -split ';' | Where-Object { $_ -ne '' }) }
    $alreadyInPath = $userEntries | Where-Object { $_.Trim().TrimEnd('\') -ieq $normalizedBin }

    if ($alreadyInPath) {
        Write-Detail "Directory already in User PATH, skipping."
    } else {
        $newUserPath = (@($userEntries) + $BinDir) -join ';'
        [Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
        if ([Environment]::GetEnvironmentVariable("Path", "User") -ne $newUserPath) {
            Write-Info "Could not update the user PATH."
            Write-Host $manualStep
        } else {
            Write-Detail "Added $BinDir to User `$PATH"
        }
    }

    # Make `creatine` usable without restarting the current session.
    $processEntries = @($env:Path -split ';' | Where-Object { $_ -ne '' })
    if (-not ($processEntries | Where-Object { $_.Trim().TrimEnd('\') -ieq $normalizedBin })) {
        $env:Path = (@($processEntries) + $BinDir) -join ';'
    }
}

# 8. Display Success Message
Write-Host ""
$Logo | ForEach-Object { Write-Host "${MUTED}$_${NC}" }
Write-Host ""
Write-Host "${MUTED}Creatine installed successfully from source!${NC}"
Write-Host ""
Write-Host "  source   ${MUTED}$AppDir${NC}"
Write-Host "  launcher ${MUTED}$Launcher${NC}"
Write-Host "  version  ${MUTED}$versionOutput${NC}"
Write-Host ""
Write-Host "  ${MUTED}Restart your terminal so $AppName picks up the new PATH.${NC}"
Write-Host ""
Write-Host "  ${MUTED}cd <project>${NC}     ${MUTED}# Open project directory${NC}"
Write-Host "  ${MUTED}$AppName${NC}          ${MUTED}# Run command${NC}"
Write-Host "  ${MUTED}$AppName --version${NC}  ${MUTED}# Check the installation${NC}"
Write-Host ""
Write-Host "  ${MUTED}Re-run this script to update. To uninstall:${NC}"
Write-Host "  ${MUTED}Remove-Item -Recurse -Force '$CreatineHome'${NC}"
Write-Host ""
