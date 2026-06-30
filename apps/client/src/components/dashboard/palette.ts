// Scoped visual tokens for the redesigned monitoring dashboard.
// Kept local (not in the global theme) so other pages are unaffected.

export const colors = {
  pageBg: '#0f0f12',
  card: '#1a1a1d',
  cardBorder: 'rgba(255,255,255,0.08)',
  divider: 'rgba(255,255,255,0.07)',
  text: '#e7e7ec',
  textMuted: '#8c8c95',
  textFaint: '#62626b',
  live: '#4ade80',
};

export type WorkerState = 'working' | 'reviewing' | 'queued' | 'idle' | 'blocked' | 'waiting';

export const stateStyles: Record<WorkerState, { label: string; fg: string; bg: string }> = {
  working: { label: 'Working', fg: '#9ec1ff', bg: 'rgba(59,130,246,0.20)' },
  reviewing: { label: 'Reviewing', fg: '#e6b65c', bg: 'rgba(217,160,60,0.16)' },
  queued: { label: 'Queued', fg: '#9ec1ff', bg: 'rgba(59,130,246,0.12)' },
  idle: { label: 'Idle', fg: '#9a9aa0', bg: 'rgba(255,255,255,0.07)' },
  blocked: { label: 'Blocked', fg: '#f0908f', bg: 'rgba(220,70,70,0.20)' },
  waiting: { label: 'Waiting', fg: '#e6b65c', bg: 'rgba(217,160,60,0.16)' },
};

export const runMarker: Record<string, string> = {
  done: '#4ade80',
  running: '#5b9bff',
  failed: '#f0706f',
  pending: '#e6b65c',
};
