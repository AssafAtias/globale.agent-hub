import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import { agents } from '../db/schema.js';

export type AgentRow = typeof agents.$inferSelect;
export type AgentInsert = Omit<AgentRow, 'id' | 'createdAt' | 'enabled'> & { enabled?: boolean };

export const AgentRepository = {
  findAll() {
    return getDb().select().from(agents).all();
  },
  findById(id: string) {
    return getDb().select().from(agents).where(eq(agents.id, id)).get() ?? null;
  },
  create(data: AgentInsert): AgentRow {
    const row = {
      ...data,
      id: randomUUID(),
      enabled: data.enabled ?? true,
      createdAt: new Date().toISOString(),
    };
    getDb().insert(agents).values(row).run();
    return row;
  },
  update(id: string, data: Partial<AgentInsert>) {
    getDb().update(agents).set(data).where(eq(agents.id, id)).run();
    return AgentRepository.findById(id);
  },
  delete(id: string) {
    getDb().delete(agents).where(eq(agents.id, id)).run();
  },
};
