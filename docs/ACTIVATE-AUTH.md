# Activating Auth (Entra SSO) on an internal TLS host

Turns the app from open single-operator mode into multi-user SSO. Auth is
gated by `AUTH_ENABLED` — until you complete this, the dashboard stays open
(current behaviour) and nothing changes.

Everything keys off one value — the host's external HTTPS origin. It appears in
exactly two places: the Entra **redirect URI** and `PUBLIC_BASE_URL`. This guide
writes it as `https://AGENTHUB` — substitute your real hostname (e.g.
`https://agent-hub.internal`).

Prerequisites: see [DEPLOY.md](DEPLOY.md) for the general runbook. Artifacts:
[`../Caddyfile.example`](../Caddyfile.example), [`../.env.host.example`](../.env.host.example).

---

## 0. Provision the host (blocker until done)

Request an always-on internal Linux host/VM:

- **Size:** 1–2 vCPU, 2 GB RAM, ~10 GB disk (Fastify + SQLite + one container — tiny).
- **Runtime:** Podman (or Docker) installed.
- **DNS:** a name (e.g. `agent-hub.internal`) resolving to the host, reachable
  by the team's browsers AND by each teammate's runner (the runner polls the
  server over HTTPS).
- **Ports:** inbound 443 (and 80 for ACME/redirect if using public certs);
  the container's 3000 only needs to be reachable by the local reverse proxy.
- **TLS cert:** public ACME if the host is publicly resolvable; otherwise an
  internal CA cert (see Caddyfile.example option b).
- **Outbound HTTPS** from the host to `login.microsoftonline.com` (OIDC) and to
  GitLab/Jira/Bitbucket if those integrations are used.
- **Persistence:** the named volume `agent-hub-data` holds the SQLite DB.

> The runner is NOT containerised and does NOT run here — each teammate runs it
> on their own machine with their own `~/.claude`.

## 1. Register the Entra app

Azure portal → **App registrations → New registration**:
- Name `agent-hub`; **Single tenant**.
- Redirect URI: **Web** → `https://AGENTHUB/auth/callback`.
- Copy **Directory (tenant) ID** and **Application (client) ID**.
- **Certificates & secrets → New client secret** → copy the value now.
- **API permissions:** default Microsoft Graph `User.Read` (delegated) suffices.

**IT request (if you lack rights):**
> Please create an Entra ID single-tenant app registration named `agent-hub`,
> add a Web redirect URI `https://AGENTHUB/auth/callback`, create a client
> secret (24-month), grant delegated Microsoft Graph `User.Read`, and send me
> the tenant ID, client ID, and client secret value. Internal SSO for an
> internal dev tool; no admin consent beyond User.Read.

## 2. TLS reverse proxy

Copy `Caddyfile.example` → `Caddyfile`, set the hostname, `caddy run`. Or use
your existing nginx/Traefik to reverse-proxy `https://AGENTHUB` → `localhost:3000`.
TLS must terminate before the app (the session cookie is `Secure`).

## 3. Build + run the container

```sh
podman build -f apps/server/Dockerfile -t agent-hub-server .
```
Fill `.env.host.example` → a host-only env file (never commit it; generate
`SESSION_SECRET` with the command in that file), then:
```sh
podman run -d --name agent-hub -p 3000:3000 \
  -v agent-hub-data:/data \
  --env-file /path/to/agent-hub.host.env \
  agent-hub-server
```
Migrations run automatically at startup (fresh volume → full 0000→0007 chain).

## 4. Verify

1. Open `https://AGENTHUB` → redirected to Microsoft login → back to the
   dashboard. **The first user to log in becomes admin;** all others are members.
2. A second teammate logs in → `member`.
3. **Runners → Register runner** from each person's OWN session (so the runner
   binds to that user), copy the one-time token, and on their machine run
   `run-runner.ps1 -ServerUrl https://AGENTHUB -Token <token>`.
4. **Agents → Edit → Owner:** an admin sets each agent's owner so its
   webhook/cron/handoff runs route to that person's runner.

## 5. Ops guardrail

A runner registered without an owner (`userId = null`) claims **any** pending
run (legacy/open-mode behaviour) and will drain everyone's queue. Always create
runner tokens from the correct user's session; audit `GET /api/runners` to
confirm no null-owner runners are connected.

## Rollback

Set `AUTH_ENABLED=false` (or unset it) and restart the container → back to open
single-operator mode. No data migration needed; the schema is unchanged.
