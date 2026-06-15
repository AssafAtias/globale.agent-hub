import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

export function RunnersPage() {
  const { data: runners } = useQuery({ queryKey: ['runners'], queryFn: api.runners.list, refetchInterval: 10000 });

  return (
    <>
      <Typography variant="h5" gutterBottom>Runners</Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Last Seen</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {(runners ?? []).map(r => (
            <TableRow key={r.id}>
              <TableCell>{r.name}</TableCell>
              <TableCell>
                <Chip label={r.status} color={r.status === 'online' ? 'success' : 'default'} size="small" />
              </TableCell>
              <TableCell>{new Date(r.lastSeen).toLocaleString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
