import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colors } from './palette.js';

const STAGES = [
  { label: 'Jira backlog', color: 'rgba(255,255,255,0.28)' },
  { label: 'Build MR', color: 'rgba(255,255,255,0.28)' },
  { label: 'Review', color: '#e6b65c' },
  { label: 'Merge', color: '#4ade80' },
];

function Node({ color }: { color: string }) {
  return <Box sx={{ width: 28, height: 28, borderRadius: 1.5, border: `2px solid ${color}` }} />;
}

function Connector() {
  return (
    <Box
      sx={{
        width: 18,
        height: 18,
        mt: '5px',
        borderRadius: 1,
        border: `2px solid ${colors.divider}`,
      }}
    />
  );
}

export function PipelineStrip() {
  return (
    <Box
      sx={{
        bgcolor: colors.card,
        border: `1px solid ${colors.cardBorder}`,
        borderRadius: 3,
        p: 3,
        mb: 4,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-around',
          gap: 1,
          overflowX: 'auto',
        }}
      >
        {STAGES.map((stage, i) => (
          <Box key={stage.label} sx={{ display: 'contents' }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, minWidth: 90 }}>
              <Node color={stage.color} />
              <Typography sx={{ color: colors.text, fontSize: 15, fontWeight: 500 }}>{stage.label}</Typography>
            </Box>
            {i < STAGES.length - 1 && <Connector />}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
