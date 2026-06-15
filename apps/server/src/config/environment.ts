import { Type, Static } from '@sinclair/typebox';

const EnvSchema = Type.Object({
  PORT: Type.Optional(Type.String({ default: '3000' })),
  DATABASE_URL: Type.String(),
  GITLAB_WEBHOOK_SECRET: Type.String(),
  JIRA_WEBHOOK_SECRET: Type.Optional(Type.String()),
  GITLAB_API_TOKEN: Type.Optional(Type.String()),
  JIRA_API_TOKEN: Type.Optional(Type.String()),
  JIRA_BASE_URL: Type.Optional(Type.String({ default: 'https://global-e.atlassian.net' })),
});

export type Environment = Static<typeof EnvSchema>;

export function loadConfig(): Environment {
  return {
    PORT: process.env.PORT ?? '3000',
    DATABASE_URL: process.env.DATABASE_URL ?? './agent-hub.db',
    GITLAB_WEBHOOK_SECRET: process.env.GITLAB_WEBHOOK_SECRET ?? 'changeme',
    JIRA_WEBHOOK_SECRET: process.env.JIRA_WEBHOOK_SECRET,
    GITLAB_API_TOKEN: process.env.GITLAB_API_TOKEN,
    JIRA_API_TOKEN: process.env.JIRA_API_TOKEN,
    JIRA_BASE_URL: process.env.JIRA_BASE_URL ?? 'https://global-e.atlassian.net',
  };
}
