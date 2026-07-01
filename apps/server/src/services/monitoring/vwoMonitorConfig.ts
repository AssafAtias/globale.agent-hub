export interface Merchant {
  merchantId: number;
  countryCode: string;
  cultureCode: string;
}

export interface VwoMonitorConfig {
  enabled: boolean;
  baseUrl: string;
  campaignKey: string;
  cron: string;
  merchants: Merchant[];
  teamsWebhookUrl: string | undefined;
}

const DEFAULT_MERCHANTS = '30000603:US:en-US';

/** Parse a comma list of `merchantId:countryCode:cultureCode`; malformed entries are dropped. */
export function parseMerchants(raw: string): Merchant[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((tok): Merchant | null => {
      const [id, country, culture] = tok.split(':').map((p) => (p ?? '').trim());
      const merchantId = Number(id);
      if (!Number.isFinite(merchantId) || merchantId <= 0 || !country || !culture) return null;
      return { merchantId, countryCode: country, cultureCode: culture };
    })
    .filter((m): m is Merchant => m !== null);
}

export function loadVwoMonitorConfig(env: NodeJS.ProcessEnv = process.env): VwoMonitorConfig {
  const enabled = ['true', '1', 'yes'].includes((env.VWO_MONITOR_ENABLED ?? '').trim().toLowerCase());
  return {
    enabled,
    baseUrl: (env.VWO_MONITOR_BASE_URL ?? 'https://checkout-service-qa-hf.bglobale.com').replace(/\/+$/, ''),
    campaignKey: env.VWO_MONITOR_CAMPAIGN_KEY ?? 'ShippingAddressValidation',
    cron: env.VWO_MONITOR_CRON ?? '0 9 * * *',
    merchants: parseMerchants(env.VWO_MONITOR_MERCHANTS ?? DEFAULT_MERCHANTS),
    teamsWebhookUrl: env.TEAMS_WEBHOOK_URL,
  };
}
