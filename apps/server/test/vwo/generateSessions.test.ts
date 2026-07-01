import { extractVariation, generateVwoSessions } from '../../src/services/vwo/generateSessions.js';

const KEY = 'ShippingAddressValidation';

describe('extractVariation', () => {
  it('returns the variation for a matching entry', () => {
    expect(extractVariation(`[{"CampaignKey":"${KEY}","Variation":"Variation-1"}]`, KEY)).toBe('Variation-1');
  });
  it('finds the target among multiple entries', () => {
    expect(extractVariation(`[{"CampaignKey":"Other","Variation":"A"},{"CampaignKey":"${KEY}","Variation":"Control"}]`, KEY)).toBe('Control');
  });
  it('returns null for missing / malformed / wrong-key / non-array', () => {
    expect(extractVariation(null, KEY)).toBeNull();
    expect(extractVariation('not json', KEY)).toBeNull();
    expect(extractVariation('[{"CampaignKey":"Other","Variation":"A"}]', KEY)).toBeNull();
    expect(extractVariation('{"CampaignKey":"x"}', KEY)).toBeNull();
  });
});

const opts = { baseUrl: 'https://cs.example.com', merchantId: 30000603, countryCode: 'US', cultureCode: 'en-US', campaignKey: KEY, n: 5, concurrency: 2 };

function seqRandom() { let i = 0; return () => ++i; } // 1,2,3,... deterministic

describe('generateVwoSessions', () => {
  it('returns exactly n sessions with distinct client-ids and correct tallies', async () => {
    // alternate Control / Variation-1, and one missing header
    let call = 0;
    const fetchImpl = (async () => {
      const idx = call++;
      const variation = idx === 2 ? null : (idx % 2 === 0 ? 'Control' : 'Variation-1');
      return {
        ok: true, status: 200,
        headers: { get: (h: string) => h.toLowerCase() === 'x-vwo-campaigns' && variation ? `[{"CampaignKey":"${KEY}","Variation":"${variation}"}]` : null },
      } as any;
    }) as unknown as typeof fetch;

    const r = await generateVwoSessions(opts, fetchImpl, seqRandom());
    expect(r.n).toBe(5);
    expect(r.sessions).toHaveLength(5);
    expect(r.variation1 + r.control + r.none).toBe(5);
    const ids = new Set(r.sessions.map((s) => s.clientId));
    expect(ids.size).toBe(5); // all distinct
    expect(r.sessions.every((s) => s.clientId.endsWith('.30000603'))).toBe(true);
  });

  it('counts a thrown request as none and still returns n sessions', async () => {
    const fetchImpl = (async () => { throw new Error('boom'); }) as unknown as typeof fetch;
    const r = await generateVwoSessions({ ...opts, n: 3 }, fetchImpl, seqRandom());
    expect(r.sessions).toHaveLength(3);
    expect(r.none).toBe(3);
    expect(r.variation1).toBe(0);
    expect(r.control).toBe(0);
  });

  it('never exceeds the concurrency cap of in-flight requests', async () => {
    let inFlight = 0, maxInFlight = 0;
    const fetchImpl = (async () => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((res) => setTimeout(res, 5));
      inFlight--;
      return { ok: true, status: 200, headers: { get: () => `[{"CampaignKey":"${KEY}","Variation":"Control"}]` } } as any;
    }) as unknown as typeof fetch;
    const r = await generateVwoSessions({ ...opts, n: 10, concurrency: 3 }, fetchImpl, seqRandom());
    expect(r.sessions).toHaveLength(10);
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });
});
