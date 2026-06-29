import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { colors } from './dashboard/palette.js';
import { channelDot, teamsDotColor } from '../lib/integrations.js';

function ChannelRow({ name, connected, isError }: { name: string; connected: boolean | undefined; isError: boolean }) {
  const color = teamsDotColor(channelDot(connected, isError));
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
      <Typography sx={{ fontSize: 13, color: colors.textMuted }}>{name}</Typography>
    </Box>
  );
}

export function TeamsStatus() {
  const { data, isError } = useQuery({
    queryKey: ['integrations', 'teams'],
    queryFn: api.integrations.teams,
    refetchInterval: 30000,
  });

  return (
    <Box
      sx={{
        px: 2, py: 1.5, borderTop: `1px solid ${colors.cardBorder}`,
        display: 'flex', flexDirection: 'column', gap: 0.75,
      }}
    >
      <Typography sx={{ fontSize: 11, fontWeight: 600, color: colors.textFaint, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Teams
      </Typography>
      <ChannelRow name="Bot" connected={data?.bot.connected} isError={isError} />
      <ChannelRow name="Webhook" connected={data?.webhook.connected} isError={isError} />
    </Box>
  );
}
