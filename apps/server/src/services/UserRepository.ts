import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import { users } from '../db/schema.js';

export type UserRow = typeof users.$inferSelect;

export const UserRepository = {
  findById(id: string): UserRow | null {
    return getDb().select().from(users).where(eq(users.id, id)).get() ?? null;
  },
  findByEntraOid(oid: string): UserRow | null {
    return getDb().select().from(users).where(eq(users.entraObjectId, oid)).get() ?? null;
  },
  findAll(): UserRow[] {
    return getDb().select().from(users).all();
  },
  upsertByEntraOid(data: { entraObjectId: string; email: string; name: string }): UserRow {
    const existing = this.findByEntraOid(data.entraObjectId);
    if (existing) {
      getDb().update(users).set({ email: data.email, name: data.name }).where(eq(users.id, existing.id)).run();
      return { ...existing, email: data.email, name: data.name };
    }
    const isFirst = getDb().select().from(users).all().length === 0;
    const row: UserRow = {
      id: randomUUID(),
      email: data.email,
      role: isFirst ? 'admin' : 'member',
      entraObjectId: data.entraObjectId,
      name: data.name,
    };
    getDb().insert(users).values(row).run();
    return row;
  },
  setRole(id: string, role: 'admin' | 'member'): UserRow | null {
    getDb().update(users).set({ role }).where(eq(users.id, id)).run();
    return this.findById(id);
  },
};
