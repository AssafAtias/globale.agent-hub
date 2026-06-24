import { getAvatar } from '../constants/avatars.js';

interface Props { avatarKey?: string | null; name: string; size?: number; }

function hashHue(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function AgentAvatar({ avatarKey, name, size = 40 }: Props) {
  const opt = getAvatar(avatarKey);
  const hue = opt ? opt.hue : hashHue(name || '?');
  const bg = `hsl(${hue}, 65%, 55%)`;

  if (!opt) {
    const initials =
      name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
    return (
      <div
        aria-label={`${name} avatar`}
        style={{
          width: size, height: size, borderRadius: '50%', background: bg,
          color: '#fff', display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: size * 0.4, fontWeight: 600,
        }}
      >
        {initials}
      </div>
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={`${name} avatar`}>
      <circle cx="20" cy="20" r="20" fill={bg} />
      <rect x="11" y="12" width="18" height="14" rx="3" fill="#fff" />
      <circle cx="16" cy="19" r="2.2" fill={bg} />
      <circle cx="24" cy="19" r="2.2" fill={bg} />
      <rect x="15" y="23" width="10" height="2" rx="1" fill={bg} />
      <rect x="19" y="7" width="2" height="5" fill="#fff" />
      <circle cx="20" cy="6" r="2" fill="#fff" />
    </svg>
  );
}
