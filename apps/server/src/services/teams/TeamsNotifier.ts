import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  type ConversationReference,
  type TurnContext,
} from 'botbuilder';
import type { Environment } from '../../config/environment.js';

const MAX_LEN = 18_000;

export function formatTeamsResult(result: string, agentName: string): string {
  let body = result;
  if (body.length > MAX_LEN) body = body.slice(0, MAX_LEN) + '\n\n…(truncated)';
  return `**${agentName}** finished:\n\n${body}`;
}

export function createTeamsAdapter(config: Environment): CloudAdapter {
  if (!config.MICROSOFT_APP_ID) throw new Error('createTeamsAdapter called without MICROSOFT_APP_ID');
  const auth = new ConfigurationBotFrameworkAuthentication({
    MicrosoftAppId: config.MICROSOFT_APP_ID,
    MicrosoftAppPassword: config.MICROSOFT_APP_PASSWORD,
    MicrosoftAppType: config.MICROSOFT_APP_TYPE,
    MicrosoftAppTenantId: config.MICROSOFT_APP_TENANT_ID,
  } as Record<string, string | undefined>);
  return new CloudAdapter(auth);
}

interface AdapterLike {
  continueConversationAsync(
    appId: string,
    ref: object,
    logic: (ctx: TurnContext) => Promise<void>,
  ): Promise<void>;
}

export class TeamsNotifier {
  constructor(private adapter: AdapterLike, private appId: string) {}

  async post(ref: object, text: string): Promise<void> {
    await this.adapter.continueConversationAsync(this.appId, ref as Partial<ConversationReference>, async (ctx) => {
      await ctx.sendActivity(text);
    });
  }
}
