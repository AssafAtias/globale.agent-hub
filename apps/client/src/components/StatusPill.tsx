import Box from '@mui/material/Box';
import { stateStyles, type WorkerState } from './dashboard/palette.js';

export function StatusPill({ state }: { state: WorkerState }) {
  const s = stateStyles[state];
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.5,
        px: 1, py: 0.25, borderRadius: 999, fontSize: 12, fontWeight: 600,
        color: s.fg, bgcolor: s.bg, whiteSpace: 'nowrap', lineHeight: 1.6,
      }}
    >
      <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: s.fg }} />
      {s.label}
    </Box>
  );
}
