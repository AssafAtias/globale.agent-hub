import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';
import { LocalEnricher } from './context/LocalEnricher.js';
import { SkillLoader } from './context/SkillLoader.js';
import { WorkflowLoader } from './context/WorkflowLoader.js';
import { resolveRepoPaths } from './context/repoPaths.js';
import { buildToolArgs } from './toolPolicy.js';

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
    skills?: string;
    workflow?: string;
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

export interface MemoryInput {
  focus: string | null;
  entries: { note: string }[];
}

const MEMORY_INSTRUCTION =
  'To record something for your future self, end your reply with a single ' +
  '<memory-update>...</memory-update> block containing a concise note (what you did / what you learned). ' +
  'Write nothing there if there is nothing worth remembering.';

export function extractMemoryUpdate(text: string): { result: string; note: string | null } {
  const m = text.match(/<memory-update>([\s\S]*?)<\/memory-update>/);
  if (!m) return { result: text, note: null };
  const note = m[1].trim();
  const result = (text.slice(0, m.index) + text.slice(m.index! + m[0].length)).trim();
  return { result, note: note.length > 0 ? note : null };
}

export interface GatePayload {
  id: string; summary?: string; question: string;
  kind: 'approve_reject' | 'input' | 'choice'; options?: string[];
}

export function extractGate(text: string): { gate: GatePayload | null } {
  const m = text.match(/<gate>([\s\S]*?)<\/gate>/);
  if (!m) return { gate: null };
  let parsed: GatePayload;
  try { parsed = JSON.parse(m[1].trim()); }
  catch { throw new Error(`Agent emitted a malformed <gate> block: ${m[1].slice(0, 200)}`); }
  if (!parsed.id || !parsed.question || !parsed.kind) {
    throw new Error(`Gate block missing required fields: ${m[1].slice(0, 200)}`);
  }
  return { gate: parsed };
}

const GATE_PROTOCOL =
  'Each turn is non-interactive. When the workflow says STOP at a ⛔ gate, end your turn ' +
  'with exactly one <gate>{...}</gate> JSON block and STOP — do not proceed past it. ' +
  'You will be re-invoked with the user\'s response and continue. JSON shape: ' +
  '{ "id": string, "summary": string, "question": string, "kind": "approve_reject"|"input"|"choice", "options"?: string[] }. ' +
  'When fully done, end normally with NO gate block.';

export async function executeJob(
  job: Job, localReposRoot: string, skillsDir: string, workflowsDir: string,
  memory: MemoryInput, toolsEnabled: boolean,
): Promise<{ result: string; note: string | null }> {
  const enricher = new LocalEnricher(localReposRoot);
  const agentRepos = (() => { try { return JSON.parse(job.agent.repos || '[]') as string[]; } catch { return [] as string[]; } })();
  const enrichedContextStr = enricher.enrich(job.run.context, agentRepos);
  const contextText = formatContext(safeParseContext(enrichedContextStr));

  const skillNames = (() => { try { return JSON.parse(job.agent.skills || '[]') as string[]; } catch { return [] as string[]; } })();
  const skillsText = new SkillLoader(skillsDir).load(skillNames);

  const parts: string[] = [];
  if (skillsText) parts.push(`## Skills\n\n${skillsText}`);
  if (memory.focus && memory.focus.trim()) parts.push(`## Focus\n\n${memory.focus.trim()}`);
  if (memory.entries.length > 0) {
    const bullets = memory.entries.map((e) => `- ${e.note}`).join('\n');
    parts.push(`## Memory (recent)\n\n${bullets}\n\n${MEMORY_INSTRUCTION}`);
  } else {
    parts.push(MEMORY_INSTRUCTION);
  }
  const workflowText = new WorkflowLoader(workflowsDir).load(job.agent.workflow);
  if (workflowText) parts.push(`## Workflow\n\n${workflowText}`);
  parts.push(job.agent.prompt);
  const systemPrompt = parts.join('\n\n---\n\n');

  const repoPaths = resolveRepoPaths(localReposRoot, agentRepos);
  const cwd = toolsEnabled ? (repoPaths[0] ?? localReposRoot) : localReposRoot;
  const toolArgs = buildToolArgs({ enabled: toolsEnabled, repoPaths });

  const raw = await runClaude(job.agent.model, systemPrompt, contextText, cwd, toolArgs);
  return extractMemoryUpdate(raw);
}

const CLI_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

interface CliResult {
  subtype?: string;
  is_error?: boolean;
  result?: string;
}

// Drive Claude Code in headless print mode (`claude -p`) instead of calling the
// Messages API directly. This uses the SUPPORTED subscription client: auth comes
// from the logged-in Claude Code session (~/.claude), token refresh is handled by
// the CLI, and rate-limit retry/backoff is built in. The npm `claude` shim runs
// through node (not the 236MB native .exe), so CrowdStrike Falcon does not block
// the node→claude spawn the way it blocked the standalone binary.
//
// Auth note: ANTHROPIC_API_KEY in the runner's env is a stale OAuth token; we
// strip it (and ANTHROPIC_AUTH_TOKEN) from the child env so the CLI cleanly uses
// the subscription login rather than mistaking the token for an API key.
async function runClaude(
  model: string, systemPrompt: string, userMessage: string, cwd: string, toolArgs: string[],
): Promise<string> {
  const sysFile = join(tmpdir(), `agent-hub-sys-${Date.now()}-${Math.floor(Math.random() * 1e6)}.txt`);
  writeFileSync(sysFile, systemPrompt, 'utf8');

  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        'claude',
        ['-p', '--model', model, '--output-format', 'json', '--append-system-prompt-file', `"${sysFile}"`, ...toolArgs],
        { cwd, env, shell: true },
      );
      let out = '';
      let err = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`claude CLI timed out after ${CLI_TIMEOUT_MS / 1000}s`));
      }, CLI_TIMEOUT_MS);
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error(`claude CLI exited ${code}: ${(err.trim() || out.trim()).slice(0, 500)}`));
        else resolve(out);
      });
      child.stdin.write(userMessage);
      child.stdin.end();
    });

    let parsed: CliResult;
    try {
      parsed = JSON.parse(stdout) as CliResult;
    } catch {
      throw new Error(`claude CLI returned non-JSON output: ${stdout.slice(0, 500)}`);
    }
    if (parsed.is_error || (parsed.subtype && parsed.subtype !== 'success')) {
      throw new Error(`claude CLI error (${parsed.subtype ?? 'unknown'}): ${parsed.result ?? 'no detail'}`);
    }
    return (parsed.result ?? '').trim() || '(no output)';
  } finally {
    try { unlinkSync(sysFile); } catch { /* best-effort cleanup */ }
  }
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
