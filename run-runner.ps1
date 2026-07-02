# run-runner.ps1 — start a personal runner against the shared agent-hub server.
#
# Usage:
#   .\run-runner.ps1 -ServerUrl https://agent-hub.internal -Token <your-runner-token>
#   .\run-runner.ps1 -ServerUrl https://agent-hub.internal -Token <token> -RunnerName alice-laptop
#
# Auth note: runs execute under YOUR logged-in Claude Code session (~/.claude).
# ANTHROPIC_API_KEY is NOT required here — the runner strips it and uses the CLI
# subscription login instead. Make sure `claude` is on your PATH and you are
# logged in (`claude /login` or the desktop app).
#
# Other optional env vars you can set before calling this script:
#   LOCAL_REPOS_ROOT  — root of your local repo checkouts (default C:/GlobalE)
#   SKILLS_DIR        — path to your skills directory
#   AGENT_TOOLS_ENABLED / RUN_EVENTS_ENABLED / AGENT_CURL_ENABLED

param(
  [Parameter(Mandatory = $true)]
  [string]$ServerUrl,

  [Parameter(Mandatory = $true)]
  [string]$Token,

  [string]$RunnerName = $env:COMPUTERNAME
)

$ErrorActionPreference = 'Stop'

$env:ORCHESTRATOR_URL = $ServerUrl
$env:RUNNER_TOKEN      = $Token
$env:RUNNER_NAME       = $RunnerName

Write-Host ""
Write-Host "agent-hub personal runner" -ForegroundColor Cyan
Write-Host "  Server   : $ServerUrl"
Write-Host "  Runner   : $RunnerName"
Write-Host "  Auth     : uses your ~/.claude login (Claude Code subscription)"
Write-Host ""

Write-Host "[1/2] Building runner (tsc)..." -ForegroundColor Green
Push-Location "$PSScriptRoot\packages\runner"
npx tsc
if ($LASTEXITCODE -ne 0) {
  Pop-Location
  throw "tsc build failed"
}
Pop-Location

Write-Host "[2/2] Starting runner..." -ForegroundColor Green
node "$PSScriptRoot\packages\runner\dist\index.js"
