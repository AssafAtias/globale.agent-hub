import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import CircularProgress from '@mui/material/CircularProgress';
import { useParams } from 'react-router-dom';
import { useRun } from '../hooks/useRuns.js';
import { RunStatusBadge } from '../components/RunStatusBadge.js';

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: run, isLoading } = useRun(id ?? '');

  if (!id) return <Typography>Invalid run ID.</Typography>;
  if (isLoading) return <CircularProgress />;
  if (!run) return <Typography>Run not found.</Typography>;

  return (
    <Box>
      <Box display="flex" alignItems="center" gap={2} mb={3}>
        <Typography variant="h5">Run Detail</Typography>
        <RunStatusBadge status={run.status} />
      </Box>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Agent: {run.agentId} · Trigger: {run.trigger} · {new Date(run.createdAt).toLocaleString()}
      </Typography>
      {run.status === 'running' && <CircularProgress size={20} sx={{ mt: 2 }} />}
      {run.result && (
        <Paper sx={{ p: 2, mt: 2, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.85rem' }}>
          {run.result}
        </Paper>
      )}
      {run.error && (
        <Paper sx={{ p: 2, mt: 2, bgcolor: 'error.dark', whiteSpace: 'pre-wrap' }}>
          {run.error}
        </Paper>
      )}
    </Box>
  );
}
