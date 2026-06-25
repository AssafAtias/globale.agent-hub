import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import { colors } from './dashboard/palette.js';

export function WorkspaceChip() {
  return (
    <Box
      sx={{
        display: 'flex', alignItems: 'center', gap: 1,
        px: 1.5, py: 1, mx: 2, mb: 1,
        border: `1px solid ${colors.cardBorder}`, borderRadius: 2,
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ color: colors.text, fontSize: 14, fontWeight: 600, lineHeight: 1.2 }} noWrap>
          Global-E · CORE
        </Typography>
        <Typography sx={{ color: colors.textMuted, fontSize: 12 }} noWrap>Workspace</Typography>
      </Box>
      <UnfoldMoreIcon sx={{ fontSize: 18, color: colors.textMuted }} />
    </Box>
  );
}
