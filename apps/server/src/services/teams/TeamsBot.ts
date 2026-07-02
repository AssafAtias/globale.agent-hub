import { parseTeamsCommand } from './parseTeamsCommand.js';
import { isAllowedUser } from './allowlist.js';
import { ActivityHandler, TurnContext } from 'botbuilder';
import { AgentRepository } from '../AgentRepository.js';
import { RunRepository } from '../RunRepository.js';
import { UserRepository } from '../UserRepository.js';
import { slugify } from './slugify.js';

export interface TeamsTurn {
  text: string;
  aadObjectId: string | undefined;
  conversationReference: string; // JSON-serialized ConversationReference
  reply(text: string): Promise<void>;
}

export interface TeamsBotDeps {
  allowedUserIds: string[];
  agents: {
    findBySlug(slug: string): { id: string; name: string; ownerId?: string | null } | null;
    setTeamsTarget(id: string, ref: string): unknown;
    listSlugs(): string[];
  };
  runs: {
    create(d: { agentId: string; trigger: string; triggerPayload: string; context: string; replyTo: string; userId?: string | null }): { id: string };
  };
  users?: {
    findByEntraOid(oid: string): { id: string } | null;
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

  const owner = turn.aadObjectId
    ? (deps.users?.findByEntraOid(turn.aadObjectId)?.id ?? agent.ownerId ?? null)
    : (agent.ownerId ?? null);
  deps.runs.create({
    agentId: agent.id,
    trigger: 'teams',
    triggerPayload: JSON.stringify({ source: 'teams', aadObjectId: turn.aadObjectId }),
    context: JSON.stringify({ 'User request': cmd.input }),
    replyTo: turn.conversationReference,
    userId: owner,
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

export function createTeamsBot(allowedUserIds: string[]): ActivityHandler {
  const bot = new ActivityHandler();
  const deps: TeamsBotDeps = {
    allowedUserIds,
    agents: {
      findBySlug: (s) => AgentRepository.findBySlug(s),
      setTeamsTarget: (id, ref) => AgentRepository.setTeamsTarget(id, ref),
      listSlugs: () => AgentRepository.findAll().map(a => slugify(a.name)),
    },
    runs: { create: (d) => RunRepository.create(d) },
    users: { findByEntraOid: (oid) => UserRepository.findByEntraOid(oid) },
  };

  bot.onMessage(async (context, next) => {
    const turn: TeamsTurn = {
      text: TurnContext.removeRecipientMention(context.activity) ?? context.activity.text ?? '',
      aadObjectId: context.activity.from?.aadObjectId,
      conversationReference: JSON.stringify(TurnContext.getConversationReference(context.activity)),
      reply: async (t: string) => { await context.sendActivity(t); },
    };
    await processTeamsMessage(turn, deps);
    await next();
  });

  return bot;
}
