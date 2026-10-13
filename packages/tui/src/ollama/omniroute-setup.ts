/**
 * Setup instructions for the OmniRoute gateway, written to a script and run in a fresh terminal.
 *
 * A new window rather than an in-app dialog because setup means running commands and pasting a
 * key, and a dialog that cannot accept a paste is the wrong place for either. The window stays
 * open on purpose - `pause` at the end means the user can read the output instead of watching it
 * vanish when a command finishes.
 */

import { OLLAMA_LIBRARY_URL } from "@opencode-ai/core/plugin/provider/ollama"
import { OMNIROUTE_DASHBOARD_URL, OMNIROUTE_HOST, OMNIROUTE_INSTALL } from "@opencode-ai/core/plugin/provider/omniroute"

export const OMNIROUTE_SETUP_FILE = "creatine-omniroute-setup.cmd"

/**
 * Escapes a value for cmd so a path or key containing `%` or `^` - both of which real values can
 * contain, and either of which would otherwise corrupt the line - survives intact.
 */
function cmd(value: string) {
  return value.replace(/%/g, "%%").replace(/\^/g, "^^")
}

const probe = (path: string, variable: string, letter: string, host: string) =>
  `for /f "tokens=1" %%${letter} in ('curl.exe -s -o nul -w "%%{http_code}" --connect-timeout 3 ${host}${path}') do set "${variable}=%%${letter}"`

export function omnirouteSetupScript(configPath: string): string {
  const host = OMNIROUTE_HOST
  return [
    "@echo off",
    "setlocal enabledelayedexpansion",
    "title Creatine - OmniRoute setup",
    "echo.",
    "echo  ============================================================",
    "echo    OmniRoute setup for Creatine",
    "echo  ============================================================",
    "echo.",
    "echo  STEP 1 - is it already running?",
    "echo.",
    // Captured into variables, never branched on inline: cmd expands %errorlevel% at parse time,
    // before curl runs, so `if %errorlevel%` after curl always reads the previous command's value.
    // Reading curl's own output through `for /f` sidesteps that entirely.
    'set "HEALTH="',
    probe("/api/health", "HEALTH", "h", host),
    'set "MODELS="',
    probe("/v1/models", "MODELS", "m", host),
    "echo    health endpoint: HTTP %HEALTH%",
    "echo    models endpoint: HTTP %MODELS%",
    "echo.",
    "rem  401 on models while health is 200 means the gateway is healthy and simply",
    "rem  wants a key. Reading that as broken is what costs people an afternoon.",
    'if "%HEALTH%"=="200" goto :running',
    "echo    Not running. STEP 2 installs and starts it.",
    "goto :install",
    ":running",
    "echo    ^> Already running - nothing to install.",
    'if "%MODELS%"=="401" echo    ^> It needs a key. Go to STEP 3.',
    'if "%MODELS%"=="200" echo    ^> Already serving models. Go to STEP 4.',
    "goto :key",
    ":install",
    "echo.",
    "echo  STEP 2 - install and start it",
    "echo.",
    "echo    Needs Node.js 18 or newer. If node is missing:",
    "echo      winget install OpenJS.NodeJS.LTS",
    "echo    then reopen this window.",
    "echo.",
    'where node >nul 2>&1 || (echo    node not found. Install Node.js LTS first.&goto :finish)',
    'where npm >nul 2>&1 || (echo    npm not found. Install Node.js LTS first.&goto :finish)',
    `where omniroute >nul 2>&1 || echo    Installing: ${cmd(OMNIROUTE_INSTALL)}`,
    "where omniroute >nul 2>&1 || npm install -g omniroute",
    "echo.",
    "echo    Starting OmniRoute in THIS window - leave it running.",
    "echo    Open a second terminal for Creatine once it says listening.",
    "echo.",
    "omniroute",
    "goto :key",
    ":key",
    "echo.",
    "echo  STEP 3 - create your key",
    "echo.",
    `echo    1. Open ${OMNIROUTE_DASHBOARD_URL} in a browser`,
    "echo    2. Go to:  Endpoint  ->  Registered Keys  ->  create a key",
    "echo.",
    "echo    The gateway answers 401 without a key even when it is set to",
    "echo    REQUIRE_API_KEY=false, so this step is not optional.",
    "echo.",
    "echo  STEP 4 - give the key to Creatine",
    "echo.",
    "echo    Open this file:",
    "echo.",
    `echo      ${cmd(configPath)}`,
    "echo.",
    "echo    and make sure it contains this, keeping anything else already there:",
    "echo.",
    "echo      {",
    'echo        "provider": {',
    'echo          "omniroute": {',
    'echo            "options": {',
    `echo              "baseURL": "${host}/v1",`,
    'echo              "apiKey": "YOUR-KEY-HERE"',
    "echo            }",
    "echo          }",
    "echo        }",
    "echo      }",
    "echo.",
    "echo    Then fully restart Creatine. OmniRoute will be in the model picker",
    "echo    with every model your gateway serves.",
    "echo.",
    "echo  ------------------------------------------------------------",
    `echo  More local models: ${OLLAMA_LIBRARY_URL}`,
    "echo  ------------------------------------------------------------",
    "echo.",
    ":finish",
    "pause",
  ].join("\r\n")
}

export function omnirouteSetupCommand(scriptPath: string): string {
  return `cmd.exe /c start "" cmd.exe /k ${scriptPath}`
}