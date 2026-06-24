import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { AVATAR_GALLERY } from '../constants/avatars.js';
import { AgentAvatar } from './AgentAvatar.js';

interface Props { value?: string; onChange: (key: string) => void; name?: string; }

export function AvatarPicker({ value, onChange, name = 'Agent' }: Props) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">Avatar</Typography>
      <Box display="flex" gap={1.5} flexWrap="wrap" mt={0.5}>
        {AVATAR_GALLERY.map((opt) => (
          <Box
            key={opt.key}
            role="button"
            aria-label={`Choose ${opt.label} avatar`}
            aria-pressed={value === opt.key}
            onClick={() => onChange(opt.key)}
            sx={{
              cursor: 'pointer', borderRadius: '50%', padding: '2px',
              border: (t) => `2px solid ${value === opt.key ? t.palette.primary.main : 'transparent'}`,
            }}
          >
            <AgentAvatar avatarKey={opt.key} name={name} size={44} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}
