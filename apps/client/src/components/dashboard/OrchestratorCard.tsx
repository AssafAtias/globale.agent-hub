import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colors } from './palette.js';

interface Props {
  assigned: number;
  inProgress: number;
  queued: number;
}

export function OrchestratorCard({ assigned, inProgress, queued }: Props) {
  return (
    <Box
      sx={{
        bgcolor: colors.card,
        border: `1px solid ${colors.cardBorder}`,
        borderRadius: 3,
        p: 3,
        mb: 2,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box
          sx={{
            width: 52,
            height: 52,
            borderRadius: '50%',
            bgcolor: '#cdd0f7',
            color: '#2a2a4a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 16,
            flexShrink: 0,
          }}
        >
          TL
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography sx={{ color: colors.text, fontSize: 22, fontWeight: 600 }}>
              Orchestrator
            </Typography>
            <Box
              sx={{
                px: 1.25,
                py: 0.25,
                borderRadius: 999,
                bgcolor: 'rgba(59,130,246,0.22)',
                color: '#9ec1ff',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              Coordinating
            </Box>
          </Box>
          <Typography sx={{ color: colors.textMuted, fontSize: 15, mt: 0.25 }}>
            Team leader · decomposes &amp; assigns work
          </Typography>
        </Box>
      </Box>

      <Box sx={{ borderTop: `1px solid ${colors.divider}`, my: 2.5 }} />

      <Typography sx={{ color: colors.textMuted, fontSize: 15 }}>
        Current mission: clear CORE sprint backlog · <b style={{ color: colors.text }}>{assigned} assigned</b> ·{' '}
        {inProgress} in progress · {queued} queued
      </Typography>
    </Box>
  );
}
