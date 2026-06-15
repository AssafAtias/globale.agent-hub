import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useNavigate } from 'react-router-dom';
import { useRuns } from '../hooks/useRuns.js';
import { RunStatusBadge } from '../components/RunStatusBadge.js';

export function RunHistoryPage() {
  const { data: runs } = useRuns();
  const navigate = useNavigate();

  return (
    <>
      <Typography variant="h5" gutterBottom>Run History</Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Agent</TableCell>
            <TableCell>Trigger</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Started</TableCell>
            <TableCell>Duration</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {(runs ?? []).map(run => (
            <TableRow key={run.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/runs/${run.id}`)}>
              <TableCell>{run.agentId.slice(0, 8)}</TableCell>
              <TableCell>{run.trigger}</TableCell>
              <TableCell><RunStatusBadge status={run.status} /></TableCell>
              <TableCell>{new Date(run.createdAt).toLocaleString()}</TableCell>
              <TableCell>
                {run.finishedAt
                  ? `${Math.round((new Date(run.finishedAt).getTime() - new Date(run.createdAt).getTime()) / 1000)}s`
                  : '-'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
