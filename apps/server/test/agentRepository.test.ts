import { getDb, resetDb } from '../src/db/client.js';
import { AgentRepository, type AgentInsert } from '../src/services/AgentRepository.js';

function setupInMemoryDb() {
  const db = getDb(':memory:');
  (db as any).$client.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
      model TEXT NOT NULL, prompt TEXT NOT NULL, repos TEXT NOT NULL,
      trigger_rules TEXT NOT NULL, outputs TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
      avatar_key TEXT, title TEXT, bio TEXT,
      skills TEXT NOT NULL DEFAULT '[]', focus TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
      workflow TEXT
    );
  `);
  return db;
}

const base: AgentInsert = {
  name: 'A', type: 'pr-review', model: 'm', prompt: 'p',
  repos: '[]', triggerRules: '{}', outputs: '[]',
};

beforeEach(() => { resetDb(); setupInMemoryDb(); });
afterAll(() => resetDb());

describe('AgentRepository ordering + archive', () => {
  it('create appends with incrementing sortOrder', () => {
    const a = AgentRepository.create({ ...base, name: 'A' });
    const b = AgentRepository.create({ ...base, name: 'B' });
    expect(a.sortOrder).toBe(0);
    expect(b.sortOrder).toBe(1);
    expect(a.archived).toBe(false);
  });

  it('findAll orders by sortOrder and excludes archived by default', () => {
    const a = AgentRepository.create({ ...base, name: 'A' });
    const b = AgentRepository.create({ ...base, name: 'B' });
    AgentRepository.setArchived(b.id, true);

    const visible = AgentRepository.findAll();
    expect(visible.map(x => x.id)).toEqual([a.id]);

    const all = AgentRepository.findAll({ includeArchived: true });
    expect(all.map(x => x.id)).toEqual([a.id, b.id]);
  });

  it('setArchived toggles the flag and returns the row', () => {
    const a = AgentRepository.create({ ...base });
    expect(AgentRepository.setArchived(a.id, true)?.archived).toBe(true);
    expect(AgentRepository.setArchived(a.id, false)?.archived).toBe(false);
    expect(AgentRepository.setArchived('missing', true)).toBeNull();
  });

  it('reorder writes sortOrder = index for the given ids', () => {
    const a = AgentRepository.create({ ...base, name: 'A' });
    const b = AgentRepository.create({ ...base, name: 'B' });
    const c = AgentRepository.create({ ...base, name: 'C' });

    AgentRepository.reorder([c.id, a.id, b.id]);

    expect(AgentRepository.findAll().map(x => x.id)).toEqual([c.id, a.id, b.id]);
  });

  it('reorder skips unknown ids without throwing', () => {
    const a = AgentRepository.create({ ...base });
    expect(() => AgentRepository.reorder([a.id, 'ghost'])).not.toThrow();
    expect(AgentRepository.findAll().map(x => x.id)).toEqual([a.id]);
  });
});
