import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import CardActions from '@mui/material/CardActions';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { useNavigate } from 'react-router-dom';
import { type Agent } from '../api/client.js';
import { useTriggerRun } from '../hooks/useAgents.js';
import { AgentAvatar } from './AgentAvatar.js';

interface Props { agent: Agent; onEdit: (id: string) => void; }

const MAX_VISIBLE_SKILLS = 4;

export function AgentCard({ agent, onEdit }: Props) {
  const trigger = useTriggerRun();
  const navigate = useNavigate();
  const parse = <T,>(raw: string | null | undefined, fallback: T): T => {
    try { return JSON.parse(raw || '') as T; } catch { return fallback; }
  };
  const repos = parse<string[]>(agent.repos, []);
  const skills = parse<string[]>(agent.skills, []);
  const visibleSkills = skills.slice(0, MAX_VISIBLE_SKILLS);
  const overflow = skills.length - visibleSkills.length;

  return (
    <Card sx={{ mb: 2 }}>
      <CardActionArea onClick={() => navigate(`/agents/${agent.id}`)}>
        <CardContent>
          <Box display="flex" gap={2} alignItems="center">
            <AgentAvatar avatarKey={agent.avatarKey} name={agent.name} size={48} />
            <Box flex={1} minWidth={0}>
              <Typography variant="h6">{agent.name}</Typography>
              {agent.title && (
                <Typography variant="body2" color="text.secondary">{agent.title}</Typography>
              )}
            </Box>
            <Chip
              label={agent.enabled ? 'active' : 'paused'}
              color={agent.enabled ? 'success' : 'default'}
              size="small"
            />
          </Box>
          <Box mt={1}>
            <Chip label={agent.type} size="small" sx={{ mr: 1 }} />
            <Chip label={agent.model} size="small" variant="outlined" />
          </Box>
          {visibleSkills.length > 0 && (
            <Stack direction="row" spacing={1} mt={1} flexWrap="wrap" useFlexGap>
              {visibleSkills.map((s) => (
                <Chip key={s} label={s} size="small" color="primary" variant="outlined" />
              ))}
              {overflow > 0 && <Chip label={`+${overflow}`} size="small" />}
            </Stack>
          )}
          <Typography variant="body2" color="text.secondary" mt={1}>
            {repos.join(', ') || 'No repos configured'}
          </Typography>
        </CardContent>
      </CardActionArea>
      <CardActions>
        <Button size="small" onClick={() => onEdit(agent.id)}>Edit</Button>
        <Button
          size="small" variant="contained" startIcon={<PlayArrowIcon />}
          onClick={() => trigger.mutate(agent.id, { onSuccess: (run) => navigate(`/runs/${run.id}`) })}
          disabled={trigger.isPending}
        >
          Run
        </Button>
      </CardActions>
    </Card>
  );
}
