import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import SettingsIcon from '@mui/icons-material/Settings';
import { colors } from './dashboard/palette.js';

export function SidebarAccount() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 2, borderTop: `1px solid ${colors.cardBorder}` }}>
      <Box
        sx={{
          width: 34, height: 34, borderRadius: '50%', bgcolor: '#cdd0f7', color: '#2a2a4a',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0,
        }}
      >
        AA
      </Box>
      <Typography sx={{ flex: 1, color: colors.text, fontSize: 14, fontWeight: 500 }} noWrap>Assaf A.</Typography>
      <IconButton size="small" aria-label="Settings" disabled sx={{ color: colors.textMuted }}>
        <SettingsIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}
