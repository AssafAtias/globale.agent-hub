import { colors } from '../components/dashboard/palette.js';

export type ChannelDot = 'connected' | 'off' | 'unknown';

export function channelDot(connected: boolean | undefined, isError: boolean): ChannelDot {
  if (isError || connected === undefined) return 'unknown';
  return connected ? 'connected' : 'off';
}

export function teamsDotColor(dot: ChannelDot): string {
  switch (dot) {
    case 'connected':
      return colors.live;
    case 'off':
      return colors.textFaint;
    case 'unknown':
      return colors.textMuted;
  }
}
