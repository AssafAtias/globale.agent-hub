import { useState } from 'react';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import CardActions from '@mui/material/CardActions';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ArchiveIcon from '@mui/icons-material/Archive';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import { useNavigate } from 'react-router-dom';
import { type Agent } from '../api/client.js';
import { useTriggerRun, useArchiveAgent, useDeleteAgent } from '../hooks/useAgents.js';
import { AgentAvatar } from './AgentAvatar.js';
import { StatusPill } from './StatusPill.js';
import { Sparkline } from './Sparkline.js';
import { summarizeTrigger, isRunningState, type AgentCardModel } from '../lib/cardView.js';
import { relativeTime } from '../lib/dashboard.js';

interface Props {
  agent: Agent;
  onEdit: (id: string) => void;
  model?: AgentCardModel;
  dragHandleProps?: React.HTMLAttributes<HTMLElement> & { ref?: (el: HTMLElement | null) => void };
}

const MAX_VISIBLE_SKILLS = 4;

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 700, color: accent }} noWrap>{value}</Typography>
    </Box>
  );
}

export function AgentCard({ agent, onEdit, model, dragHandleProps }: Props) {
  const trigger = useTriggerRun();
  const archive = useArchiveAgent();
  const del = useDeleteAgent();
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const parse = <T,>(raw: string | null | undefined, fallback: T): T => {
    try { return JSON.parse(raw || '') as T; } catch { return fallback; }
  };
  const repos = parse<string[]>(agent.repos, []);
  const skills = parse<string[]>(agent.skills, []);
  const visibleSkills = skills.slice(0, MAX_VISIBLE_SKILLS);
  const overflow = skills.length - visibleSkills.length;

  const health = model?.health;
  const running = model ? isRunningState(model.state) : false;
  const successText = health && health.successRate !== null ? `${Math.round(health.successRate * 100)}%` : '—';
  const lastText = health && health.lastRunAt ? relativeTime(health.lastRunAt) : '—';
  const trig = summarizeTrigger(agent.triggerRules);

  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', opacity: agent.archived ? 0.55 : 1 }}>
      <CardActionArea onClick={() => navigate(`/agents/${agent.id}`)}>
        <CardContent>
          <Box display="flex" gap={1} alignItems="center">
            {dragHandleProps && (
              <Box
                {...dragHandleProps}
                onClick={(e) => e.stopPropagation()}
                sx={{ cursor: 'grab', display: 'flex', color: 'text.disabled', touchAction: 'none' }}
                aria-label="Drag to reorder"
              >
                <DragIndicatorIcon fontSize="small" />
              </Box>
            )}
            <AgentAvatar avatarKey={agent.avatarKey} name={agent.name} size={48} />
            <Box flex={1} minWidth={0}>
              <Typography variant="h6" noWrap>{agent.name}</Typography>
              {agent.title && (
                <Typography variant="body2" color="text.secondary" noWrap>{agent.title}</Typography>
              )}
            </Box>
            {agent.archived ? (
              <Chip label="archived" color="warning" size="small" />
            ) : model ? (
              <StatusPill state={model.state} />
            ) : (
              <Chip label={agent.enabled ? 'active' : 'paused'} color={agent.enabled ? 'success' : 'default'} size="small" />
            )}
          </Box>

          <Typography variant="body2" color="text.secondary" mt={1} noWrap>
            {agent.model} · {trig}
          </Typography>

          {visibleSkills.length > 0 && (
            <Stack direction="row" spacing={1} mt={1} flexWrap="wrap" useFlexGap>
              {visibleSkills.map((s) => (
                <Chip key={s} label={s} size="small" color="primary" variant="outlined" />
              ))}
              {overflow > 0 && <Chip label={`+${overflow}`} size="small" />}
            </Stack>
          )}

          {model && (
            <>
              <Box display="flex" justifyContent="space-between" gap={1} mt={1.5}>
                <Metric label="Runs" value={String(health?.total ?? 0)} />
                <Metric label="Success" value={successText} accent={successText !== '—' ? '#4ade80' : undefined} />
                <Metric label="Last" value={lastText} />
              </Box>
              <Box mt={1}>
                <Sparkline markers={model.markers} />
              </Box>
            </>
          )}

          <Typography variant="body2" color="text.secondary" mt={1.5} noWrap>
            {repos.join(', ') || 'No repos configured'}
          </Typography>
        </CardContent>
      </CardActionArea>
      <CardActions sx={{ mt: 'auto' }}>
        {agent.archived ? (
          <>
            <Tooltip title="Unarchive">
              <IconButton
                size="small" aria-label="Unarchive agent"
                onClick={() => archive.mutate({ id: agent.id, archived: false })}
                disabled={archive.isPending}
              >
                <UnarchiveIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete permanently">
              <IconButton
                size="small" color="error" aria-label="Delete agent permanently"
                onClick={() => setConfirmOpen(true)}
              >
                <DeleteForeverIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        ) : (
          <>
            <Button size="small" onClick={() => onEdit(agent.id)}>Edit</Button>
            {running && model?.latest ? (
              <Button
                size="small" variant="contained"
                onClick={() => navigate(`/runs/${model.latest!.id}`)}
              >
                View run
              </Button>
            ) : (
              <Button
                size="small" variant="contained" startIcon={<PlayArrowIcon />}
                onClick={() => trigger.mutate(agent.id, { onSuccess: (run) => navigate(`/runs/${run.id}`) })}
                disabled={trigger.isPending}
              >
                Run
              </Button>
            )}
            <Tooltip title="Archive">
              <IconButton
                size="small" sx={{ ml: 'auto' }} aria-label="Archive agent"
                onClick={() => archive.mutate({ id: agent.id, archived: true })}
                disabled={archive.isPending}
              >
                <ArchiveIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        )}
      </CardActions>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Delete "{agent.name}" permanently?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This removes the agent and cannot be undone. Archived agents can be restored instead.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button
            color="error"
            disabled={del.isPending}
            onClick={() => del.mutate(agent.id, { onSuccess: () => setConfirmOpen(false) })}
          >
            Delete permanently
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
