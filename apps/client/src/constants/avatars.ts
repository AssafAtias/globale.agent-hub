export interface AvatarOption {
  key: string;
  label: string;
  hue: number; // HSL hue for the fallback ring / initials background
  img: string; // served from apps/client/public/avatars (sourced from /images, see scripts/gen-avatars.mjs)
}

// Avatar pictures live in apps/client/public/avatars and originate from the
// repo-root /images folder. To add more: drop an image in /images, run
// `node scripts/gen-avatars.mjs` from apps/client, then add an entry here.
export const AVATAR_GALLERY: AvatarOption[] = [
  { key: 'maya', label: 'Maya', hue: 280, img: '/avatars/maya.avif' },
  { key: 'angelica', label: 'Angelica', hue: 340, img: '/avatars/angelica.jpg' },
  { key: 'leader', label: 'Leader', hue: 45, img: '/avatars/leader.png' },
  { key: 'agent3', label: 'Agent 3', hue: 160, img: '/avatars/agent-3.jpg' },
  { key: 'cartoon', label: 'Cartoon', hue: 190, img: '/avatars/cartoon.avif' },
  { key: 'support', label: 'Support', hue: 30, img: '/avatars/support-agent.webp' },
  { key: 'realestate', label: 'Real Estate', hue: 210, img: '/avatars/real-estate-agent.avif' },
];

export function getAvatar(key?: string | null): AvatarOption | undefined {
  return AVATAR_GALLERY.find((a) => a.key === key);
}

function hashString(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 100000;
  return h;
}

/**
 * Resolve the avatar to render for an agent. Uses the explicitly chosen
 * avatarKey when set; otherwise deterministically assigns one of the gallery
 * pictures by name hash so every agent always shows a picture (never a blank).
 */
export function resolveAvatar(key?: string | null, name = ''): AvatarOption {
  return getAvatar(key) ?? AVATAR_GALLERY[hashString(name || '?') % AVATAR_GALLERY.length];
}
