import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import { api, type Agent } from '../api/client.js';
import { useRuns } from '../hooks/useRuns.js';
import { AgentAvatar } from '../components/AgentAvatar.js';
import { RunStatusBadge } from '../components/RunStatusBadge.js';

const MAX_ACTIVITY = 10;

export function AgentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: runs } = useRuns();

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    api.agents.get(id)
      .then((a) => { if (!controller.signal.aborted) setAgent(a); })
      .catch((err) => { if (!controller.signal.aborted) setError(String(err)); });
    return () => controller.abort();
  }, [id]);

  if (error) return <Typography color="error">Agent not found.</Typography>;
  if (!agent) return <CircularProgress sx={{ mt: 2 }} />;

  const skills = (() => { try { return JSON.parse(agent.skills || '[]') as string[]; } catch { return []; } })();
  const activity = (runs ?? [])
    .filter((r) => r.agentId === agent.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_ACTIVITY);

  return (
    <Box maxWidth={720}>
      <Box display="flex" gap={3} alignItems="center">
        <AgentAvatar avatarKey={agent.avatarKey} name={agent.name} size={96} />
        <Box>
          <Box display="flex" alignItems="center" gap={1.5}>
            <Typography variant="h4">{agent.name}</Typography>
            <Chip
              label={agent.enabled ? 'online' : 'paused'}
              color={agent.enabled ? 'success' : 'default'} size="small"
            />
          </Box>
          {agent.title && <Typography variant="h6" color="text.secondary">{agent.title}</Typography>}
          {agent.bio && <Typography variant="body1" mt={1}>{agent.bio}</Typography>}
        </Box>
      </Box>

      <Box mt={3}>
        <Typography variant="subtitle2" gutterBottom>Skills</Typography>
        {skills.length > 0 ? (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {skills.map((s) => <Chip key={s} label={s} color="primary" variant="outlined" />)}
          </Stack>
        ) : <Typography color="text.secondary" variant="body2">No skills yet.</Typography>}
      </Box>

      <Divider sx={{ my: 3 }} />

      <Typography variant="subtitle2" gutterBottom>Recent activity</Typography>
      {activity.length > 0 ? (
        <Stack spacing={1}>
          {activity.map((run) => (
            <Box
              key={run.id} display="flex" alignItems="center" gap={2}
              sx={{ cursor: 'pointer' }} onClick={() => navigate(`/runs/${run.id}`)}
            >
              <RunStatusBadge status={run.status} />
              <Typography variant="body2">{run.trigger}</Typography>
              <Typography variant="body2" color="text.secondary">
                {new Date(run.createdAt).toLocaleString()}
              </Typography>
            </Box>
          ))}
        </Stack>
      ) : <Typography color="text.secondary" variant="body2">No runs yet.</Typography>}

      <Box mt={3}>
        <Button variant="outlined" onClick={() => navigate(`/agents/${agent.id}/edit`)}>
          Configure agent
        </Button>
      </Box>
    </Box>
  );
}
