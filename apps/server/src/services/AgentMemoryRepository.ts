import { eq, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import { agentMemory } from '../db/schema.js';

export type MemoryRow = typeof agentMemory.$inferSelect;

export const AgentMemoryRepository = {
  listForAgent(agentId: string, limit: number): MemoryRow[] {
    return getDb().select().from(agentMemory)
      .where(eq(agentMemory.agentId, agentId))
      .orderBy(desc(agentMemory.createdAt))
      .limit(limit)
      .all();
  },
  append(data: { agentId: string; runId: string | null; note: string }): MemoryRow {
    const row: MemoryRow = {
      id: randomUUID(),
      agentId: data.agentId,
      runId: data.runId,
      note: data.note,
      createdAt: new Date().toISOString(),
    };
    getDb().insert(agentMemory).values(row).run();
    return row;
  },
  clearForAgent(agentId: string): void {
    getDb().delete(agentMemory).where(eq(agentMemory.agentId, agentId)).run();
  },
};
