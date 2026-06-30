import { AgentRepository, type AgentRow } from './AgentRepository.js';

export interface ParsedWebhookEvent {
  platform: 'gitlab' | 'bitbucket' | 'jira';
  repo: string;
  eventType: string;
  sourceRef?: string;
  payload: Record<string, unknown>;
}

export function parseGitLabEvent(body: Record<string, unknown>): ParsedWebhookEvent | null {
  const kind = body['object_kind'] as string;
  const project = (body['project'] as Record<string, unknown>)?.['path_with_namespace'] as string;
  if (!project) return null;

  const repo = `gitlab:${project}`;
  const attrs = body['object_attributes'] as Record<string, unknown>;

  if (kind === 'merge_request') {
    const action = attrs?.['action'] as string;
    const eventMap: Record<string, string> = { open: 'mr:opened', update: 'mr:updated', merge: 'mr:merged' };
    const eventType = eventMap[action];
    if (!eventType) return null;
    return { platform: 'gitlab', repo, eventType, sourceRef: attrs?.['source_branch'] as string | undefined, payload: body };
  }

  if (kind === 'pipeline') {
    const status = attrs?.['status'] as string;
    if (status === 'failed') return { platform: 'gitlab', repo, eventType: 'pipeline:failed', payload: body };
  }

  return null;
}

export function parseJiraEvent(body: Record<string, unknown>): ParsedWebhookEvent | null {
  const webhookEvent = body['webhookEvent'] as string;
  const issue = body['issue'] as Record<string, unknown> | undefined;
  if (!issue?.['key']) return null;

  const fields = issue['fields'] as Record<string, unknown>;
  const projectKey = (fields?.['project'] as Record<string, unknown>)?.['key'] as string;
  const repo = `jira:${projectKey}`;

  if (webhookEvent === 'jira:issue_updated') {
    const statusName = (fields?.['status'] as Record<string, unknown>)?.['name'] as string;
    if (statusName === 'In Progress') {
      return { platform: 'jira', repo, eventType: 'jira:status:in-progress', payload: body };
    }
  }

  return null;
}

export function parseBitbucketEvent(body: Record<string, unknown>, eventKey: string): ParsedWebhookEvent | null {
  const eventMap: Record<string, string> = {
    'pullrequest:created': 'mr:opened',
    'pullrequest:updated': 'mr:updated',
    'pullrequest:fulfilled': 'mr:merged',
  };
  const eventType = eventMap[eventKey];
  if (!eventType) return null;

  const fullName = (body['repository'] as Record<string, unknown>)?.['full_name'] as string;
  if (!fullName) return null;

  const pr = body['pullrequest'] as Record<string, unknown> | undefined;
  const sourceRef = ((pr?.['source'] as Record<string, unknown>)?.['branch'] as Record<string, unknown>)?.['name'] as string | undefined;

  return { platform: 'bitbucket', repo: `bitbucket:${fullName}`, eventType, sourceRef, payload: body };
}

export function matchAgents(event: ParsedWebhookEvent): AgentRow[] {
  const all = AgentRepository.findAll();
  return all.filter(agent => {
    if (!agent.enabled) return false;
    const repos = (() => { try { return JSON.parse(agent.repos || '[]') as string[]; } catch { return [] as string[]; } })();
    if (!repos.includes(event.repo)) return false;
    const rules = (() => { try { return JSON.parse(agent.triggerRules || '{}'); } catch { return {}; } })();
    const events = (rules.events ?? []) as string[];
    if (!events.includes(event.eventType)) return false;
    if (rules.branchFilter && event.sourceRef) {
      // Escape special regex chars in user-supplied filter, then convert * to .*
      const escaped = (rules.branchFilter as string)
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')  // escape special chars
        .replace(/\*/g, '.*');                    // convert * wildcard to .*
      if (!new RegExp(`^${escaped}$`).test(event.sourceRef)) return false;
    }
    return true;
  });
}
