export interface GeneratedSession {
  clientId: string;
  checkoutId: string;
  variation: string | null;
}
export interface GenerateResult {
  n: number;
  variation1: number;
  control: number;
  none: number;
  sessions: GeneratedSession[];
}
export interface GenerateOpts {
  baseUrl: string;
  merchantId: number;
  countryCode: string;
  cultureCode: string;
  campaignKey: string;
  n: number;
  concurrency?: number;
}

/** Parse the `x-vwo-campaigns` header (JSON array) → variation for campaignKey, else null. */
export function extractVariation(
  header: string | null | undefined,
  campaignKey: string,
): string | null {
  if (!header) return null;
  try {
    const arr = JSON.parse(header);
    if (!Array.isArray(arr)) return null;
    const e = arr.find((x) => x && typeof x === 'object' && x.CampaignKey === campaignKey);
    return e && typeof e.Variation === 'string' ? e.Variation : null;
  } catch {
    return null;
  }
}

/**
 * Fire `n` field-validations requests, each with a distinct x-client-id (= one VWO visitor),
 * with a bounded concurrency pool. Always returns exactly `n` sessions; a failed request
 * yields variation:null (counted as `none`). Never throws per-session.
 */
export async function generateVwoSessions(
  opts: GenerateOpts,
  fetchImpl: typeof fetch = fetch,
  randomInt: () => number = () => Math.floor(Math.random() * 1_000_000_000),
): Promise<GenerateResult> {
  const { baseUrl, merchantId, countryCode, cultureCode, campaignKey, n } = opts;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 10, Math.max(1, n)));
  const url =
    `${baseUrl}/api/v1/Shopify/field-validations-and-mapping-rules` +
    `?merchantId=${merchantId}&countryCode=${countryCode}&cultureCode=${cultureCode}`;

  const sessions: GeneratedSession[] = new Array(n);

  async function runOne(i: number): Promise<void> {
    const clientId = `${randomInt()}.${randomInt()}.${merchantId}`;
    const checkoutId = `${randomInt().toString(16)}${randomInt().toString(16)}${randomInt().toString(16)}${randomInt().toString(16)}`
      .padEnd(32, '0')
      .slice(0, 32);
    let variation: string | null = null;
    try {
      const res = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Origin: 'https://extensions.shopifycdn.com',
          Accept: '*/*',
          'x-client-id': clientId,
          'x-checkout-id': checkoutId,
        },
      });
      if (res.ok) variation = extractVariation(res.headers.get('x-vwo-campaigns'), campaignKey);
    } catch {
      variation = null;
    }
    sessions[i] = { clientId, checkoutId, variation };
  }

  // Bounded pool over indices 0..n-1 — guarantees exactly n results, no dup/drop.
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= n) return;
      await runOne(i);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  let variation1 = 0;
  let control = 0;
  let none = 0;
  for (const s of sessions) {
    if (s.variation === 'Variation-1') variation1++;
    else if (s.variation === 'Control') control++;
    else none++;
  }
  return { n, variation1, control, none, sessions };
}
