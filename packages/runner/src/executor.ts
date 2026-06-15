import Anthropic from '@anthropic-ai/sdk';

export interface Job {
  run: {
    id: string;
    agentId: string;
    context: string;
  };
  agent: {
    name: string;
    model: string;
    prompt: string;
  };
}

export function isJob(v: unknown): v is Job {
  if (!v || typeof v !== 'object') return false;
  const j = v as Record<string, unknown>;
  return (
    typeof (j['run'] as Record<string, unknown>)?.['id'] === 'string' &&
    typeof (j['run'] as Record<string, unknown>)?.['agentId'] === 'string' &&
    typeof (j['agent'] as Record<string, unknown>)?.['model'] === 'string' &&
    typeof (j['agent'] as Record<string, unknown>)?.['prompt'] === 'string'
  );
}

export async function executeJob(job: Job, client: Anthropic): Promise<string> {
  const contextText = formatContext(safeParseContext(job.run.context));

  const message = await client.messages.create({
    model: job.agent.model,
    max_tokens: 8096,
    system: job.agent.prompt,
    messages: [{ role: 'user', content: contextText }],
  });

  const textBlock = message.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    console.warn(`[runner] No text content in Claude response for run ${job.run.id}`);
    return '(no output)';
  }
  return textBlock.text;
}

function safeParseContext(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    console.warn('[runner] Could not parse run context JSON, using empty context');
    return {};
  }
}

function formatContext(ctx: Record<string, unknown>): string {
  if (Object.keys(ctx).length === 0) {
    return 'No context available. Please perform a general review.';
  }
  return Object.entries(ctx)
    .map(([k, v]) => `## ${k}\n\n${typeof v === 'string' ? v : JSON.stringify(v, null, 2)}`)
    .join('\n\n---\n\n');
}
