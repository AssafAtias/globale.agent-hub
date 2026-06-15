import Chip from '@mui/material/Chip';

const COLOR: Record<string, 'default' | 'warning' | 'info' | 'success' | 'error'> = {
  pending: 'warning',
  running: 'info',
  done: 'success',
  failed: 'error',
};

export function RunStatusBadge({ status }: { status: string }) {
  return <Chip label={status} color={COLOR[status] ?? 'default'} size="small" />;
}
