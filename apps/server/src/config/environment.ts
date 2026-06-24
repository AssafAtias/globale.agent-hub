import { Type, Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const EnvSchema = Type.Object({
  PORT: Type.Optional(Type.String()),
  DATABASE_URL: Type.Optional(Type.String()),
  GITLAB_WEBHOOK_SECRET: Type.Optional(Type.String()),
  JIRA_WEBHOOK_SECRET: Type.Optional(Type.String()),
  GITLAB_API_TOKEN: Type.Optional(Type.String()),
  JIRA_API_TOKEN: Type.Optional(Type.String()),
  JIRA_BASE_URL: Type.Optional(Type.String()),
});

export type Environment = {
  PORT: string;
  DATABASE_URL: string;
  GITLAB_WEBHOOK_SECRET: string;
  JIRA_WEBHOOK_SECRET: string | undefined;
  GITLAB_API_TOKEN: string | undefined;
  JIRA_API_TOKEN: string | undefined;
  JIRA_BASE_URL: string;
  SKILLS_DIR: string;
};

export function loadConfig(): Environment {
  const config: Environment = {
    PORT: process.env.PORT ?? '3000',
    DATABASE_URL: process.env.DATABASE_URL ?? './agent-hub.db',
    GITLAB_WEBHOOK_SECRET: process.env.GITLAB_WEBHOOK_SECRET ?? (process.env.NODE_ENV === 'test' ? 'test-secret' : (() => { throw new Error('GITLAB_WEBHOOK_SECRET env var is required'); })()),
    JIRA_WEBHOOK_SECRET: process.env.JIRA_WEBHOOK_SECRET,
    GITLAB_API_TOKEN: process.env.GITLAB_API_TOKEN,
    JIRA_API_TOKEN: process.env.JIRA_API_TOKEN,
    JIRA_BASE_URL: process.env.JIRA_BASE_URL ?? 'https://global-e.atlassian.net',
    SKILLS_DIR: process.env.SKILLS_DIR ?? 'C:\\GlobalE\\.claude\\skills',
  };

  return config;
}
