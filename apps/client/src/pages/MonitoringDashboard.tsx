import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import { useRuns } from '../hooks/useRuns.js';
import { useAgents } from '../hooks/useAgents.js';
import { computeDashboardStats, buildWorkerCards } from '../lib/dashboard.js';
import { colors } from '../components/dashboard/palette.js';
import { StatCards } from '../components/dashboard/StatCards.js';
import { OrchestratorCard } from '../components/dashboard/OrchestratorCard.js';
import { PipelineStrip } from '../components/dashboard/PipelineStrip.js';
import { WorkerGrid } from '../components/dashboard/WorkerGrid.js';
import { ActivityList } from '../components/dashboard/ActivityList.js';

const byCreatedDesc = (a: { createdAt: string }, b: { createdAt: string }) =>
  b.createdAt.localeCompare(a.createdAt);

export function MonitoringDashboard() {
  const { data: runs, isLoading, isError } = useRuns();
  const { data: agents } = useAgents();

  const runList = runs ?? [];
  const agentList = agents ?? [];

  const agentsById = useMemo(
    () => Object.fromEntries(agentList.map((a) => [a.id, a])),
    [agentList]
  );
  const stats = useMemo(() => computeDashboardStats(runList, agentList), [runList, agentList]);
  const cards = useMemo(() => buildWorkerCards(agentList, runList), [agentList, runList]);
  const feed = useMemo(
    () => runList.filter((r) => !r.archived).sort(byCreatedDesc).slice(0, 6),
    [runList]
  );

  const inProgress = runList.filter((r) => !r.archived && r.status === 'running').length;

  if (isLoading)
    return <CircularProgress sx={{ mt: 2 }} />;
  if (isError)
    return <Typography color="error">Failed to load. Is the server running?</Typography>;

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 3.5 }}>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ color: colors.text, fontSize: 34, fontWeight: 700, lineHeight: 1.1 }}>
            Activity
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
          <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: colors.live }} />
          <Typography sx={{ color: colors.textMuted, fontSize: 16 }}>
            {stats.liveCount} agents live
          </Typography>
        </Box>
      </Box>

      <StatCards stats={stats} queuedTasks={stats.tasksQueued} />
      <OrchestratorCard assigned={stats.activeAgents} inProgress={inProgress} queued={stats.tasksQueued} />
      <PipelineStrip />
      <WorkerGrid cards={cards} />
      <ActivityList runs={feed} agentsById={agentsById} />
    </Box>
  );
}
