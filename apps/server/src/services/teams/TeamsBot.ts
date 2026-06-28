import { parseTeamsCommand } from './parseTeamsCommand.js';
import { isAllowedUser } from './allowlist.js';

export interface TeamsTurn {
  text: string;
  aadObjectId: string | undefined;
  conversationReference: string; // JSON-serialized ConversationReference
  reply(text: string): Promise<void>;
}

export interface TeamsBotDeps {
  allowedUserIds: string[];
  agents: {
    findBySlug(slug: string): { id: string; name: string } | null;
    setTeamsTarget(id: string, ref: string): unknown;
    listSlugs(): string[];
  };
  runs: {
    create(d: { agentId: string; trigger: string; triggerPayload: string; context: string; replyTo: string }): { id: string };
  };
}

// Best-effort reply that never throws — used for acks/errors so a Teams send
// failure can't abort the turn after a run is already created.
async function safeReply(turn: TeamsTurn, text: string): Promise<void> {
  try { await turn.reply(text); } catch (e) { console.error('[TeamsBot] reply failed:', e); }
}

export async function processTeamsMessage(turn: TeamsTurn, deps: TeamsBotDeps): Promise<void> {
  if (!isAllowedUser(turn.aadObjectId, deps.allowedUserIds)) {
    await safeReply(turn, "You're not authorized to trigger agents.");
    return;
  }

  const cmd = parseTeamsCommand(turn.text);

  if (cmd.kind === 'help') {
    await safeReply(turn, helpText(deps.agents.listSlugs()));
    return;
  }
  if (cmd.kind === 'invalid') {
    await safeReply(turn, `${cmd.reason}\n\n${helpText(deps.agents.listSlugs())}`);
    return;
  }
  if (cmd.kind === 'set-channel') {
    const agent = deps.agents.findBySlug(cmd.slug);
    if (!agent) { await safeReply(turn, unknownAgent(cmd.slug, deps.agents.listSlugs())); return; }
    deps.agents.setTeamsTarget(agent.id, turn.conversationReference);
    await safeReply(turn, `✅ Reports for \`${cmd.slug}\` will post here.`);
    return;
  }

  // cmd.kind === 'run'
  const agent = deps.agents.findBySlug(cmd.slug);
  if (!agent) { await safeReply(turn, unknownAgent(cmd.slug, deps.agents.listSlugs())); return; }

  deps.runs.create({
    agentId: agent.id,
    trigger: 'teams',
    triggerPayload: JSON.stringify({ source: 'teams', aadObjectId: turn.aadObjectId }),
    context: cmd.input,
    replyTo: turn.conversationReference,
  });

  await safeReply(turn, `🚀 Running \`${cmd.slug}\`… I'll post the result here.`);
}

function helpText(slugs: string[]): string {
  const list = slugs.length ? slugs.map(s => `• \`${s}\``).join('\n') : '_(no agents configured)_';
  return `Available agents:\n${list}\n\nUsage: \`<slug>: <your request>\`  ·  \`set-channel <slug>\`  ·  \`help\``;
}

function unknownAgent(slug: string, slugs: string[]): string {
  return `Unknown agent \`${slug}\`.\n\n${helpText(slugs)}`;
}
