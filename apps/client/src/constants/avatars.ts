export interface AvatarOption {
  key: string;
  label: string;
  hue: number; // HSL hue for the avatar tint
}

export const AVATAR_GALLERY: AvatarOption[] = [
  { key: 'nova', label: 'Nova', hue: 210 },
  { key: 'ember', label: 'Ember', hue: 12 },
  { key: 'fern', label: 'Fern', hue: 140 },
  { key: 'iris', label: 'Iris', hue: 270 },
  { key: 'sol', label: 'Sol', hue: 45 },
  { key: 'coral', label: 'Coral', hue: 340 },
  { key: 'sky', label: 'Sky', hue: 190 },
  { key: 'slate', label: 'Slate', hue: 222 },
];

export function getAvatar(key?: string | null): AvatarOption | undefined {
  return AVATAR_GALLERY.find((a) => a.key === key);
}
