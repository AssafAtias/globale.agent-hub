import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colors } from './palette.js';
import type { DashboardStats } from '../../lib/dashboard.js';

const CARD = {
  bgcolor: colors.card,
  border: `1px solid ${colors.cardBorder}`,
  borderRadius: 3,
  p: 2.5,
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Box sx={CARD}>
      <Typography sx={{ color: colors.textMuted, fontSize: 14, mb: 1.5 }}>{label}</Typography>
      <Typography sx={{ color: colors.text, fontSize: 40, fontWeight: 700, lineHeight: 1 }}>
        {value}
      </Typography>
    </Box>
  );
}

export function StatCards({ stats, queuedTasks }: { stats: DashboardStats; queuedTasks: number }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' },
        mb: 2,
      }}
    >
      <Stat label="Active agents" value={stats.activeAgents} />
      <Stat label="Tasks queued" value={queuedTasks} />
      <Stat label="MRs today" value={stats.mrsToday} />
      <Stat label="Avg cycle" value={stats.avgCycle} />
    </Box>
  );
}
