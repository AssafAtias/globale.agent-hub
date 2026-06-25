import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useNavigate } from 'react-router-dom';
import { AgentAvatar } from '../AgentAvatar.js';
import { colors, stateStyles } from './palette.js';
import { relativeTime, type WorkerCard } from '../../lib/dashboard.js';

function prettyModel(model: string): string {
  const tokens = model.replace(/^claude-/, '').split('-');
  const tier = tokens[0] ? tokens[0][0].toUpperCase() + tokens[0].slice(1) : model;
  const nums = tokens.slice(1).filter((t) => /^\d+$/.test(t) && t.length <= 2);
  return nums.length ? `${tier} ${nums.join('.')}` : tier;
}

function StatePill({ state }: { state: WorkerCard['state'] }) {
  const s = stateStyles[state];
  return (
    <Box
      sx={{
        px: 1.25,
        py: 0.25,
        borderRadius: 999,
        bgcolor: s.bg,
        color: s.fg,
        fontSize: 12.5,
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      {s.label}
    </Box>
  );
}

function Card({ card }: { card: WorkerCard }) {
  const navigate = useNavigate();
  const { agent, latest } = card;
  const idle = card.state === 'idle';
  const detail = latest
    ? agent.title ?? agent.focus ?? agent.type
    : 'Waiting for work';
  const meta = latest
    ? `${prettyModel(agent.model)} · ${relativeTime(latest.createdAt)}`
    : prettyModel(agent.model);

  return (
    <Box
      onClick={() => latest && navigate(`/runs/${latest.id}`)}
      sx={{
        bgcolor: colors.card,
        border: `1px solid ${colors.cardBorder}`,
        borderRadius: 3,
        p: 2.5,
        cursor: latest ? 'pointer' : 'default',
        transition: 'border-color 120ms',
        '&:hover': { borderColor: latest ? 'rgba(255,255,255,0.18)' : colors.cardBorder },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <AgentAvatar avatarKey={agent.avatarKey} name={agent.name} size={28} />
        <Typography sx={{ color: colors.text, fontSize: 19, fontWeight: 600, flex: 1 }} noWrap>
          {agent.name}
        </Typography>
        <StatePill state={card.state} />
      </Box>

      {latest?.trigger && !idle && (
        <Typography
          sx={{ color: colors.textMuted, fontFamily: 'monospace', fontSize: 13, mt: 2, letterSpacing: 0.4 }}
          noWrap
        >
          {latest.trigger}
        </Typography>
      )}
      <Typography sx={{ color: colors.text, fontSize: 16, mt: idle ? 2 : 0.5 }} noWrap>
        {detail}
      </Typography>
      <Typography sx={{ color: colors.textFaint, fontSize: 14, mt: 1.5 }} noWrap>
        {meta}
      </Typography>
    </Box>
  );
}

export function WorkerGrid({ cards }: { cards: WorkerCard[] }) {
  return (
    <Box sx={{ mb: 4 }}>
      <Typography sx={{ color: colors.textMuted, fontSize: 15, mb: 1.5 }}>Worker agents</Typography>
      {cards.length === 0 ? (
        <Typography sx={{ color: colors.textFaint, fontSize: 14 }}>No agents yet.</Typography>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
          }}
        >
          {cards.map((c) => (
            <Card key={c.agent.id} card={c} />
          ))}
        </Box>
      )}
    </Box>
  );
}
