import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import { runs } from '../db/schema.js';

export type RunRow = typeof runs.$inferSelect;

export const RunRepository = {
  findAll() {
    return getDb().select().from(runs).orderBy(runs.createdAt).all();
  },
  findById(id: string) {
    return getDb().select().from(runs).where(eq(runs.id, id)).get() ?? null;
  },
  create(data: Pick<RunRow, 'agentId' | 'trigger' | 'triggerPayload' | 'context'>): RunRow {
    const row: RunRow = {
      id: randomUUID(),
      status: 'pending',
      runnerId: null,
      result: null,
      error: null,
      startedAt: null,
      finishedAt: null,
      createdAt: new Date().toISOString(),
      ...data,
    };
    getDb().insert(runs).values(row).run();
    return row;
  },
  // Atomically claim the next pending run for a runner
  claimNext(runnerId: string): RunRow | null {
    const run = getDb()
      .select().from(runs)
      .where(eq(runs.status, 'pending'))
      .get();
    if (!run) return null;
    getDb().update(runs).set({
      status: 'running',
      runnerId,
      startedAt: new Date().toISOString(),
    }).where(and(eq(runs.id, run.id), eq(runs.status, 'pending'))).run();
    return RunRepository.findById(run.id);
  },
  complete(id: string, result: string) {
    getDb().update(runs).set({
      status: 'done',
      result,
      finishedAt: new Date().toISOString(),
    }).where(eq(runs.id, id)).run();
  },
  fail(id: string, error: string) {
    getDb().update(runs).set({
      status: 'failed',
      error,
      finishedAt: new Date().toISOString(),
    }).where(eq(runs.id, id)).run();
  },
};
