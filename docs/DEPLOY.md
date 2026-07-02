# Deploy Runbook — agent-hub

This guide covers standing up the shared central server (containerised) and
onboarding each teammate with a personal runner.

---

## 1. Entra App Registration

agent-hub uses Microsoft Entra ID (Azure AD) for single-tenant SSO.

> **Reuse option:** if the Teams bot integration is already provisioned, you
> may reuse that same app registration — just add the redirect URI below.

1. In the [Azure portal](https://portal.azure.com) go to
   **Azure Active Directory → App registrations → New registration**.
2. Name: `agent-hub` (or any internal label).
3. Supported account types: **Accounts in this organisational directory only
   (Single tenant)**.
4. Redirect URI: **Web** → `${PUBLIC_BASE_URL}/auth/callback`
   (e.g. `https://agent-hub.internal/auth/callback`).
5. Click **Register**, then note the **Application (client) ID** and
   **Directory (tenant) ID**.
6. Under **Certificates & secrets → New client secret**: set an expiry and
   copy the secret value immediately — you need it as `ENTRA_CLIENT_SECRET`.
7. Under **API permissions**: the default `User.Read` (delegated, Microsoft
   Graph) is sufficient for reading the logged-in user's profile.

**First login becomes admin; all subsequent logins are assigned the `member`
role automatically.**

---

## 2. TLS is Required for Auth Mode

The session cookie is set with the `Secure` flag. Browsers silently drop
`Secure` cookies over plain HTTP, so **login will fail without TLS** — the
callback completes but no session is established.

Requirements:

- Terminate TLS at the host or a reverse proxy (nginx, Caddy, Traefik, etc.)
  in front of port 3000.
- `PUBLIC_BASE_URL` must be the **exact** external HTTPS origin — no trailing
  slash — and it must match the redirect URI registered in Entra:
  ```
  PUBLIC_BASE_URL=https://agent-hub.internal
  ```
- Local dev over `http://localhost` cannot complete SSO login. Run without
  `AUTH_ENABLED` (open mode) locally, or front localhost with a TLS proxy.

---

## 3. Container Run (Podman)

Build context is the repo root so npm workspace resolution works:

```sh
podman build -f apps/server/Dockerfile -t agent-hub-server .
```

Run with a named volume for the SQLite database:

```sh
podman run -d \
  --name agent-hub \
  -p 3000:3000 \
  -v agent-hub-data:/data \
  -e DATABASE_URL=/data/agent-hub.db \
  -e GITLAB_WEBHOOK_SECRET=<strong-random-secret> \
  -e JIRA_WEBHOOK_SECRET=<strong-random-secret> \
  -e GITLAB_API_TOKEN=<token> \
  -e JIRA_API_TOKEN=<token> \
  agent-hub-server
```

**IMPORTANT — `GITLAB_WEBHOOK_SECRET`:** the `.env.example` default
(`changeme`) disables meaningful webhook signature verification. You **must**
set a real secret in production, otherwise any caller can forge GitLab/Jira
webhook events.

> **WSL / Podman Compose note:** `podman compose` may fail with `E_UNEXPECTED`
> in some WSL setups. The `podman build` + `podman run` commands above are the
> reliable fallback — no compose file is needed for a single-container
> deployment.

---

## 4. Per-User Runner Setup

Each teammate runs the runner on their own machine. Their Claude runs execute
under their own Claude Code subscription (`~/.claude`).

**On the dashboard (admin or the user themselves):**

1. Go to **Runners → Register runner**.
2. Enter a name (e.g. `alice-laptop`).
3. Copy the one-time token shown — it cannot be retrieved again.

**On the teammate's machine:**

```powershell
# From the repo root (must be cloned locally):
.\run-runner.ps1 -ServerUrl https://agent-hub.internal -Token <token>
```

Prerequisites on each machine:
- Node.js 18+
- `claude` CLI on PATH and logged in (`claude /login` or the desktop app)
- The repo cloned locally (runner builds itself with `tsc` on first run)

The runner prints `uses your ~/.claude login` on start to confirm it is using
the subscription auth, not an API key.

---

## 5. Agent Ownership

An **admin** binds each agent to an owner so webhook, cron, and handoff runs
route to that person's runner.

1. Go to **Agents → (select agent) → Edit**.
2. Set **Owner** to the teammate who should execute this agent's runs.

**Critical ops note — null-owner runners:**

A runner registered *without* being bound to a user (`userId = null`) claims
**any** pending run — the open-mode / legacy single-operator behaviour. In a
multi-user deployment this means a null-owner runner drains everyone's queue
regardless of agent ownership.

Always create runner tokens from the correct user's session so the runner is
bound to that user. Audit with `GET /api/runners` to confirm no null-owner
runners are connected in production.

---

## 6. Flipping Auth On

Auth is off by default (open mode — single-operator behaviour). Once Entra and
TLS are ready:

```env
AUTH_ENABLED=true
ENTRA_TENANT_ID=<Directory (tenant) ID from step 1>
ENTRA_CLIENT_ID=<Application (client) ID from step 1>
ENTRA_CLIENT_SECRET=<client secret from step 1>
SESSION_SECRET=<32-byte random hex — generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
PUBLIC_BASE_URL=https://agent-hub.internal
```

`SESSION_SECRET` must be a long random value (at least 32 bytes of entropy).
Do **not** use a short memorable string — it signs session cookies.

Restart the container after setting these variables. The first user to log in
via SSO becomes admin; all others receive the `member` role.

Before `AUTH_ENABLED` is set, the dashboard is fully open — treat it as
single-operator mode only.
