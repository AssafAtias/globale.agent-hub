import { createVwoMonitor } from '../../src/services/monitoring/VwoAbMonitor.js';
import type { VwoMonitorConfig } from '../../src/services/monitoring/vwoMonitorConfig.js';
import type { ProbeResult } from '../../src/services/monitoring/probe.js';

const merchant = { merchantId: 1, countryCode: 'US', cultureCode: 'en-US' };
const baseConfig: VwoMonitorConfig = {
  enabled: true, baseUrl: 'https://cs', campaignKey: 'ShippingAddressValidation',
  cron: '0 9 * * *', merchants: [merchant], teamsWebhookUrl: 'https://hook',
};
const noopLog = { info: () => {}, warn: () => {}, error: () => {} };
const ok: ProbeResult = { ok: true, merchantId: 1, httpStatus: 200, variation: 'Control' };
const missing: ProbeResult = { ok: false, merchantId: 1, reason: 'campaign_missing', httpStatus: 200 };
const netFail: ProbeResult = { ok: false, merchantId: 1, reason: 'network', detail: 'x' };

// The card is the only observable output; assert on its title block.
function titleOf(card: any): string { return card.attachments[0].content.body[0].text; }

describe('createVwoMonitor.tick', () => {
  it('posts a heartbeat when healthy from unknown', async () => {
    const posted: any[] = [];
    const monitor = createVwoMonitor({
      config: baseConfig, probe: async () => ok,
      postCard: async (c) => { posted.push(c); }, log: noopLog, retryDelayMs: 0, sleep: async () => {},
    });
    await monitor.tick();
    expect(posted).toHaveLength(1);
    expect(titleOf(posted[0])).toMatch(/healthy/i);
  });

  it('posts a failure card when the probe fails', async () => {
    const posted: any[] = [];
    const monitor = createVwoMonitor({
      config: baseConfig, probe: async () => missing,
      postCard: async (c) => { posted.push(c); }, log: noopLog, retryDelayMs: 0, sleep: async () => {},
    });
    await monitor.tick();
    expect(titleOf(posted[0])).toContain('DOWN');
  });

  it('posts a recovery card on failing → healthy across two ticks', async () => {
    const posted: any[] = [];
    const seq = [missing, ok]; let i = 0;
    const monitor = createVwoMonitor({
      config: baseConfig, probe: async () => seq[i++],
      postCard: async (c) => { posted.push(c); }, log: noopLog, retryDelayMs: 0, sleep: async () => {},
    });
    await monitor.tick(); // failing
    await monitor.tick(); // recovery
    expect(titleOf(posted[0])).toContain('DOWN');
    expect(titleOf(posted[1])).toContain('RECOVERED');
  });

  it('retries once on a transient (non-campaign_missing) failure and does NOT post if the retry succeeds', async () => {
    const posted: any[] = [];
    const seq = [netFail, ok]; let calls = 0;
    const monitor = createVwoMonitor({
      config: baseConfig, probe: async () => seq[calls++],
      postCard: async (c) => { posted.push(c); }, log: noopLog, retryDelayMs: 0, sleep: async () => {},
    });
    await monitor.tick();
    expect(calls).toBe(2);                 // retried
    expect(titleOf(posted[0])).toMatch(/healthy/i); // heartbeat, not failure
  });

  it('does NOT retry on campaign_missing (that is the signal, not a blip)', async () => {
    let calls = 0;
    const monitor = createVwoMonitor({
      config: baseConfig, probe: async () => { calls++; return missing; },
      postCard: async () => {}, log: noopLog, retryDelayMs: 0, sleep: async () => {},
    });
    await monitor.tick();
    expect(calls).toBe(1);
  });

  it('swallows a Teams post error (never throws out of tick)', async () => {
    const monitor = createVwoMonitor({
      config: baseConfig, probe: async () => ok,
      postCard: async () => { throw new Error('teams down'); }, log: noopLog, retryDelayMs: 0, sleep: async () => {},
    });
    await expect(monitor.tick()).resolves.toBeUndefined();
  });
});

describe('createVwoMonitor.start', () => {
  it('does not schedule when disabled and returns a no-op stop', () => {
    const monitor = createVwoMonitor({
      config: { ...baseConfig, enabled: false }, probe: async () => ok,
      postCard: async () => {}, log: noopLog,
    });
    const stop = monitor.start();
    expect(typeof stop).toBe('function');
    stop(); // must not throw
  });

  it('does not throw on an invalid cron expression and returns a callable no-op stop', () => {
    let errored = false;
    const log = { info: () => {}, warn: () => {}, error: () => { errored = true; } };
    const monitor = createVwoMonitor({
      config: { ...baseConfig, enabled: true, cron: 'not a valid cron' },
      probe: async () => ok,
      postCard: async () => {}, log,
    });
    let stop: () => void = () => {};
    expect(() => { stop = monitor.start(); }).not.toThrow();
    expect(typeof stop).toBe('function');
    expect(errored).toBe(true);
    stop();
  });
});
