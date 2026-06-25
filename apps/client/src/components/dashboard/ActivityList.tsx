import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useNavigate } from 'react-router-dom';
import { type Run, type Agent } from '../../api/client.js';
import { colors, runMarker } from './palette.js';
import { relativeTime } from '../../lib/dashboard.js';

const VERB: Record<string, string> = {
  done: 'finished',
  running: 'started',
  failed: 'failed',
  pending: 'queued',
};

interface Props {
  runs: Run[];
  agentsById: Record<string, Agent>;
}

export function ActivityList({ runs, agentsById }: Props) {
  const navigate = useNavigate();

  return (
    <Box sx={{ mb: 2 }}>
      <Typography sx={{ color: colors.textMuted, fontSize: 15, mb: 1.5 }}>Activity</Typography>
      <Box
        sx={{
          bgcolor: colors.card,
          border: `1px solid ${colors.cardBorder}`,
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        {runs.length === 0 ? (
          <Typography sx={{ color: colors.textFaint, fontSize: 14, p: 2.5 }}>
            No activity yet.
          </Typography>
        ) : (
          runs.map((run, i) => {
            const name = agentsById[run.agentId]?.name ?? run.agentId.slice(0, 8);
            const when = run.finishedAt ?? run.createdAt;
            return (
              <Box
                key={run.id}
                onClick={() => navigate(`/runs/${run.id}`)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  px: 2.5,
                  py: 2,
                  cursor: 'pointer',
                  borderTop: i === 0 ? 'none' : `1px solid ${colors.divider}`,
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.025)' },
                }}
              >
                <Box
                  sx={{
                    width: 14,
                    height: 14,
                    borderRadius: 0.75,
                    flexShrink: 0,
                    bgcolor: runMarker[run.status] ?? colors.textFaint,
                  }}
                />
                <Typography sx={{ color: colors.text, fontSize: 15.5, flex: 1, minWidth: 0 }} noWrap>
                  {name} {VERB[run.status] ?? run.status}{' '}
                  {run.trigger && (
                    <Box component="span" sx={{ fontFamily: 'monospace', color: colors.textMuted }}>
                      {run.trigger}
                    </Box>
                  )}
                </Typography>
                <Typography sx={{ color: colors.textFaint, fontSize: 14, whiteSpace: 'nowrap' }}>
                  {relativeTime(when)}
                </Typography>
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
}
