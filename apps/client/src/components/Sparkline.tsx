import Box from '@mui/material/Box';
import { runMarker, colors } from './dashboard/palette.js';

export function Sparkline({ markers, count = 10 }: { markers: string[]; count?: number }) {
  const recent = markers.slice(-count);
  const pad = Math.max(0, count - recent.length);
  const slots: (string | null)[] = [...Array(pad).fill(null), ...recent];
  return (
    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'flex-end', height: 18 }}>
      {slots.map((status, i) => (
        <Box
          key={i}
          sx={{
            flex: 1,
            height: status ? 18 : 8,
            borderRadius: 0.5,
            bgcolor: status ? (runMarker[status] ?? colors.textFaint) : 'rgba(255,255,255,0.06)',
          }}
        />
      ))}
    </Box>
  );
}
