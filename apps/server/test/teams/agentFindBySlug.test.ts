import { getDb, resetDb } from '../../src/db/client.js';
import { AgentRepository } from '../../src/services/AgentRepository.js';

beforeEach(() => {
  resetDb();
  const db = getDb(':memory:');
  (db as any).$client.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, model TEXT NOT NULL,
      prompt TEXT NOT NULL, repos TEXT NOT NULL, trigger_rules TEXT NOT NULL,
      outputs TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
      avatar_key TEXT, title TEXT, bio TEXT, skills TEXT NOT NULL DEFAULT '[]', focus TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
      workflow TEXT, teams_target TEXT, owner_id TEXT
    )
  `);
});
afterAll(() => resetDb());

function make(name: string) {
  return AgentRepository.create({
    name, type: 'pr-review', model: 'm', prompt: 'p',
    repos: '[]', triggerRules: '{}', outputs: '[]',
  } as any);
}

it('finds an agent by slugified name', () => {
  const a = make('PR Review');
  expect(AgentRepository.findBySlug('pr-review')?.id).toBe(a.id);
  expect(AgentRepository.findBySlug('nope')).toBeNull();
});

it('ignores archived agents', () => {
  const a = make('Archived One');
  AgentRepository.setArchived(a.id, true);
  expect(AgentRepository.findBySlug('archived-one')).toBeNull();
});

it('setTeamsTarget persists a conversation reference', () => {
  const a = make('Reporter');
  AgentRepository.setTeamsTarget(a.id, '{"conversation":{"id":"ch1"}}');
  expect(AgentRepository.findById(a.id)?.teamsTarget).toBe('{"conversation":{"id":"ch1"}}');
});
