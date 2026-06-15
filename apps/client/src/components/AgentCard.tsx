import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardActions from '@mui/material/CardActions';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { type Agent } from '../api/client.js';
import { useTriggerRun } from '../hooks/useAgents.js';

interface Props { agent: Agent; onEdit: (id: string) => void; }

export function AgentCard({ agent, onEdit }: Props) {
  const trigger = useTriggerRun();
  const repos = JSON.parse(agent.repos || '[]') as string[];

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="h6">{agent.name}</Typography>
        <Chip label={agent.type} size="small" sx={{ mr: 1 }} />
        <Chip label={agent.model} size="small" variant="outlined" />
        <Typography variant="body2" color="text.secondary" mt={1}>
          {repos.join(', ') || 'No repos configured'}
        </Typography>
        <Chip
          label={agent.enabled ? 'active' : 'paused'}
          color={agent.enabled ? 'success' : 'default'}
          size="small" sx={{ mt: 1 }}
        />
      </CardContent>
      <CardActions>
        <Button size="small" onClick={() => onEdit(agent.id)}>Edit</Button>
        <Button
          size="small" variant="contained" startIcon={<PlayArrowIcon />}
          onClick={() => trigger.mutate(agent.id)}
          disabled={trigger.isPending}
        >
          Run
        </Button>
      </CardActions>
    </Card>
  );
}
