import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import { AgentRepository, type AgentInsert } from '../services/AgentRepository.js';
import { getDb } from '../db/client.js';

export const VWO_AGENT_NAME = 'VWO Traffic Generator — ShippingAddressValidation';
const OLD_SLUG = 'vwo-liveness-shippingaddressvalidation';
const NEW_SLUG = 'vwo-traffic-generator-shippingaddressvalidation';

const GENERATE_URL = 'http://localhost:3000/api/dev/vwo-generate-sessions?n=100';

const PROMPT = `You are a manual traffic generator for the "ShippingAddressValidation" VWO A/B campaign. When run, you fire 100 checkout sessions via a local helper and report the results.

Run EXACTLY this command:

  curl -sS '${GENERATE_URL}'

It returns JSON of the form:
  { "n": 100, "variation1": <count>, "control": <count>, "none": <count>,
    "sessions": [ { "clientId": "...", "checkoutId": "...", "variation": "Variation-1" | "Control" | null }, ... ] }

Then output a report:
1. A summary line: "<n> calls · <variation1> Variation-1 / <control> Control / <none> none".
2. Then one line per session: "<clientId>  <checkoutId>  <variation>".

Report ONLY the actual data from the JSON — do not invent sessions. If the command fails, returns 404 (the tool is disabled), or returns non-JSON, report that verbatim. Do not run any other commands.`;

export function buildVwoAgentInput(): AgentInsert {
  return {
    name: VWO_AGENT_NAME,
    type: 'pr-review',
    model: 'claude-haiku-4-5',
    prompt: PROMPT,
    repos: '[]',
    triggerRules: JSON.stringify({ events: [] }), // no cron → manual-only
    outputs: JSON.stringify([]),                  // Activity-only, no Teams
    enabled: true,
    title: 'VWO traffic generator (manual)',
    bio: 'Manual run: fires 100 distinct-client-id sessions at the ShippingAddressValidation endpoint and reports the Control/Variation-1 split + generated ids.',
  };
}

function main(): void {
  try {
    loadEnv({ path: resolve(__dirname, '../../../../.env') });
    getDb(process.env.DATABASE_URL ?? './agent-hub.db');
    const input = buildVwoAgentInput();
    // Rename in place: match the new slug, else the old liveness slug. Never leave a duplicate.
    const existing =
      AgentRepository.findBySlug(NEW_SLUG) ?? AgentRepository.findBySlug(OLD_SLUG);
    if (existing) {
      AgentRepository.update(existing.id, input);
      console.log(`[seed-vwo-agent] updated agent ${existing.id} -> ${VWO_AGENT_NAME}`);
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
