import { useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import LogoutIcon from '@mui/icons-material/Logout';
import { colors } from './dashboard/palette.js';
import { api } from '../api/client.js';
import { useAuthStore } from '../store/auth.store.js';

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0].toUpperCase())
    .join('');
}

async function handleLogout() {
  await fetch('/auth/logout', { method: 'POST' });
  window.location.href = '/';
}

export function SidebarAccount() {
  const { me, setMe } = useAuthStore();

  useEffect(() => {
    api.me()
      .then(user => setMe(user))
      .catch(() => setMe(null));
  }, [setMe]);

  const displayName = me?.name ?? '';
  const abbr = displayName ? initials(displayName) : '?';

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 2, borderTop: `1px solid ${colors.cardBorder}` }}>
      <Box
        sx={{
          width: 34, height: 34, borderRadius: '50%', bgcolor: '#cdd0f7', color: '#2a2a4a',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0,
        }}
      >
        {abbr}
      </Box>
      <Typography sx={{ flex: 1, color: colors.text, fontSize: 14, fontWeight: 500 }} noWrap>
        {displayName || '…'}
      </Typography>
      <Tooltip title="Sign out">
        <IconButton size="small" aria-label="Sign out" onClick={handleLogout} sx={{ color: colors.textMuted }}>
          <LogoutIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
