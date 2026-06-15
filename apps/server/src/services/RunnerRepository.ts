import { eq } from 'drizzle-orm';
import { randomUUID, createHash } from 'crypto';
import { getDb } from '../db/client.js';
import { runners } from '../db/schema.js';

export type RunnerRow = typeof runners.$inferSelect;

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export const RunnerRepository = {
  register(name: string, token: string): { runner: RunnerRow; token: string } {
    const id = randomUUID();
    const row: RunnerRow = {
      id,
      name,
      tokenHash: hashToken(token),
      lastSeen: new Date().toISOString(),
      status: 'online',
    };
    getDb().insert(runners).values(row).run();
    return { runner: row, token };
  },
  findByToken(token: string): RunnerRow | null {
    return getDb().select().from(runners)
      .where(eq(runners.tokenHash, hashToken(token))).get() ?? null;
  },
  heartbeat(id: string) {
    getDb().update(runners).set({
      lastSeen: new Date().toISOString(),
      status: 'online',
    }).where(eq(runners.id, id)).run();
  },
  findAll() {
    return getDb().select().from(runners).all();
  },
};
