# Agent Identity Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each agent a chosen avatar, a persona (title + short bio), and curated/custom skill badges, surfaced on enhanced agent cards and a new per-agent profile page.

**Architecture:** Add four additive columns to the `agents` table and round-trip them through the existing Fastify/TypeBox routes and Drizzle repository (no runner changes). The avatar gallery and skill catalog are client-side constants. The profile page reuses the existing `GET /api/runs` data, filtered to the agent client-side.

**Tech Stack:** Server — Fastify + `@sinclair/typebox` + Drizzle (better-sqlite3) + Jest. Client — React + MUI + `@tanstack/react-query` + `react-router-dom` + Vite.

## Global Constraints

- Node `>=20`. Server is ESM: **all relative imports use the `.js` extension** (e.g. `'../db/schema.js'`), even for `.ts` source.
- Skills are **characterization only** — no runtime effect, `packages/runner` is **never modified**.
- Schema changes are **additive only**; existing columns/behavior unchanged.
- Avatar gallery and skill catalog live in the **client** (`src/constants/`); the server stores opaque values (`avatarKey` string, `skills` JSON string).
- Server tests use **Jest** (`apps/server/test/*.test.ts`) with an in-memory SQLite DB. The client has **no test framework**; client tasks are verified with `npx tsc --noEmit` plus a manual smoke check (adding Vitest is out of scope).
- Commit after every task.

---

## File Structure

**Server**
- `apps/server/src/db/schema.ts` — +4 columns on `agents`.
- `apps/server/src/db/migrations/<generated>.sql` (+ meta) — new migration.
- `apps/server/src/services/AgentRepository.ts` — round-trip new fields.
- `apps/server/src/api/routes/agents.ts` — schema + serialization for new fields.
- `apps/server/test/agents.test.ts` — updated table fixture + new round-trip test.

**Client**
- `apps/client/src/api/client.ts` — extend `Agent` + `AgentInput`.
- `apps/client/src/constants/avatars.ts` — avatar gallery (new).
- `apps/client/src/constants/skills.ts` — skill catalog + helpers (new).
- `apps/client/src/components/AgentAvatar.tsx` — avatar renderer (new).
- `apps/client/src/components/AvatarPicker.tsx` — gallery picker (new).
- `apps/client/src/components/SkillsSelector.tsx` — skills multi-select (new).
- `apps/client/src/components/AgentCard.tsx` — enhanced.
- `apps/client/src/pages/AgentConfigPage.tsx` — enhanced.
- `apps/client/src/pages/AgentProfilePage.tsx` — new.
- `apps/client/src/App.tsx` — route restructure.
- `apps/client/src/pages/AgentsPage.tsx` — edit navigation update.

**Routing note (resolved conflict):** Today `/agents/:id` renders `AgentConfigPage`. After this work:
- `/agents/new` → `AgentConfigPage` (create)
- `/agents/:id/edit` → `AgentConfigPage` (edit)
- `/agents/:id` → `AgentProfilePage` (view)

`AgentConfigPage`'s existing `isNew = id === 'new' || !id` keeps working for `/agents/new`; the edit route supplies a real `id`.

---

### Task 1: Server — persist & expose identity fields

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Modify: `apps/server/src/api/routes/agents.ts`
- Modify: `apps/server/src/services/AgentRepository.ts`
- Test: `apps/server/test/agents.test.ts`
- Create: `apps/server/src/db/migrations/<generated>.sql` (via drizzle-kit)

**Interfaces:**
- Produces: `agents` rows now carry `avatarKey: string | null`, `title: string | null`, `bio: string | null`, `skills: string` (JSON `string[]`). API accepts optional `avatarKey`, `title`, `bio`, and `skills: string[]` on POST/PUT and returns the persisted row.

- [ ] **Step 1: Update the in-memory test table fixture**

In `apps/server/test/agents.test.ts`, replace the `CREATE TABLE IF NOT EXISTS agents (...)` block in `setupInMemoryDb()` with the version including the four new columns:

```ts
  (db as any).$client.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt TEXT NOT NULL,
      repos TEXT NOT NULL,
      trigger_rules TEXT NOT NULL,
      outputs TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      avatar_key TEXT,
      title TEXT,
      bio TEXT,
      skills TEXT NOT NULL DEFAULT '[]'
    )
  `);
```

Then check for any other test that builds the agents table and apply the same change:

Run: `grep -rl "CREATE TABLE IF NOT EXISTS agents" apps/server/test`
For each file returned besides `agents.test.ts`, add the same four columns.

- [ ] **Step 2: Write the failing round-trip test**

Append this test inside the `describe('Agents API', ...)` block in `apps/server/test/agents.test.ts`:

```ts
  it('POST + GET round-trips identity fields (avatar, title, bio, skills)', async () => {
    const post = await app.inject({
      method: 'POST', url: '/api/agents',
      payload: {
        name: 'Bug Hunter', type: 'pr-review', model: 'claude-haiku-4-5',
        prompt: 'p', repos: [], triggerRules: { events: [] }, outputs: [],
        avatarKey: 'ember', title: 'Senior Bug Hunter',
        bio: 'Finds what others miss.', skills: ['Code Review', 'Testing'],
      },
    });
    expect(post.statusCode).toBe(201);
    const { id } = post.json();
    const get = await app.inject({ method: 'GET', url: `/api/agents/${id}` });
    const body = get.json();
    expect(body.avatarKey).toBe('ember');
    expect(body.title).toBe('Senior Bug Hunter');
    expect(body.bio).toBe('Finds what others miss.');
    expect(JSON.parse(body.skills)).toEqual(['Code Review', 'Testing']);
  });

  it('defaults skills to an empty array when omitted', async () => {
    const post = await app.inject({
      method: 'POST', url: '/api/agents',
      payload: {
        name: 'Plain', type: 'pr-review', model: 'claude-haiku-4-5',
        prompt: 'p', repos: [], triggerRules: { events: [] }, outputs: [],
      },
    });
    expect(JSON.parse(post.json().skills)).toEqual([]);
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/server && npx jest agents -t "round-trips identity"`
Expected: FAIL — the TypeBox schema rejects the unknown `avatarKey`/`title`/`bio`/`skills` properties (or they are not persisted).

- [ ] **Step 4: Add the schema columns**

In `apps/server/src/db/schema.ts`, add to the `agents` table definition (after `createdAt`):

```ts
  createdAt: text('created_at').notNull(),
  avatarKey: text('avatar_key'),
  title: text('title'),
  bio: text('bio'),
  skills: text('skills').notNull().default('[]'), // JSON: string[]
```

- [ ] **Step 5: Extend the route schema and serialization**

In `apps/server/src/api/routes/agents.ts`, extend `AgentBody` (add before the closing `})` of `Type.Object`):

```ts
  enabled: Type.Optional(Type.Boolean()),
  avatarKey: Type.Optional(Type.String({ maxLength: 64 })),
  title: Type.Optional(Type.String({ maxLength: 80 })),
  bio: Type.Optional(Type.String({ maxLength: 500 })),
  skills: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
```

Update the POST handler's `create(...)` call to normalize the new fields:

```ts
      const agent = AgentRepository.create({
        ...req.body,
        repos: JSON.stringify(req.body.repos),
        triggerRules: JSON.stringify(req.body.triggerRules),
        outputs: JSON.stringify(req.body.outputs),
        avatarKey: req.body.avatarKey ?? null,
        title: req.body.title ?? null,
        bio: req.body.bio ?? null,
        skills: JSON.stringify(req.body.skills ?? []),
      });
```

Update the PUT handler to serialize `skills` when present (add alongside the existing `repos`/`triggerRules`/`outputs` guards):

```ts
    if (body.skills !== undefined) patch.skills = JSON.stringify(body.skills);
```

(`avatarKey`, `title`, `bio` are plain strings carried by the existing `{ ...body }` spread — no serialization needed.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/server && npx jest agents`
Expected: PASS — all agent tests, including the two new ones.

Then run the full server suite to confirm nothing regressed:
Run: `cd apps/server && npm test`
Expected: PASS.

- [ ] **Step 7: Generate and apply the migration**

Run: `cd apps/server && npx drizzle-kit generate`
Expected: a new file in `src/db/migrations/` containing `ALTER TABLE` statements for the four columns, plus an updated `meta/_journal.json`.

Run: `cd apps/server && npx drizzle-kit migrate`
Expected: the migration applies to the dev DB without error (additive columns).

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/db/schema.ts apps/server/src/api/routes/agents.ts apps/server/src/services/AgentRepository.ts apps/server/test/agents.test.ts apps/server/src/db/migrations
git commit -m "feat(server): persist agent identity fields (avatar, title, bio, skills)"
```

---

### Task 2: Client — extend API types

**Files:**
- Modify: `apps/client/src/api/client.ts`

**Interfaces:**
- Produces: `Agent` gains `avatarKey?: string | null; title?: string | null; bio?: string | null; skills: string`. `AgentInput` gains `avatarKey?: string; title?: string; bio?: string; skills?: string[]`. These are consumed by Tasks 6–8.

- [ ] **Step 1: Extend the `Agent` interface**

In `apps/client/src/api/client.ts`, replace the `Agent` interface with:

```ts
export interface Agent {
  id: string; name: string; type: string; model: string; prompt: string;
  repos: string; triggerRules: string; outputs: string;
  enabled: boolean; createdAt: string;
  avatarKey?: string | null; title?: string | null; bio?: string | null;
  skills: string; // JSON: string[]
}
```

- [ ] **Step 2: Extend the `AgentInput` interface**

Replace the `AgentInput` interface with:

```ts
export interface AgentInput {
  name: string; type: string; model: string; prompt: string;
  repos: string[]; triggerRules: { events: string[]; branchFilter?: string; jiraLabel?: string };
  outputs: string[]; enabled?: boolean;
  avatarKey?: string; title?: string; bio?: string; skills?: string[];
}
```

(No change to the `api` object — `create`/`update` already accept `Partial<AgentInput>`.)

- [ ] **Step 3: Typecheck**

Run: `cd apps/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/api/client.ts
git commit -m "feat(client): add identity fields to Agent API types"
```

---

### Task 3: Client — avatar gallery & skill catalog constants

**Files:**
- Create: `apps/client/src/constants/avatars.ts`
- Create: `apps/client/src/constants/skills.ts`

**Interfaces:**
- Produces: `AVATAR_GALLERY: AvatarOption[]`, `getAvatar(key)`, `AvatarOption { key; label; hue }`; `SKILL_CATALOG: string[]`, `normalizeSkill(s)`, `dedupeSkills(list)`. Consumed by Tasks 4, 5, 6.

- [ ] **Step 1: Create the avatar gallery**

Create `apps/client/src/constants/avatars.ts`:

```ts
export interface AvatarOption {
  key: string;
  label: string;
  hue: number; // HSL hue for the avatar tint
}

export const AVATAR_GALLERY: AvatarOption[] = [
  { key: 'nova', label: 'Nova', hue: 210 },
  { key: 'ember', label: 'Ember', hue: 12 },
  { key: 'fern', label: 'Fern', hue: 140 },
  { key: 'iris', label: 'Iris', hue: 270 },
  { key: 'sol', label: 'Sol', hue: 45 },
  { key: 'coral', label: 'Coral', hue: 340 },
  { key: 'sky', label: 'Sky', hue: 190 },
  { key: 'slate', label: 'Slate', hue: 222 },
];

export function getAvatar(key?: string | null): AvatarOption | undefined {
  return AVATAR_GALLERY.find((a) => a.key === key);
}
```

- [ ] **Step 2: Create the skill catalog + helpers**

Create `apps/client/src/constants/skills.ts`:

```ts
export const SKILL_CATALOG: string[] = [
  'Code Review', 'Jira', 'GitLab', 'Testing', 'Refactoring',
  'Documentation', 'Security', 'Performance', 'Bug Hunting', 'TypeScript',
];

export function normalizeSkill(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

export function dedupeSkills(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const s = normalizeSkill(raw);
    if (!s) continue;
    const k = s.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(s); }
  }
  return out;
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/constants/avatars.ts apps/client/src/constants/skills.ts
git commit -m "feat(client): add avatar gallery and skill catalog constants"
```

---

### Task 4: Client — AgentAvatar component

**Files:**
- Create: `apps/client/src/components/AgentAvatar.tsx`

**Interfaces:**
- Consumes: `getAvatar` from `../constants/avatars.js`.
- Produces: `AgentAvatar({ avatarKey?, name, size? }): JSX.Element`. Consumed by Tasks 5, 6, 7, 8.

- [ ] **Step 1: Create the component**

Create `apps/client/src/components/AgentAvatar.tsx`:

```tsx
import { getAvatar } from '../constants/avatars.js';

interface Props { avatarKey?: string | null; name: string; size?: number; }

function hashHue(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function AgentAvatar({ avatarKey, name, size = 40 }: Props) {
  const opt = getAvatar(avatarKey);
  const hue = opt ? opt.hue : hashHue(name || '?');
  const bg = `hsl(${hue}, 65%, 55%)`;

  if (!opt) {
    const initials =
      name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
    return (
      <div
        aria-label={`${name} avatar`}
        style={{
          width: size, height: size, borderRadius: '50%', background: bg,
          color: '#fff', display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: size * 0.4, fontWeight: 600,
        }}
      >
        {initials}
      </div>
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={`${name} avatar`}>
      <circle cx="20" cy="20" r="20" fill={bg} />
      <rect x="11" y="12" width="18" height="14" rx="3" fill="#fff" />
      <circle cx="16" cy="19" r="2.2" fill={bg} />
      <circle cx="24" cy="19" r="2.2" fill={bg} />
      <rect x="15" y="23" width="10" height="2" rx="1" fill={bg} />
      <rect x="19" y="7" width="2" height="5" fill="#fff" />
      <circle cx="20" cy="6" r="2" fill="#fff" />
    </svg>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/components/AgentAvatar.tsx
git commit -m "feat(client): add AgentAvatar component with initials fallback"
```

---

### Task 5: Client — AvatarPicker & SkillsSelector components

**Files:**
- Create: `apps/client/src/components/AvatarPicker.tsx`
- Create: `apps/client/src/components/SkillsSelector.tsx`

**Interfaces:**
- Consumes: `AVATAR_GALLERY` + `AgentAvatar`; `SKILL_CATALOG` + `dedupeSkills`.
- Produces: `AvatarPicker({ value, onChange })` where value is `string | undefined`; `SkillsSelector({ value, onChange })` where value is `string[]`. Consumed by Task 6.

- [ ] **Step 1: Create AvatarPicker**

Create `apps/client/src/components/AvatarPicker.tsx`:

```tsx
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { AVATAR_GALLERY } from '../constants/avatars.js';
import { AgentAvatar } from './AgentAvatar.js';

interface Props { value?: string; onChange: (key: string) => void; name?: string; }

export function AvatarPicker({ value, onChange, name = 'Agent' }: Props) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">Avatar</Typography>
      <Box display="flex" gap={1.5} flexWrap="wrap" mt={0.5}>
        {AVATAR_GALLERY.map((opt) => (
          <Box
            key={opt.key}
            role="button"
            aria-label={`Choose ${opt.label} avatar`}
            aria-pressed={value === opt.key}
            onClick={() => onChange(opt.key)}
            sx={{
              cursor: 'pointer', borderRadius: '50%', padding: '2px',
              border: (t) => `2px solid ${value === opt.key ? t.palette.primary.main : 'transparent'}`,
            }}
          >
            <AgentAvatar avatarKey={opt.key} name={name} size={44} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Create SkillsSelector**

Create `apps/client/src/components/SkillsSelector.tsx`:

```tsx
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import { SKILL_CATALOG, dedupeSkills } from '../constants/skills.js';

interface Props { value: string[]; onChange: (skills: string[]) => void; }

export function SkillsSelector({ value, onChange }: Props) {
  return (
    <Autocomplete
      multiple
      freeSolo
      options={SKILL_CATALOG}
      value={value}
      onChange={(_, next) => onChange(dedupeSkills(next as string[]))}
      renderInput={(params) => (
        <TextField {...params} label="Skills" placeholder="Add a skill" />
      )}
    />
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/components/AvatarPicker.tsx apps/client/src/components/SkillsSelector.tsx
git commit -m "feat(client): add AvatarPicker and SkillsSelector components"
```

---

### Task 6: Client — enhance AgentConfigPage

**Files:**
- Modify: `apps/client/src/pages/AgentConfigPage.tsx`

**Interfaces:**
- Consumes: `AvatarPicker`, `SkillsSelector`, `dedupeSkills`.
- Produces: create/update payloads now include `avatarKey`, `title`, `bio`, `skills`.

- [ ] **Step 1: Add imports**

In `apps/client/src/pages/AgentConfigPage.tsx`, add after the existing component imports (around line 14):

```tsx
import { AvatarPicker } from '../components/AvatarPicker.js';
import { SkillsSelector } from '../components/SkillsSelector.js';
import { dedupeSkills } from '../constants/skills.js';
```

- [ ] **Step 2: Add state**

After the existing `const [outputs, ...]` state declaration (line 31), add:

```tsx
  const [avatarKey, setAvatarKey] = useState<string | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [bio, setBio] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
```

- [ ] **Step 3: Hydrate state on load**

Inside the `api.agents.get(id).then(a => { ... })` block (after `setOutputs(outs);`, ~line 50), add:

```tsx
        setAvatarKey(a.avatarKey ?? undefined);
        setTitle(a.title ?? '');
        setBio(a.bio ?? '');
        const skillList = (() => { try { return JSON.parse(a.skills || '[]') as string[]; } catch { return [] as string[]; } })();
        setSkills(skillList);
```

- [ ] **Step 4: Include fields in the save payload**

In `save()`, extend the `body` object (after `outputs,`):

```tsx
      outputs,
      avatarKey,
      title: title.trim() || undefined,
      bio: bio.trim() || undefined,
      skills: dedupeSkills(skills),
```

- [ ] **Step 5: Render the new fields**

In the JSX, immediately after the `<TextField label="Name" .../>` line (~line 84), add:

```tsx
        <AvatarPicker value={avatarKey} onChange={setAvatarKey} name={name || 'Agent'} />
        <TextField label="Title" value={title} onChange={e => setTitle(e.target.value)} fullWidth placeholder="e.g. Senior Bug Hunter" />
        <TextField label="Bio" value={bio} onChange={e => setBio(e.target.value)} fullWidth multiline minRows={2} placeholder="A short description of this agent's character" />
        <SkillsSelector value={skills} onChange={setSkills} />
```

- [ ] **Step 6: Typecheck**

Run: `cd apps/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual smoke check**

Run the dev stack (`npm run dev:server` and `npm run dev:client` from repo root). Create a new agent: pick an avatar, set title/bio, add a catalog skill and a custom skill, save. Re-open the agent in edit mode and confirm all fields are restored.

- [ ] **Step 8: Commit**

```bash
git add apps/client/src/pages/AgentConfigPage.tsx
git commit -m "feat(client): edit avatar, title, bio, and skills in AgentConfigPage"
```

---

### Task 7: Client — enhance AgentCard + profile navigation

**Files:**
- Modify: `apps/client/src/components/AgentCard.tsx`

**Interfaces:**
- Consumes: `AgentAvatar`; navigates to `/agents/:id` (profile) and `/agents/:id/edit`.
- Produces: card shows avatar + title + skill chips; body click opens the profile.

- [ ] **Step 1: Replace the component body**

Replace the contents of `apps/client/src/components/AgentCard.tsx` with:

```tsx
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import CardActions from '@mui/material/CardActions';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { useNavigate } from 'react-router-dom';
import { type Agent } from '../api/client.js';
import { useTriggerRun } from '../hooks/useAgents.js';
import { AgentAvatar } from './AgentAvatar.js';

interface Props { agent: Agent; onEdit: (id: string) => void; }

const MAX_VISIBLE_SKILLS = 4;

export function AgentCard({ agent, onEdit }: Props) {
  const trigger = useTriggerRun();
  const navigate = useNavigate();
  const parse = <T,>(raw: string | null | undefined, fallback: T): T => {
    try { return JSON.parse(raw || '') as T; } catch { return fallback; }
  };
  const repos = parse<string[]>(agent.repos, []);
  const skills = parse<string[]>(agent.skills, []);
  const visibleSkills = skills.slice(0, MAX_VISIBLE_SKILLS);
  const overflow = skills.length - visibleSkills.length;

  return (
    <Card sx={{ mb: 2 }}>
      <CardActionArea onClick={() => navigate(`/agents/${agent.id}`)}>
        <CardContent>
          <Box display="flex" gap={2} alignItems="center">
            <AgentAvatar avatarKey={agent.avatarKey} name={agent.name} size={48} />
            <Box flex={1} minWidth={0}>
              <Typography variant="h6">{agent.name}</Typography>
              {agent.title && (
                <Typography variant="body2" color="text.secondary">{agent.title}</Typography>
              )}
            </Box>
            <Chip
              label={agent.enabled ? 'active' : 'paused'}
              color={agent.enabled ? 'success' : 'default'}
              size="small"
            />
          </Box>
          <Box mt={1}>
            <Chip label={agent.type} size="small" sx={{ mr: 1 }} />
            <Chip label={agent.model} size="small" variant="outlined" />
          </Box>
          {visibleSkills.length > 0 && (
            <Stack direction="row" spacing={1} mt={1} flexWrap="wrap" useFlexGap>
              {visibleSkills.map((s) => (
                <Chip key={s} label={s} size="small" color="primary" variant="outlined" />
              ))}
              {overflow > 0 && <Chip label={`+${overflow}`} size="small" />}
            </Stack>
          )}
          <Typography variant="body2" color="text.secondary" mt={1}>
            {repos.join(', ') || 'No repos configured'}
          </Typography>
        </CardContent>
      </CardActionArea>
      <CardActions>
        <Button size="small" onClick={() => onEdit(agent.id)}>Edit</Button>
        <Button
          size="small" variant="contained" startIcon={<PlayArrowIcon />}
          onClick={() => trigger.mutate(agent.id, { onSuccess: (run) => navigate(`/runs/${run.id}`) })}
          disabled={trigger.isPending}
        >
          Run
        </Button>
      </CardActions>
    </Card>
  );
}
```

- [ ] **Step 2: Point the Edit action at the edit route**

In `apps/client/src/pages/AgentsPage.tsx`, change the card's `onEdit` (line 22) from `navigate(\`/agents/${id}\`)` to:

```tsx
        <AgentCard key={a.id} agent={a} onEdit={id => navigate(`/agents/${id}/edit`)} />
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/client && npx tsc --noEmit`
Expected: no errors. (Note: the profile route `/agents/:id` is added in Task 8; until then the card body click 404s — acceptable mid-plan.)

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/components/AgentCard.tsx apps/client/src/pages/AgentsPage.tsx
git commit -m "feat(client): show avatar, title, and skills on AgentCard"
```

---

### Task 8: Client — AgentProfilePage + route restructure

**Files:**
- Create: `apps/client/src/pages/AgentProfilePage.tsx`
- Modify: `apps/client/src/App.tsx`

**Interfaces:**
- Consumes: `api.agents.get`, `useRuns`, `AgentAvatar`, `RunStatusBadge`.
- Produces: profile view at `/agents/:id`; config moved to `/agents/:id/edit`.

- [ ] **Step 1: Create the profile page**

Create `apps/client/src/pages/AgentProfilePage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import { api, type Agent } from '../api/client.js';
import { useRuns } from '../hooks/useRuns.js';
import { AgentAvatar } from '../components/AgentAvatar.js';
import { RunStatusBadge } from '../components/RunStatusBadge.js';

const MAX_ACTIVITY = 10;

export function AgentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: runs } = useRuns();

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    api.agents.get(id)
      .then((a) => { if (!controller.signal.aborted) setAgent(a); })
      .catch((err) => { if (!controller.signal.aborted) setError(String(err)); });
    return () => controller.abort();
  }, [id]);

  if (error) return <Typography color="error">Agent not found.</Typography>;
  if (!agent) return <CircularProgress sx={{ mt: 2 }} />;

  const skills = (() => { try { return JSON.parse(agent.skills || '[]') as string[]; } catch { return []; } })();
  const activity = (runs ?? [])
    .filter((r) => r.agentId === agent.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_ACTIVITY);

  return (
    <Box maxWidth={720}>
      <Box display="flex" gap={3} alignItems="center">
        <AgentAvatar avatarKey={agent.avatarKey} name={agent.name} size={96} />
        <Box>
          <Box display="flex" alignItems="center" gap={1.5}>
            <Typography variant="h4">{agent.name}</Typography>
            <Chip
              label={agent.enabled ? 'online' : 'paused'}
              color={agent.enabled ? 'success' : 'default'} size="small"
            />
          </Box>
          {agent.title && <Typography variant="h6" color="text.secondary">{agent.title}</Typography>}
          {agent.bio && <Typography variant="body1" mt={1}>{agent.bio}</Typography>}
        </Box>
      </Box>

      <Box mt={3}>
        <Typography variant="subtitle2" gutterBottom>Skills</Typography>
        {skills.length > 0 ? (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {skills.map((s) => <Chip key={s} label={s} color="primary" variant="outlined" />)}
          </Stack>
        ) : <Typography color="text.secondary" variant="body2">No skills yet.</Typography>}
      </Box>

      <Divider sx={{ my: 3 }} />

      <Typography variant="subtitle2" gutterBottom>Recent activity</Typography>
      {activity.length > 0 ? (
        <Stack spacing={1}>
          {activity.map((run) => (
            <Box
              key={run.id} display="flex" alignItems="center" gap={2}
              sx={{ cursor: 'pointer' }} onClick={() => navigate(`/runs/${run.id}`)}
            >
              <RunStatusBadge status={run.status} />
              <Typography variant="body2">{run.trigger}</Typography>
              <Typography variant="body2" color="text.secondary">
                {new Date(run.createdAt).toLocaleString()}
              </Typography>
            </Box>
          ))}
        </Stack>
      ) : <Typography color="text.secondary" variant="body2">No runs yet.</Typography>}

      <Box mt={3}>
        <Button variant="outlined" onClick={() => navigate(`/agents/${agent.id}/edit`)}>
          Configure agent
        </Button>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Restructure the routes**

In `apps/client/src/App.tsx`, add the import:

```tsx
import { AgentProfilePage } from './pages/AgentProfilePage.js';
```

Replace the single agents route (line 23) with these three (order matters — static `new` and the `:id/edit` route before the bare `:id`):

```tsx
              <Route path="/agents/new" element={<AgentConfigPage />} />
              <Route path="/agents/:id/edit" element={<AgentConfigPage />} />
              <Route path="/agents/:id" element={<AgentProfilePage />} />
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke check**

With the dev stack running: from the Agents list, click a card body → profile page shows avatar/title/bio/skills and recent activity; click "Configure agent" → edit form loads; from the list, "Edit" → edit form; "+ New Agent" → create form. Trigger a run and confirm it appears under the agent's recent activity within a few seconds.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/pages/AgentProfilePage.tsx apps/client/src/App.tsx
git commit -m "feat(client): add agent profile page and restructure agent routes"
```

---

## Self-Review

- **Spec coverage:** data model (Task 1) ✓; server round-trip (Task 1) ✓; client catalogs A (Task 3) ✓; AgentAvatar + fallback (Task 4) ✓; AvatarPicker + SkillsSelector with custom (Task 5) ✓; enhanced config (Task 6) ✓; enhanced card (Task 7) ✓; profile page + recent activity reusing runs (Task 8) ✓; testing — server Jest TDD (Task 1), client typecheck+smoke per Global Constraints ✓; non-goals respected (no runner changes, no uploads, no live stream) ✓.
- **Placeholder scan:** none — every code step has full content.
- **Type consistency:** `Agent.skills: string` (JSON) parsed consistently in AgentCard/Profile; `AgentInput.skills?: string[]`; `AvatarOption`/`getAvatar`/`AVATAR_GALLERY` and `SKILL_CATALOG`/`dedupeSkills` names match across Tasks 3–8; route field names (`avatarKey`/`title`/`bio`/`skills`) match schema columns and client types.
