import { useMemo, useState } from 'react';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import { useRuns } from '../hooks/useRuns.js';
import { useAgents } from '../hooks/useAgents.js';
import { selectActiveRuns, computeAgentHealth, filterFeed, type FeedFilter } from '../lib/runStats.js';
import { NowStrip } from '../components/NowStrip.js';
import { AgentHealthTiles } from '../components/AgentHealthTiles.js';
import { ActivityFeed } from '../components/ActivityFeed.js';

export function MonitoringDashboard() {
  const { data: runs, isLoading, isError } = useRuns();
  const { data: agents } = useAgents();
  const [filter, setFilter] = useState<FeedFilter>({});

  const runList = runs ?? [];
  const agentList = agents ?? [];

  const agentsById = useMemo(
    () => Object.fromEntries(agentList.map((a) => [a.id, a])),
    [agentList]
  );
  const active = useMemo(() => selectActiveRuns(runList), [runList]);
  const health = useMemo(() => computeAgentHealth(runList, agentList), [runList, agentList]);
  const feed = useMemo(() => filterFeed(runList, filter), [runList, filter]);

  if (isLoading) return <CircularProgress sx={{ mt: 2 }} />;
  if (isError) return <Typography color="error">Failed to load. Is the server running?</Typography>;

  return (
    <>
      <Typography variant="h5" gutterBottom>Activity</Typography>
      <NowStrip runs={active} agentsById={agentsById} />
      <AgentHealthTiles health={health} />
      <ActivityFeed
        runs={feed}
        agents={agentList}
        agentsById={agentsById}
        filter={filter}
        onFilterChange={setFilter}
      />
    </>
  );
}
