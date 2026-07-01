import { decide, State } from '../../src/services/monitoring/stateMachine.js';
import type { ProbeResult } from '../../src/services/monitoring/probe.js';

const ok: ProbeResult = { ok: true, merchantId: 1, httpStatus: 200, variation: 'Control' };
const fail: ProbeResult = { ok: false, merchantId: 1, reason: 'campaign_missing', httpStatus: 200 };

describe('decide', () => {
  it('unknown + healthy on a daily tick → heartbeat', () => {
    expect(decide('unknown', ok, true)).toEqual({ next: 'healthy', action: 'heartbeat' });
  });
  it('any state + failure → failing/failure', () => {
    expect(decide('healthy', fail, true)).toEqual({ next: 'failing', action: 'failure' });
    expect(decide('unknown', fail, true)).toEqual({ next: 'failing', action: 'failure' });
    expect(decide('failing', fail, false)).toEqual({ next: 'failing', action: 'failure' });
  });
  it('failing + healthy → recovery (takes precedence over heartbeat)', () => {
    expect(decide('failing', ok, true)).toEqual({ next: 'healthy', action: 'recovery' });
  });
  it('healthy + healthy on a NON-daily tick → none', () => {
    expect(decide('healthy', ok, false)).toEqual({ next: 'healthy', action: 'none' });
  });
  it('unknown + healthy on a NON-daily tick → none', () => {
    expect(decide('unknown', ok, false)).toEqual({ next: 'healthy', action: 'none' });
  });
});
