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
  JIRA_EMAIL: Type.Optional(Type.String()),
});

export type Environment = {
  PORT: string;
  DATABASE_URL: string;
  GITLAB_WEBHOOK_SECRET: string;
  JIRA_WEBHOOK_SECRET: string | undefined;
  GITLAB_API_TOKEN: string | undefined;
  JIRA_API_TOKEN: string | undefined;
  JIRA_BASE_URL: string;
  JIRA_EMAIL: string | undefined;
  JIRA_PROJECT_KEY: string;
  SKILLS_DIR: string;
  MICROSOFT_APP_ID: string | undefined;
  MICROSOFT_APP_PASSWORD: string | undefined;
  MICROSOFT_APP_TENANT_ID: string | undefined;
  MICROSOFT_APP_TYPE: string | undefined;
  TEAMS_ALLOWED_USER_IDS: string[];
  TEAMS_WEBHOOK_URL: string | undefined;
  BITBUCKET_API_TOKEN: string | undefined;
  BITBUCKET_USERNAME: string | undefined;
  BITBUCKET_WEBHOOK_SECRET: string | undefined;
  VWO_GENERATE_ENABLED: boolean;
  AUTH_ENABLED: boolean;
  ENTRA_TENANT_ID: string | undefined;
  ENTRA_CLIENT_ID: string | undefined;
  ENTRA_CLIENT_SECRET: string | undefined;
  SESSION_SECRET: string | undefined;
  PUBLIC_BASE_URL: string | undefined;
  RUN_STALE_TIMEOUT_MS: number;
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
    JIRA_EMAIL: process.env.JIRA_EMAIL,
    JIRA_PROJECT_KEY: process.env.JIRA_PROJECT_KEY ?? 'CORE',
    SKILLS_DIR: process.env.SKILLS_DIR ?? 'C:\\GlobalE\\.claude\\skills',
    MICROSOFT_APP_ID: process.env.MICROSOFT_APP_ID,
    MICROSOFT_APP_PASSWORD: process.env.MICROSOFT_APP_PASSWORD,
    MICROSOFT_APP_TENANT_ID: process.env.MICROSOFT_APP_TENANT_ID,
    MICROSOFT_APP_TYPE: process.env.MICROSOFT_APP_TYPE ?? 'SingleTenant',
    TEAMS_ALLOWED_USER_IDS: (process.env.TEAMS_ALLOWED_USER_IDS ?? '')
      .split(',').map(s => s.trim()).filter(Boolean),
    TEAMS_WEBHOOK_URL: process.env.TEAMS_WEBHOOK_URL,
    BITBUCKET_API_TOKEN: process.env.BITBUCKET_API_TOKEN,
    BITBUCKET_USERNAME: process.env.BITBUCKET_USERNAME,
    BITBUCKET_WEBHOOK_SECRET: process.env.BITBUCKET_WEBHOOK_SECRET,
    VWO_GENERATE_ENABLED: ['true', '1', 'yes'].includes((process.env.VWO_GENERATE_ENABLED ?? '').trim().toLowerCase()),
    AUTH_ENABLED: ['true', '1', 'yes'].includes((process.env.AUTH_ENABLED ?? '').trim().toLowerCase()),
    ENTRA_TENANT_ID: process.env.ENTRA_TENANT_ID,
    ENTRA_CLIENT_ID: process.env.ENTRA_CLIENT_ID,
    ENTRA_CLIENT_SECRET: process.env.ENTRA_CLIENT_SECRET,
    SESSION_SECRET: process.env.SESSION_SECRET,
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
    RUN_STALE_TIMEOUT_MS: Number(process.env.RUN_STALE_TIMEOUT_MS ?? 780000),
  };

  return config;
}

export function teamsEnabled(config: Environment): boolean {
  return Boolean(config.MICROSOFT_APP_ID);
}

export function authEnabled(config: Environment): boolean {
  return config.AUTH_ENABLED;
}
