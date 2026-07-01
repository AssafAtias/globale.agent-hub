import type { Merchant } from './vwoMonitorConfig.js';

export type ProbeResult =
  | { ok: true; merchantId: number; httpStatus: number; variation: string }
  | {
      ok: false;
      merchantId: number;
      reason: 'non_200' | 'timeout' | 'network' | 'campaign_missing';
      httpStatus?: number;
      detail?: string;
    };

/** Parse the `x-vwo-campaigns` header and return the variation for `campaignKey`, or null. */
export function extractVariation(
  headerValue: string | null | undefined,
  campaignKey: string,
): string | null {
  if (!headerValue) return null;
  try {
    const arr = JSON.parse(headerValue);
    if (!Array.isArray(arr)) return null;
    const entry = arr.find(
      (e) => e && typeof e === 'object' && e.CampaignKey === campaignKey,
    );
    return entry && typeof entry.Variation === 'string' ? entry.Variation : null;
  } catch {
    return null;
  }
}

/** Single probe of one merchant. Never throws — all faults map to a ProbeResult. */
export async function probeMerchant(
  cfg: { baseUrl: string; campaignKey: string },
  merchant: Merchant,
  timeoutMs = 10_000,
): Promise<ProbeResult> {
  const url =
    `${cfg.baseUrl}/api/v1/Shopify/field-validations-and-mapping-rules` +
    `?merchantId=${merchant.merchantId}&countryCode=${merchant.countryCode}&cultureCode=${merchant.cultureCode}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Origin: 'https://extensions.shopifycdn.com', Accept: '*/*' },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, merchantId: merchant.merchantId, reason: 'non_200', httpStatus: res.status };
    }
    const variation = extractVariation(res.headers.get('x-vwo-campaigns'), cfg.campaignKey);
    if (variation === null) {
      return { ok: false, merchantId: merchant.merchantId, reason: 'campaign_missing', httpStatus: res.status };
    }
    return { ok: true, merchantId: merchant.merchantId, httpStatus: res.status, variation };
  } catch (err: any) {
    const reason = err?.name === 'AbortError' ? 'timeout' : 'network';
    return { ok: false, merchantId: merchant.merchantId, reason, detail: String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}
