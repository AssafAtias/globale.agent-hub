import { buildVwoAgentInput, VWO_AGENT_NAME } from '../src/scripts/seed-vwo-agent.js';

describe('buildVwoAgentInput (traffic generator)', () => {
  const a = buildVwoAgentInput();

  it('is the renamed generator agent, haiku, manual-only, Activity-only', () => {
    expect(VWO_AGENT_NAME).toBe('VWO Traffic Generator — ShippingAddressValidation');
    expect(a.name).toBe(VWO_AGENT_NAME);
    expect(a.type).toBe('pr-review');
    expect(a.model).toBe('claude-haiku-4-5');
    expect(a.enabled).toBe(true);
  });

  it('has NO cron (manual-only) and empty outputs', () => {
    const tr = JSON.parse(a.triggerRules);
    expect(tr).toEqual({ events: [] });
    expect(tr.cron).toBeUndefined();
    expect(JSON.parse(a.outputs)).toEqual([]);
    expect(JSON.parse(a.repos)).toEqual([]);
  });

  it('prompt curls the local generator endpoint and reports count + split + ids', () => {
    expect(a.prompt).toContain("curl -sS 'http://localhost:3000/api/dev/vwo-generate-sessions?n=100'");
    expect(a.prompt).toContain('variation1');
    expect(a.prompt).toContain('clientId');
    expect(a.prompt).toContain('checkoutId');
    expect(a.prompt).toContain('Variation-1');
    expect(a.prompt).toContain('Control');
  });
});
