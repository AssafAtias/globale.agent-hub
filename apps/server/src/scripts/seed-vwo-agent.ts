import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import { AgentRepository, type AgentInsert } from '../services/AgentRepository.js';
import { slugify } from '../services/teams/slugify.js';
import { getDb } from '../db/client.js';

export const VWO_AGENT_NAME = 'VWO Liveness — ShippingAddressValidation';

const ENDPOINT =
  'https://checkout-service-qa-hf.bglobale.com/api/v1/Shopify/field-validations-and-mapping-rules' +
  '?merchantId=30000603&countryCode=US&cultureCode=en-US';

const PROMPT = `You are a scheduled liveness monitor for the "ShippingAddressValidation" VWO A/B campaign on GlobalE checkout.

Run EXACTLY this command (it prints the response headers, then discards the body):

  curl -sS -D - -o /dev/null -H 'Origin: https://extensions.shopifycdn.com' '${ENDPOINT}'

Then inspect the response:
- Read the HTTP status line and the \`x-vwo-campaigns\` response header.
- The campaign is LIVE if the status is 200 AND \`x-vwo-campaigns\` is present and contains an entry whose "CampaignKey" is "ShippingAddressValidation" (ANY "Variation" value — Control or Variation-1 — counts as live).

Output EXACTLY ONE final line and nothing else, in one of these forms:
- \`✅ LIVE — ShippingAddressValidation variation=<Variation>, HTTP 200\`
- \`❌ DOWN — <reason>\`  where <reason> is one of: "HTTP <code>" (non-200), "x-vwo-campaigns header missing", "campaign not in header", or "curl failed: <short error>".

Do not invent or assume values — report only what the actual response shows. Do not run any other commands.`;

export function buildVwoAgentInput(): AgentInsert {
  return {
    name: VWO_AGENT_NAME,
    type: 'pr-review',
    model: 'claude-haiku-4-5',
    prompt: PROMPT,
    repos: '[]',
    triggerRules: JSON.stringify({ events: [], cron: '0 9 * * *' }),
    outputs: JSON.stringify(['teams_webhook']),
    enabled: true,
    title: 'VWO liveness (daily)',
    bio: 'Daily curl check that the ShippingAddressValidation VWO campaign is still served; posts LIVE/DOWN to the Agent-hub Teams channel.',
  };
}

function main(): void {
  try {
    // Load the repo-root .env (from dist/scripts → repo root) so DATABASE_URL is honored,
    // then open the same SQLite DB the server uses. We deliberately do NOT call loadConfig()
    // here — the seed needs only the DB path and should not require unrelated secrets
    // (e.g. GITLAB_WEBHOOK_SECRET). NOTE: stop the server first, or it may hit SQLITE_BUSY.
    loadEnv({ path: resolve(__dirname, '../../../../.env') });
    getDb(process.env.DATABASE_URL ?? './agent-hub.db');
    const input = buildVwoAgentInput();
    const existing = AgentRepository.findBySlug(slugify(VWO_AGENT_NAME));
    if (existing) {
      AgentRepository.update(existing.id, input);
      console.log(`[seed-vwo-agent] updated existing agent ${existing.id}`);
    } else {
      const row = AgentRepository.create(input);
      console.log(`[seed-vwo-agent] created agent ${row.id}`);
    }
  } catch (err) {
    console.error('[seed-vwo-agent] failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

// Only run when executed directly (node dist/scripts/seed-vwo-agent.js),
// never on import (so tests can import buildVwoAgentInput without a DB).
if (require.main === module) {
  main();
}
