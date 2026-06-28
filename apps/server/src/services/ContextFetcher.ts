import { GitLabClient, type MrContext } from './GitLabClient.js';
import { JiraClient, type JiraTicketContext } from './JiraClient.js';
import type { ParsedWebhookEvent } from './WebhookMatcher.js';

export interface FetchedContext {
  mr?: MrContext;
  ticket?: JiraTicketContext;
  rawPayload: Record<string, unknown>;
}

export class ContextFetcher {
  private gitlab?: GitLabClient;
  private jira?: JiraClient;

  constructor(gitlabToken?: string, jiraToken?: string, jiraBaseUrl?: string) {
    if (gitlabToken) this.gitlab = new GitLabClient(gitlabToken);
    if (jiraToken && jiraBaseUrl) this.jira = new JiraClient(jiraToken, jiraBaseUrl);
  }

  async fetch(event: ParsedWebhookEvent): Promise<FetchedContext> {
    const ctx: FetchedContext = { rawPayload: event.payload };

    if (event.platform === 'gitlab' && event.eventType.startsWith('mr:') && this.gitlab) {
      const attrs = event.payload['object_attributes'] as Record<string, unknown>;
      const project = (event.payload['project'] as Record<string, unknown>)?.['path_with_namespace'] as string;
      if (project && attrs?.['iid']) {
        try {
          ctx.mr = await this.gitlab.getMrContext(project, attrs['iid'] as number);
        } catch (e) {
          console.warn('[ContextFetcher] Failed to fetch MR context:', e);
        }
      }
    }

    if (event.platform === 'jira' && this.jira) {
      const issue = event.payload['issue'] as Record<string, unknown> | undefined;
      const key = issue?.['key'] as string | undefined;
      if (key) {
        try {
          ctx.ticket = await this.jira.getTicket(key);
        } catch (e) {
          console.warn('[ContextFetcher] Failed to fetch Jira ticket:', e);
        }
      }
    }

    return ctx;
  }

  async fetchOpenAssignedTicket(projectKey?: string): Promise<FetchedContext | null> {
    if (!this.jira) return null;
    const ticket = await this.jira.searchFirstOpenAssigned(projectKey);
    if (!ticket) return null;
    return { rawPayload: {}, ticket };
  }

  serializeForRunner(ctx: FetchedContext): string {
    const parts: Record<string, string> = {};
    if (ctx.mr) {
      parts['MR Title'] = ctx.mr.title;
      parts['MR Description'] = ctx.mr.description;
      parts['Branch'] = `${ctx.mr.sourceBranch} → ${ctx.mr.targetBranch}`;
      parts['Diff'] = ctx.mr.diff;
    }
    if (ctx.ticket) {
      parts['Jira Ticket'] = `${ctx.ticket.key}: ${ctx.ticket.summary}`;
      parts['Status'] = ctx.ticket.status;
      parts['Description'] = ctx.ticket.description;
    }
    if (Object.keys(parts).length === 0) {
      parts['Raw Payload'] = JSON.stringify(ctx.rawPayload, null, 2).slice(0, 4000);
    }
    return JSON.stringify(parts);
  }
}
