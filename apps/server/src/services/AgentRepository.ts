import { eq, asc, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import { agents } from '../db/schema.js';

export type AgentRow = typeof agents.$inferSelect;
export type AgentInsert = Omit<
  AgentRow,
  'id' | 'createdAt' | 'enabled' | 'avatarKey' | 'title' | 'bio' | 'skills' | 'focus' | 'sortOrder' | 'archived' | 'workflow'
> & {
  enabled?: boolean;
  avatarKey?: string | null;
  title?: string | null;
  bio?: string | null;
  skills?: string; // JSON string: string[]
  focus?: string | null;
  workflow?: string | null;
};

export const AgentRepository = {
  findAll({ includeArchived = false }: { includeArchived?: boolean } = {}) {
    const db = getDb();
    if (includeArchived) {
      return db.select().from(agents).orderBy(asc(agents.sortOrder)).all();
    }
    return db.select().from(agents)
      .where(eq(agents.archived, false))
      .orderBy(asc(agents.sortOrder))
      .all();
  },
  findById(id: string) {
    return getDb().select().from(agents).where(eq(agents.id, id)).get() ?? null;
  },
  create(data: AgentInsert): AgentRow {
    const db = getDb();
    const maxRow = db.select({ max: sql<number | null>`max(${agents.sortOrder})` }).from(agents).get();
    const nextOrder = (maxRow?.max ?? -1) + 1;
    const row = {
      ...data,
      id: randomUUID(),
      enabled: data.enabled ?? true,
      createdAt: new Date().toISOString(),
      avatarKey: data.avatarKey ?? null,
      title: data.title ?? null,
      bio: data.bio ?? null,
      skills: data.skills ?? '[]',
      focus: data.focus ?? null,
      workflow: data.workflow ?? null,
      sortOrder: nextOrder,
      archived: false,
    };
    db.insert(agents).values(row).run();
    return row;
  },
  update(id: string, data: Partial<AgentInsert>) {
    getDb().update(agents).set(data).where(eq(agents.id, id)).run();
    return AgentRepository.findById(id);
  },
  setArchived(id: string, archived: boolean): AgentRow | null {
    const db = getDb();
    db.update(agents).set({ archived }).where(eq(agents.id, id)).run();
    return db.select().from(agents).where(eq(agents.id, id)).get() ?? null;
  },
  reorder(orderedIds: string[]): void {
    const db = getDb();
    const sqlite = (db as any).$client as import('better-sqlite3').Database;
    const tx = sqlite.transaction(() => {
      orderedIds.forEach((id, index) => {
        db.update(agents).set({ sortOrder: index }).where(eq(agents.id, id)).run();
      });
    });
    tx();
  },
  delete(id: string) {
    getDb().delete(agents).where(eq(agents.id, id)).run();
  },
};
