import { Cron } from 'croner';
import { loadVwoMonitorConfig, type VwoMonitorConfig, type Merchant } from './vwoMonitorConfig.js';
import { probeMerchant, type ProbeResult } from './probe.js';
import { decide, type State } from './stateMachine.js';
import { TeamsWebhookNotifier, buildVwoCard } from '../teams/TeamsWebhookNotifier.js';

export interface MonitorLog {
  info: (o: object, m?: string) => void;
  warn: (o: object, m?: string) => void;
  error: (o: object, m?: string) => void;
}

export interface VwoMonitorDeps {
  config: VwoMonitorConfig;
  probe: (m: Merchant) => Promise<ProbeResult>;
  postCard: (card: object) => Promise<void>;
  log: MonitorLog;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

function describeResult(m: Merchant, r: ProbeResult): string {
  const who = `merchant ${m.merchantId} (${m.countryCode}/${m.cultureCode})`;
  return r.ok
    ? `${who}: variation=${r.variation}, HTTP ${r.httpStatus}`
    : `${who}: FAILED reason=${r.reason}${r.httpStatus ? `, HTTP ${r.httpStatus}` : ''}`;
}

export function createVwoMonitor(deps: VwoMonitorDeps): {
  tick: () => Promise<void>;
  start: () => () => void;
} {
  const state = new Map<number, State>();
  const retryDelayMs = deps.retryDelayMs ?? 3_000;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  // One probe; retry ONCE on a transient failure. campaign_missing is the signal
  // we alert on (not a blip), so it is never retried.
  async function probeWithRetry(m: Merchant): Promise<ProbeResult> {
    const first = await deps.probe(m);
    if (first.ok || first.reason === 'campaign_missing') return first;
    await sleep(retryDelayMs);
    return deps.probe(m);
  }

  async function tick(): Promise<void> {
    for (const m of deps.config.merchants) {
      try {
        const result = await probeWithRetry(m);
        const prev = state.get(m.merchantId) ?? 'unknown';
        const { next, action } = decide(prev, result, /* isDailyTick */ true);
        state.set(m.merchantId, next);

        const line = describeResult(m, result);
        deps.log.info({ merchantId: m.merchantId, action, result }, `[VwoMonitor] ${line}`);

        if (action !== 'none') {
          await deps
            .postCard(buildVwoCard(action, [line]))
            .catch((e) => deps.log.error({ err: String(e), merchantId: m.merchantId }, '[VwoMonitor] Teams post failed'));
        }
      } catch (e) {
        deps.log.error({ err: String(e), merchantId: m.merchantId }, '[VwoMonitor] tick failed for merchant');
      }
    }
  }

  function start(): () => void {
    if (!deps.config.enabled) {
      deps.log.info({}, '[VwoMonitor] disabled (VWO_MONITOR_ENABLED not set) — not scheduling');
      return () => {};
    }
    let cron: Cron;
    try {
      cron = new Cron(deps.config.cron, () => { void tick(); });
    } catch (e) {
      deps.log.error(
        { err: String(e), cron: deps.config.cron },
        '[VwoMonitor] invalid cron expression — monitor not scheduled',
      );
      return () => {};
    }
    deps.log.info(
      { cron: deps.config.cron, merchants: deps.config.merchants.length },
      '[VwoMonitor] scheduled',
    );
    return () => cron.stop();
  }

  return { tick, start };
}

/** Wire real dependencies from env and start the monitor. Returns a stop function. */
export function startVwoMonitor(env: NodeJS.ProcessEnv, log: MonitorLog): () => void {
  const config = loadVwoMonitorConfig(env);
  if (config.enabled && !config.teamsWebhookUrl) {
    log.warn({}, '[VwoMonitor] enabled but TEAMS_WEBHOOK_URL is not set — alerts cannot be delivered');
  }
  const notifier = config.teamsWebhookUrl ? new TeamsWebhookNotifier(config.teamsWebhookUrl) : null;
  const monitor = createVwoMonitor({
    config,
    probe: (m) => probeMerchant(config, m),
    postCard: (card) =>
      notifier ? notifier.postCard(card) : Promise.reject(new Error('TEAMS_WEBHOOK_URL not set')),
    log,
  });
  return monitor.start();
}
