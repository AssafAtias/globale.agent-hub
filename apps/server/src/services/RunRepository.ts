import { eq, and, desc } from 'drizzle-orm';
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
  create(data: Pick<RunRow, 'agentId' | 'trigger' | 'triggerPayload' | 'context'> & { replyTo?: string | null }): RunRow {
    const row: RunRow = {
      id: randomUUID(),
      status: 'pending',
      runnerId: null,
      result: null,
      error: null,
      startedAt: null,
      finishedAt: null,
      archived: false,
      createdAt: new Date().toISOString(),
      sessionId: null,
      pendingGate: null,
      pendingResponse: null,
      replyTo: null,
      ...data,
    };
    getDb().insert(runs).values(row).run();
    return row;
  },
  createCompleted(data: { agentId: string; trigger: string; result: string }): RunRow {
    const now = new Date().toISOString();
    const row: RunRow = {
      id: randomUUID(), agentId: data.agentId, trigger: data.trigger,
      triggerPayload: '{}', context: '{}',
      status: 'done', runnerId: null, result: data.result, error: null,
      startedAt: now, finishedAt: now, archived: false, createdAt: now,
      sessionId: null, pendingGate: null, pendingResponse: null, replyTo: null,
    };
    getDb().insert(runs).values(row).run();
    return row;
  },
  // Atomically claim the next pending run for a runner.
  // Uses better-sqlite3's synchronous transaction with BEGIN IMMEDIATE so only
  // one writer can enter at a time — no TOCTOU race between concurrent runners.
  claimNext(runnerId: string): RunRow | null {
    const startedAt = new Date().toISOString();
    const db = getDb();
    const sqlite = (db as any).$client as import('better-sqlite3').Database;

    const claim = sqlite.transaction(() => {
      const pending = db.select().from(runs).where(eq(runs.status, 'pending')).get();
      if (!pending) return null;

      db.update(runs).set({
        status: 'running',
        runnerId,
        startedAt,
      }).where(and(eq(runs.id, pending.id), eq(runs.status, 'pending'))).run();

      return db.select().from(runs).where(eq(runs.id, pending.id)).get() ?? null;
    });

    return claim() as RunRow | null;
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
  setArchived(id: string, archived: boolean): RunRow | null {
    const db = getDb();
    db.update(runs).set({ archived }).where(eq(runs.id, id)).run();
    return db.select().from(runs).where(eq(runs.id, id)).get() ?? null;
  },
  lastScheduledRun(agentId: string) {
    return getDb().select().from(runs)
      .where(and(eq(runs.agentId, agentId), eq(runs.trigger, 'schedule')))
      .orderBy(desc(runs.createdAt))
      .limit(1)
      .get() ?? null;
  },
};
