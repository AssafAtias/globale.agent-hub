import { startVwoMonitor } from '../../src/services/monitoring/VwoAbMonitor.js';

describe('startVwoMonitor wiring', () => {
  const noopLog = { info: () => {}, warn: () => {}, error: () => {} };

  it('returns a no-op stop when disabled and never touches fetch', () => {
    const originalFetch = global.fetch;
    const spy = jest.fn();
    global.fetch = spy as any;
    try {
      const stop = startVwoMonitor({} as NodeJS.ProcessEnv, noopLog); // VWO_MONITOR_ENABLED unset → disabled
      expect(typeof stop).toBe('function');
      stop();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('warns when enabled without a Teams webhook URL', () => {
    let warned = false;
    const log = { info: () => {}, warn: () => { warned = true; }, error: () => {} };
    const stop = startVwoMonitor(
      { VWO_MONITOR_ENABLED: 'true' } as NodeJS.ProcessEnv, // enabled, no TEAMS_WEBHOOK_URL
      log,
    );
    expect(warned).toBe(true);
    stop(); // stop the cron so the test process can exit cleanly
  });
});
