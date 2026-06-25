import { useMemo, useState } from 'react';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import SearchIcon from '@mui/icons-material/Search';
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors,
  closestCenter, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, rectSortingStrategy,
} from '@dnd-kit/sortable';
import { useNavigate } from 'react-router-dom';
import { useAgents, useReorderAgents } from '../hooks/useAgents.js';
import { useRuns } from '../hooks/useRuns.js';
import { computeReorder } from '../lib/reorder.js';
import { buildAgentCardModels, matchesStatusFilter, type StatusFilter } from '../lib/cardView.js';
import { AgentCard } from '../components/AgentCard.js';
import { SortableAgentCard } from '../components/SortableAgentCard.js';

const GRID_SX = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
  gap: 2,
} as const;

export function AgentsPage() {
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const { data: agents, isLoading, isError } = useAgents(showArchived);
  const { data: runs } = useRuns();
  const reorder = useReorderAgents();
  const navigate = useNavigate();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const all = useMemo(() => agents ?? [], [agents]);
  const models = useMemo(() => buildAgentCardModels(all, runs ?? []), [all, runs]);

  if (isLoading) return <CircularProgress />;
  if (isError) return <Typography color="error">Failed to load agents. Is the server running?</Typography>;

  const active = all.filter((a) => !a.archived);
  const archived = all.filter((a) => a.archived);

  const matchesSearch = (name: string) => name.toLowerCase().includes(search.trim().toLowerCase());
  const visibleActive = active.filter((a) => {
    const state = models.get(a.id)?.state ?? 'idle';
    return matchesSearch(a.name) && matchesStatusFilter(state, status);
  });
  const activeIds = visibleActive.map((a) => a.id);

  const onEdit = (id: string) => navigate(`/agents/${id}/edit`);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active: dragged, over } = event;
    if (!over || dragged.id === over.id) return;
    // reorder over the full visible (unfiltered) active list to keep ordering stable
    const fullIds = active.map((a) => a.id);
    const next = computeReorder(fullIds, String(dragged.id), String(over.id));
    reorder.mutate(next);
  };

  const dndDisabled = search.trim() !== '' || status !== 'all';

  return (
    <>
      <Box display="flex" alignItems="center" gap={1.5} mb={2}>
        <Typography variant="h5">Agents</Typography>
        <Typography variant="body2" color="text.secondary" flex={1}>
          · {active.length} active
        </Typography>
        <FormControlLabel
          control={<Switch size="small" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />}
          label="Show archived"
        />
        <Button variant="contained" onClick={() => navigate('/agents/new')}>New agent</Button>
      </Box>

      <Box display="flex" gap={2} mb={2} alignItems="center" flexWrap="wrap">
        <TextField
          size="small"
          placeholder="Search agents"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ flex: 1, minWidth: 220 }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
        />
        <ToggleButtonGroup
          size="small"
          exclusive
          value={status}
          onChange={(_, v) => v && setStatus(v as StatusFilter)}
        >
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="running">Running</ToggleButton>
          <ToggleButton value="idle">Idle</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={activeIds} strategy={rectSortingStrategy} disabled={dndDisabled}>
          <Box sx={GRID_SX}>
            {visibleActive.map((a) => (
              <SortableAgentCard key={a.id} agent={a} onEdit={onEdit} model={models.get(a.id)} />
            ))}
          </Box>
        </SortableContext>
      </DndContext>

      {active.length > 0 && visibleActive.length === 0 && (
        <Typography color="text.secondary">No agents match your search.</Typography>
      )}

      {showArchived && archived.length > 0 && (
        <>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 3, mb: 1 }}>Archived</Typography>
          <Box sx={GRID_SX}>
            {archived.map((a) => (
              <AgentCard key={a.id} agent={a} onEdit={onEdit} model={models.get(a.id)} />
            ))}
          </Box>
        </>
      )}

      {all.length === 0 && (
        <Typography color="text.secondary">No agents yet. Create one to get started.</Typography>
      )}
    </>
  );
}
