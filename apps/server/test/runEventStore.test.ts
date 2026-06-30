import { RunEventStore } from '../src/services/RunEventStore.js';

describe('RunEventStore', () => {
  it('appends and lists in order', () => {
    RunEventStore.append('r1', { seq: 0, kind: 'tool', label: 'Read' });
    RunEventStore.append('r1', { seq: 1, kind: 'assistant', label: 'responding' });
    const out = RunEventStore.list('r1');
    expect(out.map((e) => e.seq)).toEqual([0, 1]);
  });
  it('returns [] for unknown run', () => {
    expect(RunEventStore.list('nope')).toEqual([]);
  });
  it('caps to last 200 per run', () => {
    for (let i = 0; i < 250; i++) RunEventStore.append('rcap', { seq: i, kind: 'x', label: 'y' });
    const out = RunEventStore.list('rcap');
    expect(out).toHaveLength(200);
    expect(out[0].seq).toBe(50);
  });
});
