import { buildVwoAgentInput, VWO_AGENT_NAME } from '../src/scripts/seed-vwo-agent.js';

describe('buildVwoAgentInput', () => {
  const a = buildVwoAgentInput();

  it('sets identity + model + type', () => {
    expect(a.name).toBe(VWO_AGENT_NAME);
    expect(a.type).toBe('pr-review');
    expect(a.model).toBe('claude-haiku-4-5');
    expect(a.enabled).toBe(true);
  });

  it('sets a daily cron trigger, empty repos, and teams_webhook output (as JSON strings)', () => {
    expect(JSON.parse(a.triggerRules)).toEqual({ events: [], cron: '0 9 * * *' });
    expect(JSON.parse(a.repos)).toEqual([]);
    expect(JSON.parse(a.outputs)).toEqual(['teams_webhook']);
  });

  it('prompt tells the agent to curl the endpoint and read the x-vwo-campaigns header', () => {
    expect(a.prompt).toContain('field-validations-and-mapping-rules');
    expect(a.prompt).toContain('x-vwo-campaigns');
    expect(a.prompt).toContain('ShippingAddressValidation');
    expect(a.prompt).toContain('curl -sS -D -');
    expect(a.prompt).toContain('-o /dev/null');
    // VWO buckets on x-client-id; without it the server omits x-vwo-campaigns (false DOWN).
    expect(a.prompt).toContain('x-client-id: liveness-probe.0.30000603');
    expect(a.prompt).toContain('✅ LIVE');
    expect(a.prompt).toContain('❌ DOWN');
  });
});
