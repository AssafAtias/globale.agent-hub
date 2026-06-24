import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import { useNavigate } from 'react-router-dom';
import { type AgentHealth } from '../lib/runStats.js';
import { AgentAvatar } from './AgentAvatar.js';

interface Props { health: AgentHealth[]; }

function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

export function AgentHealthTiles({ health }: Props) {
  const navigate = useNavigate();

  return (
    <Box mb={3}>
      <Typography variant="subtitle2" gutterBottom>Agents</Typography>
      {health.length === 0 ? (
        <Typography variant="body2" color="text.secondary">No agents yet.</Typography>
      ) : (
        <Box display="flex" gap={2} flexWrap="wrap">
          {health.map((h) => (
            <Paper
              key={h.agent.id}
              variant="outlined"
              sx={{ p: 2, minWidth: 220, cursor: 'pointer' }}
              onClick={() => navigate(`/agents/${h.agent.id}`)}
            >
              <Box display="flex" alignItems="center" gap={1.5} mb={1}>
                <AgentAvatar avatarKey={h.agent.avatarKey} name={h.agent.name} size={36} />
                <Box flex={1} minWidth={0}>
                  <Typography variant="subtitle2" noWrap>{h.agent.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {h.lastRunAt ? `Last run ${new Date(h.lastRunAt).toLocaleString()}` : 'Never run'}
                  </Typography>
                </Box>
                {h.running > 0 && <Chip label="running" color="info" size="small" />}
              </Box>
              <Box display="flex" gap={1} alignItems="center">
                <Chip label={`✓ ${h.done}`} color="success" size="small" variant="outlined" />
                <Chip label={`✗ ${h.failed}`} color="error" size="small" variant="outlined" />
                <Typography variant="body2" color="text.secondary">{formatRate(h.successRate)} success</Typography>
              </Box>
            </Paper>
          ))}
        </Box>
      )}
    </Box>
  );
}
