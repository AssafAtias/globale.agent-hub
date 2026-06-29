# Global-E Agent Hub — Teams App

This directory contains the Microsoft Teams app package for the Agent Hub bot.

## Prerequisites

- Azure Bot registration with a `<MICROSOFT_APP_ID>` and `<MICROSOFT_APP_PASSWORD>`.
- `cloudflared` installed and authenticated (same tool used for GitLab webhooks).
- Node.js 18+ with `npx` available.

## Environment Variables

Set the following in `apps/server/.env` (defined in Task 0):

```
MICROSOFT_APP_ID=<your-azure-bot-app-id>
MICROSOFT_APP_PASSWORD=<your-azure-bot-app-password>
```

## Dev Loop

### 1. Start a tunnel

```bash
cloudflared tunnel --url http://localhost:3000
```

Note the generated tunnel hostname (e.g. `https://abc123.trycloudflare.com`).

### 2. Update the Azure Bot messaging endpoint

In the [Azure Portal](https://portal.azure.com), navigate to your Bot resource →
**Configuration** → **Messaging endpoint**, and set it to:

```
https://<tunnel-host>/api/messages
```

Replace `<tunnel-host>` with the hostname from step 1.

### 3. Start the server

From the repo root:

```bash
cd apps/server && npx tsc && node dist/index.js
```

The server runs from the compiled `dist/` output.

### 4. Package the Teams app

Zip `manifest.json`, `color.png`, and `outline.png` (no subdirectories):

```bash
cd apps/server/teams-app
zip agent-hub.zip manifest.json color.png outline.png
```

### 5. Sideload into Teams

1. Open Microsoft Teams.
2. Go to **Apps** → **Manage your apps** → **Upload a custom app**.
3. Select `agent-hub.zip`.

### 6. Test the bot

- **Direct message:** DM the bot in Teams. It will respond to commands immediately.
- **Channel mention:** Add the bot to a channel and `@mention` it.
- **Set a channel:** Send the first message in a channel as:

  ```
  set-channel <slug>
  ```

  Replace `<slug>` with the agent-hub channel/runner slug you want this Teams channel to receive notifications from.

## Regenerating Icons

Run the icon generator script (requires Node.js, no extra dependencies):

```bash
node apps/server/teams-app/gen-icons.mjs
```

This writes:
- `color.png` — 192×192 solid brand blue (#1F6FEB), opaque.
- `outline.png` — 32×32 fully transparent PNG.
