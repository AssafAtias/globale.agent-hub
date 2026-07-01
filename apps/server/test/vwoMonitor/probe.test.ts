import { extractVariation, probeMerchant } from '../../src/services/monitoring/probe.js';

const KEY = 'ShippingAddressValidation';
const merchant = { merchantId: 30000603, countryCode: 'US', cultureCode: 'en-US' };
const cfg = { baseUrl: 'https://cs.example.com', campaignKey: KEY };

describe('extractVariation', () => {
  it('returns the variation for a matching single-entry header', () => {
    expect(extractVariation(`[{"CampaignKey":"${KEY}","Variation":"Variation-1"}]`, KEY)).toBe('Variation-1');
  });
  it('returns Control when that is the assigned variation', () => {
    expect(extractVariation(`[{"CampaignKey":"${KEY}","Variation":"Control"}]`, KEY)).toBe('Control');
  });
  it('finds the target campaign among multiple entries', () => {
    const hdr = `[{"CampaignKey":"Other","Variation":"A"},{"CampaignKey":"${KEY}","Variation":"Control"}]`;
    expect(extractVariation(hdr, KEY)).toBe('Control');
  });
  it('returns null for a missing header', () => {
    expect(extractVariation(null, KEY)).toBeNull();
    expect(extractVariation(undefined, KEY)).toBeNull();
  });
  it('returns null for malformed JSON', () => {
    expect(extractVariation('not json', KEY)).toBeNull();
  });
  it('returns null when the campaign key is absent', () => {
    expect(extractVariation('[{"CampaignKey":"Other","Variation":"A"}]', KEY)).toBeNull();
  });
});

function mockFetch(impl: (url: string) => any) {
  global.fetch = jest.fn(async (url: any) => impl(String(url))) as any;
}

describe('probeMerchant', () => {
  let originalFetch: typeof global.fetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  it('returns ok with the variation on 200 + valid header', async () => {
    mockFetch(() => ({
      ok: true, status: 200,
      headers: { get: (h: string) => (h.toLowerCase() === 'x-vwo-campaigns'
        ? `[{"CampaignKey":"${KEY}","Variation":"Variation-1"}]` : null) },
    }));
    const r = await probeMerchant(cfg, merchant);
    expect(r).toEqual({ ok: true, merchantId: 30000603, httpStatus: 200, variation: 'Variation-1' });
  });

  it('returns campaign_missing on 200 with no matching header', async () => {
    mockFetch(() => ({ ok: true, status: 200, headers: { get: () => null } }));
    const r = await probeMerchant(cfg, merchant);
    expect(r).toMatchObject({ ok: false, reason: 'campaign_missing', httpStatus: 200 });
  });

  it('returns non_200 on a 500', async () => {
    mockFetch(() => ({ ok: false, status: 500, headers: { get: () => null } }));
    const r = await probeMerchant(cfg, merchant);
    expect(r).toMatchObject({ ok: false, reason: 'non_200', httpStatus: 500 });
  });

  it('returns network on a thrown fetch', async () => {
    global.fetch = jest.fn(async () => { throw new Error('boom'); }) as any;
    const r = await probeMerchant(cfg, merchant);
    expect(r).toMatchObject({ ok: false, reason: 'network' });
  });

  it('returns timeout when the request aborts', async () => {
    global.fetch = jest.fn(async () => {
      const err = new Error('aborted'); err.name = 'AbortError'; throw err;
    }) as any;
    const r = await probeMerchant(cfg, merchant, 5);
    expect(r).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('builds the correct URL and Origin header', async () => {
    let seenUrl = ''; let seenInit: any;
    global.fetch = jest.fn(async (url: any, init: any) => {
      seenUrl = String(url); seenInit = init;
      return { ok: true, status: 200, headers: { get: () => `[{"CampaignKey":"${KEY}","Variation":"Control"}]` } };
    }) as any;
    await probeMerchant(cfg, merchant);
    expect(seenUrl).toBe('https://cs.example.com/api/v1/Shopify/field-validations-and-mapping-rules?merchantId=30000603&countryCode=US&cultureCode=en-US');
    expect(seenInit.headers.Origin).toBe('https://extensions.shopifycdn.com');
  });
});
