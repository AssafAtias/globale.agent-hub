import { useState } from 'react';
import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

const ROLES = ['admin', 'member'];

export function UsersPage() {
  const qc = useQueryClient();
  const { data, isError } = useQuery({ queryKey: ['users'], queryFn: api.users.list });
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const list = data ?? [];

  async function handleRoleChange(id: string, role: string) {
    setSaving(id);
    setSaveError(null);
    try {
      await api.users.setRole(id, role);
      qc.invalidateQueries({ queryKey: ['users'] });
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      <Box display="flex" alignItems="center" gap={1.5} mb={2}>
        <Typography variant="h5">Users</Typography>
        <Typography variant="body2" color="text.secondary" flex={1}>· {list.length} total</Typography>
      </Box>

      {saveError && (
        <Typography color="error" sx={{ mb: 2 }}>{saveError}</Typography>
      )}

      {isError ? (
        <Typography color="error">Failed to load users.</Typography>
      ) : list.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 8, border: '1px dashed', borderColor: 'divider', borderRadius: 3 }}>
          <Typography color="text.secondary">No users found.</Typography>
        </Box>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Role</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {list.map(u => (
              <TableRow key={u.id}>
                <TableCell>{u.name}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>
                  <Select
                    size="small"
                    value={u.role}
                    disabled={saving === u.id}
                    onChange={e => handleRoleChange(u.id, e.target.value)}
                    sx={{ fontSize: 13 }}
                  >
                    {ROLES.map(r => (
                      <MenuItem key={r} value={r}>{r}</MenuItem>
                    ))}
                  </Select>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
