import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { type Run, type Agent } from '../api/client.js';
import { RunStatusBadge } from './RunStatusBadge.js';

interface Props { runs: Run[]; agentsById: Record<string, Agent>; }

export function NowStrip({ runs, agentsById }: Props) {
  return (
    <Box mb={3}>
      <Typography variant="subtitle2" gutterBottom>Running now</Typography>
      {runs.length === 0 ? (
        <Typography variant="body2" color="text.secondary">Nothing running right now.</Typography>
      ) : (
        <Box display="flex" gap={1.5} flexWrap="wrap">
          {runs.map((run) => (
            <Paper key={run.id} variant="outlined" sx={{ px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2">{agentsById[run.agentId]?.name ?? run.agentId.slice(0, 8)}</Typography>
              <RunStatusBadge status={run.status} />
              <Typography variant="caption" color="text.secondary">
                {new Date(run.createdAt).toLocaleTimeString()}
              </Typography>
            </Paper>
          ))}
        </Box>
      )}
    </Box>
  );
}
