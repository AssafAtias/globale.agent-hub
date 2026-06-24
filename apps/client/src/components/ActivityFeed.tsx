import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import ArchiveIcon from '@mui/icons-material/Archive';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { type Run, type Agent, api } from '../api/client.js';
import { type FeedFilter } from '../lib/runStats.js';
import { RunStatusBadge } from './RunStatusBadge.js';

const STATUSES = ['pending', 'running', 'done', 'failed'];

interface Props {
  runs: Run[];
  agents: Agent[];
  agentsById: Record<string, Agent>;
  filter: FeedFilter;
  onFilterChange: (f: FeedFilter) => void;
}

function duration(run: Run): string {
  if (!run.finishedAt) return '-';
  return `${Math.round((new Date(run.finishedAt).getTime() - new Date(run.createdAt).getTime()) / 1000)}s`;
}

export function ActivityFeed({ runs, agents, agentsById, filter, onFilterChange }: Props) {
  const navigate = useNavigate();

  const queryClient = useQueryClient();
  const archiveMutation = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      api.runs.setArchived(id, archived),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['runs'] }),
  });

  return (
    <Box>
      <Box display="flex" gap={2} alignItems="center" mb={1}>
        <Typography variant="subtitle2" flex={1}>Activity</Typography>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Agent</InputLabel>
          <Select
            label="Agent"
            value={filter.agentId ?? ''}
            onChange={(e) => onFilterChange({ ...filter, agentId: e.target.value })}
          >
            <MenuItem value="">All agents</MenuItem>
            {agents.map((a) => <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>Status</InputLabel>
          <Select
            label="Status"
            value={filter.status ?? ''}
            onChange={(e) => onFilterChange({ ...filter, status: e.target.value })}
          >
            <MenuItem value="">All statuses</MenuItem>
            {STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={!!filter.showArchived}
              onChange={(e) => onFilterChange({ ...filter, showArchived: e.target.checked })}
            />
          }
          label="Show archived"
        />
      </Box>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Agent</TableCell>
            <TableCell>Trigger</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Started</TableCell>
            <TableCell>Duration</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {runs.map((run) => (
            <TableRow
              key={run.id}
              hover
              sx={{ cursor: 'pointer', opacity: run.archived ? 0.55 : 1 }}
              onClick={() => navigate(`/runs/${run.id}`)}
            >
              <TableCell>{agentsById[run.agentId]?.name ?? run.agentId.slice(0, 8)}</TableCell>
              <TableCell>{run.trigger}</TableCell>
              <TableCell><RunStatusBadge status={run.status} /></TableCell>
              <TableCell>{new Date(run.createdAt).toLocaleString()}</TableCell>
              <TableCell>{duration(run)}</TableCell>
              <TableCell align="right">
                <Tooltip title={run.archived ? 'Unarchive' : 'Archive'}>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      archiveMutation.mutate({ id: run.id, archived: !run.archived });
                    }}
                  >
                    {run.archived ? <UnarchiveIcon fontSize="small" /> : <ArchiveIcon fontSize="small" />}
                  </IconButton>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {runs.length === 0 && (
        <Typography color="text.secondary" variant="body2" sx={{ mt: 2 }}>No runs match.</Typography>
      )}
    </Box>
  );
}
