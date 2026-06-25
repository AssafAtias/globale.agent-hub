import { useState } from 'react';
import { resolveAvatar } from '../constants/avatars.js';

interface Props { avatarKey?: string | null; name: string; size?: number; }

function hashHue(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function AgentAvatar({ avatarKey, name, size = 40 }: Props) {
  const [broken, setBroken] = useState(false);
  const opt = resolveAvatar(avatarKey, name);
  const bg = `hsl(${opt?.hue ?? hashHue(name || '?')}, 65%, 55%)`;

  // Initials fallback — only if the image fails to load.
  if (broken || !opt) {
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
    <img
      src={opt.img}
      alt={`${name} avatar`}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setBroken(true)}
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', display: 'block' }}
    />
  );
}
