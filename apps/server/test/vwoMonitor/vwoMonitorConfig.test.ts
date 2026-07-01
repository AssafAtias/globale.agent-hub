import { loadVwoMonitorConfig, parseMerchants } from '../../src/services/monitoring/vwoMonitorConfig.js';

describe('parseMerchants', () => {
  it('parses a single merchantId:country:culture tuple', () => {
    expect(parseMerchants('30000603:US:en-US')).toEqual([
      { merchantId: 30000603, countryCode: 'US', cultureCode: 'en-US' },
    ]);
  });
  it('parses a comma list and trims whitespace', () => {
    expect(parseMerchants(' 1:US:en-US , 2:GB:en-GB ')).toEqual([
      { merchantId: 1, countryCode: 'US', cultureCode: 'en-US' },
      { merchantId: 2, countryCode: 'GB', cultureCode: 'en-GB' },
    ]);
  });
  it('drops malformed entries (bad id / missing parts)', () => {
    expect(parseMerchants('abc:US:en-US,,5:US')).toEqual([]);
  });
});

describe('loadVwoMonitorConfig', () => {
  it('applies defaults with an empty env (disabled, QA-HF merchant)', () => {
    const cfg = loadVwoMonitorConfig({} as NodeJS.ProcessEnv);
    expect(cfg.enabled).toBe(false);
    expect(cfg.baseUrl).toBe('https://checkout-service-qa-hf.bglobale.com');
    expect(cfg.campaignKey).toBe('ShippingAddressValidation');
    expect(cfg.cron).toBe('0 9 * * *');
    expect(cfg.merchants).toEqual([{ merchantId: 30000603, countryCode: 'US', cultureCode: 'en-US' }]);
    expect(cfg.teamsWebhookUrl).toBeUndefined();
  });
  it('reads overrides and strips a trailing slash from baseUrl', () => {
    const cfg = loadVwoMonitorConfig({
      VWO_MONITOR_ENABLED: 'true',
      VWO_MONITOR_BASE_URL: 'https://example.com/',
      VWO_MONITOR_CAMPAIGN_KEY: 'OtherCampaign',
      VWO_MONITOR_CRON: '*/15 * * * *',
      VWO_MONITOR_MERCHANTS: '111:US:en-US',
      TEAMS_WEBHOOK_URL: 'https://hook',
    } as NodeJS.ProcessEnv);
    expect(cfg.enabled).toBe(true);
    expect(cfg.baseUrl).toBe('https://example.com');
    expect(cfg.campaignKey).toBe('OtherCampaign');
    expect(cfg.cron).toBe('*/15 * * * *');
    expect(cfg.merchants).toEqual([{ merchantId: 111, countryCode: 'US', cultureCode: 'en-US' }]);
    expect(cfg.teamsWebhookUrl).toBe('https://hook');
  });
});
