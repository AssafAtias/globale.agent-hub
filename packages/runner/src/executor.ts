import Anthropic from '@anthropic-ai/sdk';

export interface Job {
  run: {
    id: string;
    agentId: string;
    context: string; // JSON string
  };
  agent: {
    name: string;
    model: string;
    prompt: string;
  };
}

export async function executeJob(job: Job, apiKey: string): Promise<string> {
  const client = new Anthropic({ apiKey });

  const contextObj = JSON.parse(job.run.context || '{}');
  const contextText = formatContext(contextObj);

  const message = await client.messages.create({
    model: job.agent.model,
    max_tokens: 8096,
    system: job.agent.prompt,
    messages: [{ role: 'user', content: contextText }],
  });

  const textBlock = message.content.find(b => b.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : '(no output)';
}

function formatContext(ctx: Record<string, unknown>): string {
  if (!ctx || Object.keys(ctx).length === 0) {
    return 'No context available. Please perform a general review.';
  }
  return Object.entries(ctx)
    .map(([k, v]) => `## ${k}\n\n${typeof v === 'string' ? v : JSON.stringify(v, null, 2)}`)
    .join('\n\n---\n\n');
}
