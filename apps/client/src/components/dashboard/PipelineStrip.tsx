import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ViewKanbanIcon from '@mui/icons-material/ViewKanban';
import BuildIcon from '@mui/icons-material/Build';
import RateReviewIcon from '@mui/icons-material/RateReview';
import CallMergeIcon from '@mui/icons-material/CallMerge';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import type { SvgIconComponent } from '@mui/icons-material';
import { colors } from './palette.js';

const STAGES: { label: string; color: string; Icon: SvgIconComponent }[] = [
  { label: 'Jira backlog', color: 'rgba(255,255,255,0.45)', Icon: ViewKanbanIcon },
  { label: 'Build MR', color: 'rgba(255,255,255,0.45)', Icon: BuildIcon },
  { label: 'Review', color: '#e6b65c', Icon: RateReviewIcon },
  { label: 'Merge', color: '#4ade80', Icon: CallMergeIcon },
];

function Node({ color, Icon }: { color: string; Icon: SvgIconComponent }) {
  return (
    <Box
      sx={{
        width: 40, height: 40, borderRadius: 2,
        border: `2px solid ${color}`, color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Icon sx={{ fontSize: 22 }} />
    </Box>
  );
}

export function PipelineStrip() {
  return (
    <Box sx={{ bgcolor: colors.card, border: `1px solid ${colors.cardBorder}`, borderRadius: 3, p: 3, mb: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-around', gap: 1, overflowX: 'auto' }}>
        {STAGES.map((stage, i) => (
          <Box key={stage.label} sx={{ display: 'contents' }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, minWidth: 90 }}>
              <Node color={stage.color} Icon={stage.Icon} />
              <Typography sx={{ color: colors.text, fontSize: 15, fontWeight: 500 }}>{stage.label}</Typography>
            </Box>
            {i < STAGES.length - 1 && (
              <ChevronRightIcon sx={{ color: colors.divider, mt: '8px', fontSize: 22 }} />
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
