/** A member always renders the same colour, derived from their name. */
const HUES = [14, 32, 48, 95, 160, 190, 210, 260, 290, 330];

export function avatarHue(name: string): number {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export const AVATAR_EMOJI = ['🌞', '🏖️', '🏔️', '🎣', '🚣', '🍕', '🌮', '🎉', '🐶', '🦄', '🐢', '🦀', '🌵', '🍉', '🎸', '📸', '🧭', '🛶', '⛺', '🍦'];
