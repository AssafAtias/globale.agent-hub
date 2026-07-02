import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { agents } from '../db/schema.js';

/** The user who owns non-manual runs of this agent (its ownerId), or null. */
export function ownerForAgent(agentId: string): string | null {
  const row = getDb().select({ ownerId: agents.ownerId }).from(agents).where(eq(agents.id, agentId)).get();
  return (row?.ownerId as string | undefined) ?? null;
}
