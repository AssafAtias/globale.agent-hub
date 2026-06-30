export const MAX_HANDOFF_DEPTH = 3;

export function parseParentChain(parentTriggerPayload: string): { depth: number; chainAgentIds: string[] } {
  try {
    const p = JSON.parse(parentTriggerPayload || '{}') as { handoff?: { depth?: unknown; chainAgentIds?: unknown } };
    const h = p.handoff;
    const depth = typeof h?.depth === 'number' ? h.depth : 0;
    const chainAgentIds = Array.isArray(h?.chainAgentIds) ? (h!.chainAgentIds as string[]) : [];
    return { depth, chainAgentIds };
  } catch {
    return { depth: 0, chainAgentIds: [] };
  }
}

export function planHandoff(
  parent: { id: string; agentId: string; triggerPayload: string },
  targetAgentId: string,
  message: string,
): { spawn: true; childTriggerPayload: string; context: string } | { spawn: false; reason: string } {
  const { depth, chainAgentIds } = parseParentChain(parent.triggerPayload);
  if (depth >= MAX_HANDOFF_DEPTH) return { spawn: false, reason: `max handoff depth ${MAX_HANDOFF_DEPTH} reached` };
  if (targetAgentId === parent.agentId) return { spawn: false, reason: 'self-handoff refused' };
  if (chainAgentIds.includes(targetAgentId)) return { spawn: false, reason: 'cycle: target already in chain' };
  return {
    spawn: true,
    childTriggerPayload: JSON.stringify({
      handoff: { fromRunId: parent.id, fromAgentId: parent.agentId, depth: depth + 1, chainAgentIds: [...chainAgentIds, parent.agentId] },
    }),
    context: JSON.stringify({ 'Handoff request': message }),
  };
}
