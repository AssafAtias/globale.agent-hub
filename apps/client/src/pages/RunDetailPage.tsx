import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import CircularProgress from '@mui/material/CircularProgress';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import { useParams } from 'react-router-dom';
import { useRun } from '../hooks/useRuns.js';
import { useRespondToRun } from '../hooks/useRespondToRun.js';
import { RunStatusBadge } from '../components/RunStatusBadge.js';

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: run, isLoading } = useRun(id ?? '');
  const respond = useRespondToRun();
  const [answer, setAnswer] = useState('');

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
      {run.status === 'waiting_approval' && run.pendingGate && (() => {
        let gate: { kind: string; summary?: string; question: string } | null = null;
        try { gate = JSON.parse(run.pendingGate); } catch { gate = null; }
        if (!gate) return <Typography color="error" sx={{ mt: 2 }}>Malformed gate data</Typography>;
        return (
          <Box sx={{ mt: 2, p: 2, border: '1px solid', borderColor: 'warning.main', borderRadius: 1 }}>
            <Typography variant="subtitle2" gutterBottom>{gate.summary}</Typography>
            <Typography variant="body2" sx={{ mb: 1 }}>{gate.question}</Typography>
            {gate.kind !== 'approve_reject' && (
              <TextField
                fullWidth
                size="small"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Your response"
                sx={{ mb: 1 }}
              />
            )}
            <Button
              variant="contained"
              disabled={respond.isPending}
              onClick={() => respond.mutate({ id: run.id, decision: gate!.kind === 'approve_reject' ? 'approve' : 'answer', message: answer })}
            >
              {gate.kind === 'approve_reject' ? 'Approve' : 'Send'}
            </Button>
            <Button
              color="error"
              disabled={respond.isPending}
              onClick={() => respond.mutate({ id: run.id, decision: 'reject', message: answer })}
              sx={{ ml: 1 }}
            >
              Reject
            </Button>
          </Box>
        );
      })()}
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
