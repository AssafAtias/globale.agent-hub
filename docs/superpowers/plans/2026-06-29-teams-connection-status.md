# Teams Connection Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a compact, always-visible Teams connection indicator (bot vs webhook) in the agent-hub client sidebar, derived from server config.

**Architecture:** A new unconditional read-only server route `GET /api/integrations/teams` reports `{ bot:{connected}, webhook:{connected} }` from env config (no network calls, no secrets). The client fetches it with react-query and renders two colored dots in the `Layout` sidebar footer.

**Tech Stack:** Fastify + TypeBox (server), Jest + ts-jest (server tests), React + MUI + @tanstack/react-query (client), Vitest (client tests).

## Global Constraints

- "Connected" = **config presence only** (env var set). No live probe.
- Response exposes **booleans only** — never the app id or webhook URL.
- Status route is registered **unconditionally** (outside the `if (teamsEnabled(config))` block) so it answers when Teams is off.
- **No new env vars. No DB migration.**
- Server imports use `.js` extensions (NodeNext); client imports also use `.js` extensions per existing convention.
- Palette tokens (from `apps/client/src/components/dashboard/palette.ts`): connected = `colors.live` (`#4ade80`); not configured = `colors.textFaint` (`#62626b`); error/loading = `colors.textMuted` (`#8c8c95`).
- Dot primitive: `width: 6, height: 6, borderRadius: '50%'` (from `StatusPill.tsx:15`), used standalone — do NOT reuse the `StatusPill` component.
- Spec: `docs/superpowers/specs/2026-06-29-teams-connection-status-design.md`.

---

### Task 1: Server status endpoint

**Files:**
- Create: `apps/server/src/api/routes/integrations.ts`
- Modify: `apps/server/src/app.ts` (register route unconditionally)
- Test: `apps/server/test/integrations/teams.test.ts`

**Interfaces:**
- Consumes: `Environment` type and `teamsEnabled(config)` from `apps/server/src/config/environment.ts`.
- Produces: `buildIntegrationsRoutes(config: Environment): FastifyPluginAsyncTypebox` and the HTTP contract `GET /api/integrations/teams` → `{ bot: { connected: boolean }, webhook: { connected: boolean } }`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/integrations/teams.test.ts`:

```ts
import Fastify from 'fastify';
import { buildIntegrationsRoutes } from '../../src/api/routes/integrations.js';
import type { Environment } from '../../src/config/environment.js';

function makeApp(over: Partial<Environment>) {
  // Bare Fastify instance — avoids buildApp's Teams bot-init side effects
  // (assertTeamsColumns / createTeamsAdapter) that fire when MICROSOFT_APP_ID is set.
  const config = {
    MICROSOFT_APP_ID: undefined,
    TEAMS_WEBHOOK_URL: undefined,
    ...over,
  } as Environment;
  const app = Fastify();
  app.register(buildIntegrationsRoutes(config));
  return app;
}

async function get(app: ReturnType<typeof makeApp>) {
  const res = await app.inject({ method: 'GET', url: '/api/integrations/teams' });
  return { status: res.statusCode, body: res.json() };
}

describe('GET /api/integrations/teams', () => {
  it('reports both connected when bot id and webhook url are set', async () => {
    const app = makeApp({ MICROSOFT_APP_ID: 'app-id', TEAMS_WEBHOOK_URL: 'https://flow/webhook' });
    const { status, body } = await get(app);
    expect(status).toBe(200);
    expect(body).toEqual({ bot: { connected: true }, webhook: { connected: true } });
    await app.close();
  });

  it('reports only bot connected when only MICROSOFT_APP_ID is set', async () => {
    const app = makeApp({ MICROSOFT_APP_ID: 'app-id' });
    const { body } = await get(app);
    expect(body).toEqual({ bot: { connected: true }, webhook: { connected: false } });
    await app.close();
  });

  it('reports only webhook connected when only TEAMS_WEBHOOK_URL is set', async () => {
    const app = makeApp({ TEAMS_WEBHOOK_URL: 'https://flow/webhook' });
    const { body } = await get(app);
    expect(body).toEqual({ bot: { connected: false }, webhook: { connected: true } });
    await app.close();
  });

  it('reports neither connected when both are unset', async () => {
    const app = makeApp({});
    const { body } = await get(app);
    expect(body).toEqual({ bot: { connected: false }, webhook: { connected: false } });
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx jest test/integrations/teams.test.ts`
Expected: FAIL — cannot find module `../../src/api/routes/integrations.js` (file not created yet).

- [ ] **Step 3: Write the route module**

Create `apps/server/src/api/routes/integrations.ts`:

```ts
import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { Environment } from '../../config/environment.js';
import { teamsEnabled } from '../../config/environment.js';

const ChannelStatus = Type.Object({ connected: Type.Boolean() });
const TeamsStatusResponse = Type.Object({ bot: ChannelStatus, webhook: ChannelStatus });

export function buildIntegrationsRoutes(config: Environment): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.get('/api/integrations/teams', {
      schema: { response: { 200: TeamsStatusResponse } },
    }, async () => ({
      bot: { connected: teamsEnabled(config) },
      webhook: { connected: Boolean(config.TEAMS_WEBHOOK_URL) },
    }));
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && npx jest test/integrations/teams.test.ts`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Register the route unconditionally in app.ts**

In `apps/server/src/app.ts`, add the import near the other route imports (after the `buildSkillsRoutes` import on line 9):

```ts
import { buildIntegrationsRoutes } from './api/routes/integrations.js';
```

Then add the registration with the always-on routes — immediately after the existing `app.register(buildSkillsRoutes(config.SKILLS_DIR));` line (currently line 51), OUTSIDE the `if (teamsEnabled(config))` block:

```ts
  app.register(buildSkillsRoutes(config.SKILLS_DIR));
  app.register(buildIntegrationsRoutes(config));
```

- [ ] **Step 6: Build the server to verify it compiles**

Run: `cd apps/server && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/api/routes/integrations.ts apps/server/src/app.ts apps/server/test/integrations/teams.test.ts
git commit -m "feat(server): add GET /api/integrations/teams status endpoint"
```

---

### Task 2: Client data layer + dot-color helper

**Files:**
- Modify: `apps/client/src/api/client.ts` (add `TeamsStatus` type + `api.integrations.teams`)
- Create: `apps/client/src/lib/integrations.ts` (pure helpers, no MUI/React imports)
- Test: `apps/client/src/lib/integrations.test.ts`

**Interfaces:**
- Consumes: `colors` from `apps/client/src/components/dashboard/palette.ts` (a plain object — safe to import in a Node/vitest env).
- Produces:
  - `TeamsStatus` type: `{ bot: { connected: boolean }; webhook: { connected: boolean } }`
  - `api.integrations.teams(): Promise<TeamsStatus>`
  - `type ChannelDot = 'connected' | 'off' | 'unknown'`
  - `channelDot(connected: boolean | undefined, isError: boolean): ChannelDot`
  - `teamsDotColor(dot: ChannelDot): string`

- [ ] **Step 1: Write the failing test**

Create `apps/client/src/lib/integrations.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { channelDot, teamsDotColor } from './integrations.js';
import { colors } from '../components/dashboard/palette.js';

describe('channelDot', () => {
  it('is "connected" when connected is true and no error', () => {
    expect(channelDot(true, false)).toBe('connected');
  });
  it('is "off" when connected is false and no error', () => {
    expect(channelDot(false, false)).toBe('off');
  });
  it('is "unknown" when data has not loaded yet (connected undefined)', () => {
    expect(channelDot(undefined, false)).toBe('unknown');
  });
  it('is "unknown" on query error even if a stale value exists', () => {
    expect(channelDot(true, true)).toBe('unknown');
  });
});

describe('teamsDotColor', () => {
  it('maps connected -> live green', () => {
    expect(teamsDotColor('connected')).toBe(colors.live);
  });
  it('maps off -> faint grey', () => {
    expect(teamsDotColor('off')).toBe(colors.textFaint);
  });
  it('maps unknown -> muted grey', () => {
    expect(teamsDotColor('unknown')).toBe(colors.textMuted);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/client && npx vitest run src/lib/integrations.test.ts`
Expected: FAIL — cannot resolve `./integrations.js` (file not created yet).

- [ ] **Step 3: Write the helper module**

Create `apps/client/src/lib/integrations.ts`:

```ts
import { colors } from '../components/dashboard/palette.js';

export type ChannelDot = 'connected' | 'off' | 'unknown';

export function channelDot(connected: boolean | undefined, isError: boolean): ChannelDot {
  if (isError || connected === undefined) return 'unknown';
  return connected ? 'connected' : 'off';
}

export function teamsDotColor(dot: ChannelDot): string {
  switch (dot) {
    case 'connected':
      return colors.live;
    case 'off':
      return colors.textFaint;
    case 'unknown':
      return colors.textMuted;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/client && npx vitest run src/lib/integrations.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Add the API type and call**

In `apps/client/src/api/client.ts`, add the type near the other interface declarations (e.g. after the `SkillSummary` interface on line 40):

```ts
export interface TeamsStatus {
  bot: { connected: boolean };
  webhook: { connected: boolean };
}
```

Then add an `integrations` namespace to the exported `api` object, immediately after the `skills` block (currently lines 71-73, before the closing `};`):

```ts
  integrations: {
    teams: () => req<TeamsStatus>('/api/integrations/teams'),
  },
```

- [ ] **Step 6: Typecheck the client**

Run: `cd apps/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/client/src/api/client.ts apps/client/src/lib/integrations.ts apps/client/src/lib/integrations.test.ts
git commit -m "feat(client): add teams integration status api + dot-color helpers"
```

---

### Task 3: TeamsStatus component + sidebar wiring

**Files:**
- Create: `apps/client/src/components/TeamsStatus.tsx`
- Modify: `apps/client/src/components/Layout.tsx` (render above `SidebarAccount`)

**Interfaces:**
- Consumes: `api.integrations.teams` and `TeamsStatus` (Task 2), `channelDot` + `teamsDotColor` (Task 2), `colors` from palette, `useQuery` from `@tanstack/react-query`.
- Produces: `<TeamsStatus />` React component (default-importable named export `TeamsStatus`).

> Note: the client has Vitest but no `@testing-library/react`/jsdom, so this component is verified by typecheck + a manual visual check rather than an automated render test. The render-independent logic is already covered by Task 2's helper tests.

- [ ] **Step 1: Create the component**

Create `apps/client/src/components/TeamsStatus.tsx`:

```tsx
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { colors } from './dashboard/palette.js';
import { channelDot, teamsDotColor } from '../lib/integrations.js';

function ChannelRow({ name, connected, isError }: { name: string; connected: boolean | undefined; isError: boolean }) {
  const color = teamsDotColor(channelDot(connected, isError));
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
      <Typography sx={{ fontSize: 13, color: colors.textMuted }}>{name}</Typography>
    </Box>
  );
}

export function TeamsStatus() {
  const { data, isError } = useQuery({
    queryKey: ['integrations', 'teams'],
    queryFn: api.integrations.teams,
    refetchInterval: 30000,
  });

  return (
    <Box
      sx={{
        px: 2, py: 1.5, borderTop: `1px solid ${colors.cardBorder}`,
        display: 'flex', flexDirection: 'column', gap: 0.75,
      }}
    >
      <Typography sx={{ fontSize: 11, fontWeight: 600, color: colors.textFaint, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Teams
      </Typography>
      <ChannelRow name="Bot" connected={data?.bot.connected} isError={isError} />
      <ChannelRow name="Webhook" connected={data?.webhook.connected} isError={isError} />
    </Box>
  );
}
```

- [ ] **Step 2: Wire it into the sidebar**

In `apps/client/src/components/Layout.tsx`, add the import after the `SidebarAccount` import (line 15):

```ts
import { TeamsStatus } from './TeamsStatus.js';
```

Then render it immediately before `<SidebarAccount />` (currently line 86):

```tsx
        <TeamsStatus />
        <SidebarAccount />
```

- [ ] **Step 3: Typecheck the client**

Run: `cd apps/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Build the client to verify the production bundle compiles**

Run: `cd apps/client && npm run build`
Expected: build succeeds (tsc + vite build, no errors).

- [ ] **Step 5: Manual visual verification**

1. Start the server (from `dist/`): `cd apps/server && npx tsc && node dist/index.js`
2. Start the client: `cd apps/client && npm run dev` → open http://localhost:5173
3. Confirm the sidebar footer (above the account row) shows a **Teams** heading with **Bot** and **Webhook** rows.
4. With no Teams env vars set: both dots are faint grey.
5. Set `TEAMS_WEBHOOK_URL` in root `.env`, restart the server (`npx tsc && node dist/index.js`), reload: the **Webhook** dot turns green, **Bot** stays grey.
6. Stop the server and reload the client: both dots show muted grey (error/unknown state, not a false green).

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/components/TeamsStatus.tsx apps/client/src/components/Layout.tsx
git commit -m "feat(client): show Teams connection status in sidebar"
```

---

## Self-Review Notes

- **Spec coverage:** server endpoint (Task 1), client api + type (Task 2), component + sidebar placement (Task 3), config-presence semantics (Task 1 logic), no-secrets (booleans only, Task 1 schema), unconditional registration (Task 1 Step 5), error→neutral dot (Task 2 `channelDot` + Task 3 wiring), bot-init-side-effect-free test (Task 1 bare Fastify), exact palette tokens + dot primitive (Global Constraints + Task 2/3). All covered.
- **Type consistency:** `TeamsStatus` shape, `channelDot`/`teamsDotColor` signatures, and `api.integrations.teams` are defined identically in Task 2 and consumed unchanged in Task 3.
- **No new deps, no DB migration, no new env vars** — confirmed.
