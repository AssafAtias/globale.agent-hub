import { getDb, resetDb } from '../src/db/client.js';
import { runDueAgents } from '../src/services/Scheduler.js';
import { RunRepository } from '../src/services/RunRepository.js';

function setup() {
  const c = (getDb(':memory:') as any).$client;
  c.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, model TEXT NOT NULL,
      prompt TEXT NOT NULL, repos TEXT NOT NULL, trigger_rules TEXT NOT NULL, outputs TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, avatar_key TEXT, title TEXT, bio TEXT,
      skills TEXT NOT NULL DEFAULT '[]', focus TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0, workflow TEXT, teams_target TEXT, owner_id TEXT
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, trigger TEXT NOT NULL, trigger_payload TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending', runner_id TEXT,
      result TEXT, error TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
      archived INTEGER NOT NULL DEFAULT 0, session_id TEXT, pending_gate TEXT, pending_response TEXT, reply_to TEXT, user_id TEXT
    );
  `);
  return c;
}

function addAgent(c: any, id: string, opts: { enabled?: number; archived?: number; cron?: string } = {}) {
  const rules = JSON.stringify(opts.cron ? { events: [], cron: opts.cron } : { events: [] });
  c.prepare(
    `INSERT INTO agents (id,name,type,model,prompt,repos,trigger_rules,outputs,enabled,created_at,archived)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, id, 'pr-review', 'm', 'p', '["bitbucket:g/core"]', rules, '[]',
        opts.enabled ?? 1, '2026-01-01T00:00:00Z', opts.archived ?? 0);
}

let client: any;
beforeEach(() => { resetDb(); client = setup(); });

const scheduleRuns = () => RunRepository.findAll().filter(r => r.trigger === 'schedule');

describe('runDueAgents', () => {
  it('creates exactly one schedule run, only for the due enabled cron agent', () => {
    addAgent(client, 'due', { cron: '* * * * *' });
    addAgent(client, 'nocron', {});
    addAgent(client, 'disabled', { enabled: 0, cron: '* * * * *' });
    addAgent(client, 'archived', { archived: 1, cron: '* * * * *' });
    runDueAgents(new Date());
    const runs = scheduleRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].agentId).toBe('due');
    expect(JSON.parse(runs[0].context)['Scheduled run']).toMatch(/scheduled/i);
  });

  it('does not create a duplicate within the same slot', () => {
    addAgent(client, 'due', { cron: '* * * * *' });
    const now = new Date();
    runDueAgents(now);
    runDueAgents(now);
    expect(scheduleRuns()).toHaveLength(1);
  });
});
