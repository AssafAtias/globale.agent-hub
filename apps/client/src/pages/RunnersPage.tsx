import { useState } from 'react';
import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { runnerStats } from '../lib/runners.js';
import { relativeTime } from '../lib/dashboard.js';
import { StatCard } from '../components/StatCard.js';
import { RunnerConnectDialog } from '../components/RunnerConnectDialog.js';

export function RunnersPage() {
  const { data: runners, isError } = useQuery({ queryKey: ['runners'], queryFn: api.runners.list, refetchInterval: 10000 });
  const [dialogOpen, setDialogOpen] = useState(false);

  const list = runners ?? [];
  const stats = runnerStats(list);

  return (
    <>
      <Box display="flex" alignItems="center" gap={1.5} mb={2}>
        <Typography variant="h5">Runners</Typography>
        <Typography variant="body2" color="text.secondary" flex={1}>· {stats.total} total</Typography>
        <Button variant="contained" onClick={() => setDialogOpen(true)}>Add runner</Button>
      </Box>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(2, minmax(0, 220px))' }, mb: 3 }}>
        <StatCard label="Online" value={stats.online} accent="#4ade80" />
        <StatCard label="Total" value={stats.total} />
      </Box>

      {isError ? (
        <Typography color="error">Failed to load runners. Is the server running?</Typography>
      ) : list.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 8, border: '1px dashed', borderColor: 'divider', borderRadius: 3 }}>
          <Typography color="text.secondary" mb={2}>No runners connected.</Typography>
          <Button variant="contained" onClick={() => setDialogOpen(true)}>Add runner</Button>
        </Box>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell align="right">Last seen</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {list.map((r) => {
              const online = r.status === 'online';
              return (
                <TableRow key={r.id}>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: online ? '#4ade80' : 'text.disabled' }} />
                      {r.name}
                    </Box>
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title={new Date(r.lastSeen).toLocaleString()}>
                      <span>{relativeTime(r.lastSeen)}</span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <RunnerConnectDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  );
}
