import { parseGitLabEvent, parseJiraEvent, matchAgents } from '../src/services/WebhookMatcher.js';
import gitlabPayload from './fixtures/gitlab-mr-opened.json';
import { AgentRepository } from '../src/services/AgentRepository.js';
import { getDb, resetDb } from '../src/db/client.js';

function setupInMemoryDb() {
  const db = getDb(':memory:');
  (db as any).$client.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
      model TEXT NOT NULL, prompt TEXT NOT NULL, repos TEXT NOT NULL,
      trigger_rules TEXT NOT NULL, outputs TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
      avatar_key TEXT, title TEXT, bio TEXT,
      skills TEXT NOT NULL DEFAULT '[]'
    )
  `);
  return db;
}

beforeEach(() => {
  resetDb();
  setupInMemoryDb();
});

afterAll(() => resetDb());

describe('parseGitLabEvent', () => {
  it('parses mr:opened correctly', () => {
    const event = parseGitLabEvent(gitlabPayload as Record<string, unknown>);
    expect(event?.eventType).toBe('mr:opened');
    expect(event?.repo).toBe('gitlab:global-e/checkout-apps');
    expect(event?.sourceRef).toBe('feature/CORE-123456');
  });

  it('returns null for unknown event kind', () => {
    expect(parseGitLabEvent({ object_kind: 'unknown', project: { path_with_namespace: 'a/b' } })).toBeNull();
  });
});

describe('parseJiraEvent', () => {
  it('returns jira:status:in-progress when status is In Progress', () => {
    const body = {
      webhookEvent: 'jira:issue_updated',
      issue: {
        key: 'CORE-123',
        fields: {
          project: { key: 'CORE' },
          status: { name: 'In Progress' },
        },
      },
    };
    const event = parseJiraEvent(body);
    expect(event?.eventType).toBe('jira:status:in-progress');
    expect(event?.repo).toBe('jira:CORE');
  });

  it('returns null for non-In-Progress status', () => {
    const body = {
      webhookEvent: 'jira:issue_updated',
      issue: {
        key: 'CORE-123',
        fields: {
          project: { key: 'CORE' },
          status: { name: 'Done' },
        },
      },
    };
    expect(parseJiraEvent(body)).toBeNull();
  });
});

describe('matchAgents', () => {
  it('returns agents matching repo and event', () => {
    AgentRepository.create({
      name: 'PR Review', type: 'pr-review', model: 'claude-haiku-4-5',
      prompt: 'p', repos: JSON.stringify(['gitlab:global-e/checkout-apps']),
      triggerRules: JSON.stringify({ events: ['mr:opened'] }),
      outputs: JSON.stringify(['dashboard']),
    });
    const event = parseGitLabEvent(gitlabPayload as Record<string, unknown>)!;
    const matched = matchAgents(event);
    expect(matched).toHaveLength(1);
    expect(matched[0].name).toBe('PR Review');
  });

  it('ignores disabled agents', () => {
    AgentRepository.create({
      name: 'Disabled', type: 'pr-review', model: 'claude-haiku-4-5',
      prompt: 'p', repos: JSON.stringify(['gitlab:global-e/checkout-apps']),
      triggerRules: JSON.stringify({ events: ['mr:opened'] }),
      outputs: JSON.stringify(['dashboard']), enabled: false,
    });
    const event = parseGitLabEvent(gitlabPayload as Record<string, unknown>)!;
    expect(matchAgents(event)).toHaveLength(0);
  });

  it('filters by branch pattern', () => {
    AgentRepository.create({
      name: 'Feature only', type: 'pr-review', model: 'claude-haiku-4-5',
      prompt: 'p', repos: JSON.stringify(['gitlab:global-e/checkout-apps']),
      triggerRules: JSON.stringify({ events: ['mr:opened'], branchFilter: 'feature/*' }),
      outputs: JSON.stringify(['dashboard']),
    });
    const event = parseGitLabEvent(gitlabPayload as Record<string, unknown>)!;
    expect(matchAgents(event)).toHaveLength(1);
  });
});
