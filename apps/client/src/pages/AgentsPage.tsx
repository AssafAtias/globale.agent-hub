import { useState } from 'react';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors,
  closestCenter, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, rectSortingStrategy,
} from '@dnd-kit/sortable';
import { useNavigate } from 'react-router-dom';
import { useAgents, useReorderAgents } from '../hooks/useAgents.js';
import { computeReorder } from '../lib/reorder.js';
import { AgentCard } from '../components/AgentCard.js';
import { SortableAgentCard } from '../components/SortableAgentCard.js';

const GRID_SX = {
  display: 'grid',
  gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
  gap: 2,
} as const;

export function AgentsPage() {
  const [showArchived, setShowArchived] = useState(false);
  const { data: agents, isLoading, isError } = useAgents(showArchived);
  const reorder = useReorderAgents();
  const navigate = useNavigate();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (isLoading) return <CircularProgress />;
  if (isError) return <Typography color="error">Failed to load agents. Is the server running?</Typography>;

  const all = agents ?? [];
  const active = all.filter((a) => !a.archived);
  const archived = all.filter((a) => a.archived);
  const activeIds = active.map((a) => a.id);

  const onEdit = (id: string) => navigate(`/agents/${id}/edit`);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active: dragged, over } = event;
    if (!over || dragged.id === over.id) return;
    const next = computeReorder(activeIds, String(dragged.id), String(over.id));
    reorder.mutate(next);
  };

  return (
    <>
      <Box display="flex" alignItems="center" gap={2} mb={2}>
        <Typography variant="h5" flex={1}>Agents</Typography>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
          }
          label="Show archived"
        />
        <Button variant="contained" onClick={() => navigate('/agents/new')}>
          + New Agent
        </Button>
      </Box>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={activeIds} strategy={rectSortingStrategy}>
          <Box sx={GRID_SX}>
            {active.map((a) => (
              <SortableAgentCard key={a.id} agent={a} onEdit={onEdit} />
            ))}
          </Box>
        </SortableContext>
      </DndContext>

      {showArchived && archived.length > 0 && (
        <>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 3, mb: 1 }}>
            Archived
          </Typography>
          <Box sx={GRID_SX}>
            {archived.map((a) => (
              <AgentCard key={a.id} agent={a} onEdit={onEdit} />
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
