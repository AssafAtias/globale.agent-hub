import Box from '@mui/material/Box';
import { StatCard } from '../StatCard.js';
import type { DashboardStats } from '../../lib/dashboard.js';

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
      <StatCard label="Active agents" value={stats.activeAgents} />
      <StatCard label="Tasks queued" value={queuedTasks} />
      <StatCard label="MRs today" value={stats.mrsToday} />
      <StatCard label="Avg cycle" value={stats.avgCycle} />
    </Box>
  );
}
