import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colors } from './dashboard/palette.js';

interface Props { label: string; value: string | number; accent?: string; }

export function StatCard({ label, value, accent }: Props) {
  return (
    <Box sx={{ bgcolor: colors.card, border: `1px solid ${colors.cardBorder}`, borderRadius: 3, px: 2.5, py: 1.75 }}>
      <Typography sx={{ color: colors.textMuted, fontSize: 13, mb: 0.75 }}>{label}</Typography>
      <Typography sx={{ color: accent ?? colors.text, fontSize: 30, fontWeight: 700, lineHeight: 1 }}>
        {value}
      </Typography>
    </Box>
  );
}
