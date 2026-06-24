import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { LocalEnricher } from './context/LocalEnricher.js';

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
    repos: string;
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

export async function executeJob(job: Job, apiKey: string, localReposRoot: string): Promise<string> {
  const enricher = new LocalEnricher(localReposRoot);
  const agentRepos = (() => { try { return JSON.parse(job.agent.repos || '[]') as string[]; } catch { return [] as string[]; } })();
  const enrichedContextStr = enricher.enrich(job.run.context, agentRepos);
  const contextText = formatContext(safeParseContext(enrichedContextStr));

  return runClaude(apiKey, job.agent.model, job.agent.prompt, contextText);
}

// Build an Anthropic client. Two auth modes:
//  1. A real API key (sk-ant-api...) in ANTHROPIC_API_KEY → standard x-api-key auth.
//  2. Otherwise, the live Claude Code OAuth token from ~/.claude/.credentials.json
//     → Bearer auth + the oauth beta header (uses the logged-in Claude subscription,
//     no paid API key). Read fresh each call so Claude Code's token refreshes are
//     picked up. Note: this token expires (~hours) and is only refreshed while
//     Claude Code itself runs; subscription rate limits apply (429s are shared).
function buildClient(apiKey: string): Anthropic {
  if (apiKey && apiKey.startsWith('sk-ant-api')) {
    return new Anthropic({ apiKey, maxRetries: 3 });
  }
  const token = readClaudeOAuthToken();
  if (!token) {
    throw new Error(
      'No usable credentials. Set ANTHROPIC_API_KEY to a real API key (sk-ant-api...), ' +
      'or log in with Claude Code so ~/.claude/.credentials.json contains an OAuth token.',
    );
  }
  // apiKey: null prevents the SDK from auto-reading ANTHROPIC_API_KEY from the
  // environment and sending x-api-key alongside the Bearer token — the API
  // rejects requests that carry both.
  return new Anthropic({
    apiKey: null,
    authToken: token,
    defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' },
    maxRetries: 3,
  });
}

function readClaudeOAuthToken(): string | null {
  try {
    const raw = readFileSync(join(homedir(), '.claude', '.credentials.json'), 'utf8');
    const creds = JSON.parse(raw) as { claudeAiOauth?: { accessToken?: string } };
    return creds.claudeAiOauth?.accessToken ?? null;
  } catch {
    return null;
  }
}

// Call the Anthropic Messages API over HTTPS via the official SDK. This replaces
// the previous approach of spawning the local claude.exe CLI, which CrowdStrike
// Falcon blocks (node.exe spawning the 236MB binary trips a behavioral rule →
// "spawn EPERM"). An HTTPS API call spawns no child process, so it isn't blocked.
// Requires a valid ANTHROPIC_API_KEY (sk-ant-api...), unlike the CLI which used
// the logged-in session.
async function runClaude(apiKey: string, model: string, systemPrompt: string, userMessage: string): Promise<string> {
  const client = buildClient(apiKey);

  const response = await client.messages.create({
    model,
    max_tokens: 16000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude declined the request (stop_reason: refusal)');
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  return text || '(no output)';
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
