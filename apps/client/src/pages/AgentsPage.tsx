import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import { useNavigate } from 'react-router-dom';
import { useAgents } from '../hooks/useAgents.js';
import { AgentCard } from '../components/AgentCard.js';

export function AgentsPage() {
  const { data: agents, isLoading, isError } = useAgents();
  const navigate = useNavigate();

  if (isLoading) return <CircularProgress />;
  if (isError) return <Typography color="error">Failed to load agents. Is the server running?</Typography>;

  return (
    <>
      <Typography variant="h5" gutterBottom>Agents</Typography>
      <Button variant="contained" sx={{ mb: 2 }} onClick={() => navigate('/agents/new')}>
        + New Agent
      </Button>
      {(agents ?? []).map(a => (
        <AgentCard key={a.id} agent={a} onEdit={id => navigate(`/agents/${id}`)} />
      ))}
      {agents?.length === 0 && (
        <Typography color="text.secondary">No agents yet. Create one to get started.</Typography>
      )}
    </>
  );
}
