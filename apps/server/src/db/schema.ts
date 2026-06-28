import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),           // 'pr-review' | 'ticket-to-code'
  model: text('model').notNull(),
  prompt: text('prompt').notNull(),
  repos: text('repos').notNull(),         // JSON: string[]
  triggerRules: text('trigger_rules').notNull(), // JSON: TriggerRules
  outputs: text('outputs').notNull(),     // JSON: string[]
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  avatarKey: text('avatar_key'),
  title: text('title'),
  bio: text('bio'),
  skills: text('skills').notNull().default('[]'), // JSON: string[]
  focus: text('focus'),
  sortOrder: integer('sort_order').notNull().default(0),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  workflow: text('workflow'),
});

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id),
  trigger: text('trigger').notNull(),     // 'webhook' | 'manual'
  triggerPayload: text('trigger_payload').notNull(), // JSON
  context: text('context').notNull().default('{}'),  // JSON: pre-fetched context
  status: text('status').notNull().default('pending'),
  runnerId: text('runner_id'),
  result: text('result'),
  error: text('error'),
  createdAt: text('created_at').notNull(),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  sessionId: text('session_id'),
  pendingGate: text('pending_gate'),
  pendingResponse: text('pending_response'),
});

export const runners = sqliteTable('runners', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  lastSeen: text('last_seen').notNull(),
  status: text('status').notNull().default('offline'),
});

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  role: text('role').notNull().default('member'),
});

export const agentMemory = sqliteTable('agent_memory', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id),
  runId: text('run_id'),
  note: text('note').notNull(),
  createdAt: text('created_at').notNull(),
});
