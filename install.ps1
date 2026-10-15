<#
.SYNOPSIS
    Creatine installer (bun source install).

.DESCRIPTION
    Installs the CLI from the GitHub repository into ~/.creatine:
      1. download (or refresh) the repository archive into ~/.creatine/app
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

    [switch]$NoModifyPath,

    [switch]$WithOmniRoute
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
$RepoUrl = if ($env:CREATINE_REPO_URL) { $env:CREATINE_REPO_URL } else { 'https://github.com/reaperblitz/Creatine-AI' }

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

Downloads the repository into ~/.creatine/app, installs its dependencies with bun,
writes a '$AppName' launcher into ~/.creatine/bin and adds it to PATH.

Usage: install.ps1 [-NoModifyPath] [-WithOmniRoute]

Options:
    -h, -Help        Display this help message
    -NoModifyPath    Don't modify the user PATH, only print the steps
    -WithOmniRoute   Also set up the OmniRoute local gateway (per-user Node if needed,
                     starts the server, asks for your API key, writes opencode.json)

Environment:
    CREATINE_REPO_URL   GitHub repository to install from (default: $RepoUrl)

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

# 3. Download Source Code into ~/.creatine/app
# Always use the GitHub archive instead of git so users only need bun.
Write-Info "Downloading repository archive..."
$repoBase = $RepoUrl.TrimEnd('/')
if ($repoBase.EndsWith('.git')) { $repoBase = $repoBase.Substring(0, $repoBase.Length - 4) }
if (-not $repoBase.StartsWith('https://github.com/')) {
    Stop-WithError "Only GitHub repositories are supported without git: $RepoUrl"
}
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "creatine_install_$([guid]::NewGuid().ToString('N'))"
$tempZip = "$tempDir.zip"
$archiveError = $null
try {
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    $archiveUrl = "$repoBase/archive/HEAD.zip"
    # curl.exe is much faster than Invoke-WebRequest, especially on Windows
    # PowerShell 5.1. Fall back to Invoke-WebRequest when it is unavailable.
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
        $curlCode = Invoke-Native -File curl.exe -Arguments @('-fsSL', '-o', $tempZip, $archiveUrl)
        if ($curlCode -ne 0) { throw "curl.exe exited with code $curlCode" }
    } else {
        $downloadArgs = @{ Uri = $archiveUrl; OutFile = $tempZip; UseBasicParsing = $true }
        Invoke-WebRequest @downloadArgs
    }
    # Expand-Archive chokes on dotfiles like .dockerignore (PS 5.1 bug).
    # The archive also contains paths longer than 260 chars, which the .NET
    # ZipFile API (Framework) cannot extract. tar.exe (ships with Windows 10+)
    # handles both; keep ZipFile as a best-effort fallback.
    if (Get-Command tar.exe -ErrorAction SilentlyContinue) {
        if ((Invoke-Native -File tar.exe -Arguments @('-xf', $tempZip, '-C', $tempDir)) -ne 0) {
            throw 'tar.exe failed to extract the archive'
        }
    } else {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::ExtractToDirectory($tempZip, $tempDir)
    }
    $extracted = Get-ChildItem -Path $tempDir -Directory | Select-Object -First 1
    if (-not $extracted) {
        $archiveError = "the archive did not contain a source directory"
    } else {
        if (Test-Path $AppDir) {
            Write-Info "Replacing existing source directory..."
            # rm may contain paths longer than 260 chars; use rd with \\?\ prefix.
            cmd /c "rd /s /q `"\\?\$AppDir`"" | Out-Null
        }
        Move-Item -Path $extracted.FullName -Destination $AppDir -Force
    }
} catch {
    $archiveError = $_.Exception.Message
} finally {
    # The tree may contain paths longer than 260 chars, which PowerShell's
    # Remove-Item cannot handle; rd with the \\?\ prefix can.
    Remove-Item -Path $tempZip -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $tempDir) { cmd /c "rd /s /q `"\\?\$tempDir`"" | Out-Null }
}
if ($archiveError) {
    Stop-WithError "Failed to download the repository archive: $archiveError"
}

if (-not (Test-Path (Join-Path $PackageDir $EntryPoint))) {
    Stop-WithError "Expected $PackageDir\$EntryPoint to exist. The repository layout changed, so this installer needs to be updated."
}

# 4. Install Dependencies with Bun
Write-Info "Installing dependencies with bun..."
Push-Location $AppDir
try {
    # HUSKY=0 avoids a failure from the checkout's git hooks, since the
    # sources come from the archive rather than a git clone.
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


# 8. Optional OmniRoute local gateway setup (-WithOmniRoute).
#
# Installs OmniRoute for this user only (no admin/UAC), starts the gateway,
# asks for the API key - typed or pasted here in the terminal, where paste
# works, instead of the TUI key field where it does not - and writes the
# provider block into %APPDATA%\creatine\opencode.json without touching
# anything else already in that file.
if ($WithOmniRoute) {
    Write-Host ""
    Write-Info "Setting up the OmniRoute local gateway..."

    # 8a. Node.js, per-user only. nodejs.org ships a portable zip, so there is
    # nothing to install as admin: extract under ~/.creatine and use it.
    $NodeDir = Join-Path $CreatineHome "node"
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Info "Node.js not found. Installing it for this user only (no admin needed)..."
        $nodeVersion = $null
        try {
            $releases = Invoke-RestMethod "https://nodejs.org/dist/index.json" -TimeoutSec 20
            $nodeVersion = ($releases | Where-Object { $_.lts } | Select-Object -First 1).version
        } catch {
            Write-Detail "Could not reach nodejs.org for the latest LTS ($_). Falling back."
        }
        if (-not $nodeVersion) { $nodeVersion = "v22.14.0" }
        $nodeZip = Join-Path $env:TEMP "node-$nodeVersion-win-x64.zip"
        $nodeUrl = "https://nodejs.org/dist/$nodeVersion/node-$nodeVersion-win-x64.zip"
        Write-Detail "Downloading $nodeUrl"
        try {
            Invoke-WebRequest $nodeUrl -OutFile $nodeZip -TimeoutSec 300
        } catch {
            if ($Inline) { throw "Failed to download Node.js: $_" }
            Write-Host "${RED}Failed to download Node.js: $_${NC}"
            Write-Host "Install Node.js LTS from https://nodejs.org and re-run with -WithOmniRoute."
            exit 1
        }
        if (Test-Path $NodeDir) { Remove-Item $NodeDir -Recurse -Force }
        Expand-Archive $nodeZip $CreatineHome -Force
        Rename-Item (Join-Path $CreatineHome "node-$nodeVersion-win-x64") "node"
        Remove-Item $nodeZip -Force
        Write-Detail "Node.js $nodeVersion extracted to $NodeDir"
    } else {
        Write-Detail "Node.js already present: $((node --version))"
    }

    # Session PATH first so the rest of this script sees node/npm/omniroute.
    $npmGlobal = Join-Path $env:APPDATA "npm"
    foreach ($dir in @($NodeDir, $npmGlobal)) {
        if ((Test-Path $dir) -and -not (@($env:Path -split ';') | Where-Object { $_.Trim().TrimEnd('\') -ieq $dir.TrimEnd('\') })) {
            $env:Path = "$dir;$env:Path"
        }
    }
    # Persist the per-user Node dir for future terminals (user scope: no admin).
    if ((Test-Path $NodeDir) -and -not $NoModifyPath) {
        $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
        $entries = @()
        if ($userPath) { $entries = @($userPath -split ';' | Where-Object { $_ -ne '' }) }
        if (-not ($entries | Where-Object { $_.Trim().TrimEnd('\') -ieq $NodeDir.TrimEnd('\') })) {
            [Environment]::SetEnvironmentVariable("Path", ((@($entries) + $NodeDir) -join ';'), "User")
            Write-Detail "Added per-user Node.js to User PATH"
        }
    }

    # 8b. OmniRoute itself. npm's default global prefix is %APPDATA%\npm, which
    # is already per-user, so this never needs admin either.
    if (-not (Get-Command omniroute -ErrorAction SilentlyContinue)) {
        Write-Info "Installing OmniRoute (npm install -g omniroute)..."
        npm install -g omniroute
        if ($LASTEXITCODE -ne 0) {
            Write-Host "${RED}npm install -g omniroute failed.${NC}"
            if ($Inline) { return }
            exit 1
        }
    } else {
        Write-Detail "OmniRoute already installed."
    }
    # Refresh session PATH for the npm global bin (fresh installs only).
    if (-not (@($env:Path -split ';') | Where-Object { $_.Trim().TrimEnd('\') -ieq $npmGlobal.TrimEnd('\') })) {
        $env:Path = "$npmGlobal;$env:Path"
    }

    # 8c. Start the gateway unless one is already answering. A second instance
    # just fails with "port already in use", so check first.
    $OmniBase = if ($env:OMNIROUTE_URL) { $env:OMNIROUTE_URL.TrimEnd('/') } else { "http://localhost:20128/v1" }
    $OmniHost = $OmniBase -replace '/v1/?$', ''
    $gatewayUp = $false
    try {
        $health = Invoke-RestMethod "$OmniHost/api/health" -TimeoutSec 5
        $gatewayUp = $true
    } catch { $gatewayUp = $false }
    if ($gatewayUp) {
        Write-Detail "OmniRoute gateway already running at $OmniHost."
    } else {
        Write-Info "Starting the OmniRoute gateway (leave its window running)..."
        Start-Process -FilePath "omniroute" -WindowStyle Normal
        $gatewayUp = $false
        for ($i = 0; $i -lt 20; $i++) {
            Start-Sleep -Seconds 3
            try {
                Invoke-RestMethod "$OmniHost/api/health" -TimeoutSec 5 | Out-Null
                $gatewayUp = $true
                break
            } catch { }
        }
        if (-not $gatewayUp) {
            Write-Host "${RED}The gateway did not answer at $OmniHost.${NC}"
            Write-Host "Check its window for errors, then re-run with -WithOmniRoute."
            if ($Inline) { return }
            exit 1
        }
    }

    # 8d. API key. Asked here in the terminal, where paste works, instead of the
    # TUI provider field, where it does not.
    Write-Host ""
    Write-Info "Create an API key: open $OmniHost in a browser,"
    Write-Host "  then Endpoint -> Registered Keys -> create one, and paste it below."
    try { Start-Process "$OmniHost" } catch { Write-Detail "Could not open a browser ($_)." }
    $OmniKey = ""
    while ([string]::IsNullOrWhiteSpace($OmniKey)) {
        $OmniKey = (Read-Host "Paste your OmniRoute API key").Trim()
        if ([string]::IsNullOrWhiteSpace($OmniKey)) {
            Write-Host "${RED}A key is required, or leave it blank-by-quitting with Ctrl+C.${NC}"
        }
    }

    # 8e. Write provider.omniroute into opencode.json, preserving everything else.
    # jsonc-parser keeps comments and formatting intact, unlike a parse/stringify round-trip.
    $ConfigDir = Join-Path $env:APPDATA "creatine"
    if (-not (Test-Path $ConfigDir)) { New-Item $ConfigDir -ItemType Directory -Force | Out-Null }
    $ConfigFile = $null
    foreach ($name in @("opencode.jsonc", "opencode.json", "config.json")) {
        $candidate = Join-Path $ConfigDir $name
        if (Test-Path $candidate) { $ConfigFile = $candidate; break }
    }
    if (-not $ConfigFile) { $ConfigFile = Join-Path $ConfigDir "opencode.json" }
    $JsoncParser = Join-Path $AppDir "node_modules\jsonc-parser\lib\umd\main.js"
    if (Test-Path $JsoncParser) {
        $mergeScript = Join-Path $env:TEMP "creatine-omniroute-merge.cjs"
        Set-Content $mergeScript @"
const fs = require("fs");
const { parse, modify, applyEdits } = require(process.argv[2]);
const [file, key, baseURL] = process.argv.slice(3);
let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "{}";
if (!text.trim()) text = "{}";
const edits = modify(text, ["provider", "omniroute"], {
  npm: "@ai-sdk/openai-compatible",
  name: "OmniRoute",
  options: { baseURL, apiKey: key },
  models: {
    "auto/coding": { name: "auto/coding" },
    "auto/fast": { name: "auto/fast" },
    "auto/cheap": { name: "auto/cheap" },
    "auto/claude-sonnet": { name: "auto/claude-sonnet" },
    "oc/deepseek-v4-flash-free": { name: "oc/deepseek-v4-flash-free" }
  }
}, { formattingOptions: { insertSpaces: true, tabSize: 2 } });
fs.writeFileSync(file, applyEdits(text, edits));
"@
        node $mergeScript $JsoncParser $ConfigFile $OmniKey $OmniBase
        Remove-Item $mergeScript -Force -ErrorAction SilentlyContinue
        Write-Detail "Wrote provider.omniroute to $ConfigFile (everything else untouched)."
    } else {
        Write-Host "${RED}Could not find jsonc-parser under $AppDir. Skipping config write.${NC}"
        Write-Host "Add the provider.omniroute block to $ConfigFile manually (see /omniroute in Creatine)."
    }

    # 8f. Validate: the key either lists models or it does not.
    try {
        $listed = Invoke-RestMethod "$OmniBase/models" -Headers @{ Authorization = "Bearer $OmniKey" } -TimeoutSec 15
        $count = @($listed.data).Count
        Write-Info "OmniRoute is serving $count models. Restart Creatine and pick one."
    } catch {
        Write-Host "${RED}The key did not validate ($($_.Exception.Message)).${NC}"
        Write-Host "The config was still written. Fix the key in $ConfigFile and restart Creatine."
    }
}


# 9. Display Success Message
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
Write-Host "  ${MUTED}cmd /c rd /s /q \"\\?\\$CreatineHome\"${NC}"
Write-Host ""
