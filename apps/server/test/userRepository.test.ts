import { getDb, resetDb } from '../src/db/client.js';
import { UserRepository } from '../src/services/UserRepository.js';

function setup() {
  const db = getDb(':memory:');
  (db as any).$client.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member',
      entra_object_id TEXT, name TEXT);
  `);
}

describe('UserRepository', () => {
  beforeEach(() => { resetDb(); setup(); });
  afterAll(() => resetDb());

  it('first user becomes admin, second is member', () => {
    const a = UserRepository.upsertByEntraOid({ entraObjectId: 'oid-a', email: 'a@x', name: 'A' });
    const b = UserRepository.upsertByEntraOid({ entraObjectId: 'oid-b', email: 'b@x', name: 'B' });
    expect(a.role).toBe('admin');
    expect(b.role).toBe('member');
  });

  it('upsert is idempotent on oid and updates email/name', () => {
    const a1 = UserRepository.upsertByEntraOid({ entraObjectId: 'oid-a', email: 'a@x', name: 'A' });
    const a2 = UserRepository.upsertByEntraOid({ entraObjectId: 'oid-a', email: 'a2@x', name: 'A2' });
    expect(a2.id).toBe(a1.id);
    expect(a2.email).toBe('a2@x');
    expect(UserRepository.findAll()).toHaveLength(1);
  });

  it('setRole updates role', () => {
    const b = UserRepository.upsertByEntraOid({ entraObjectId: 'oid-a', email: 'a@x', name: 'A' });
    const upd = UserRepository.setRole(b.id, 'member');
    expect(upd?.role).toBe('member');
  });
});
