import { colors, fonts } from '../../theme';

export function initialsOf(name: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type Props = { names: string[]; max?: number; size?: number };

/** Overlapping initials circles; hovering shows the full names. */
export default function AvatarStack({ names, max = 3, size = 26 }: Props) {
  if (names.length === 0) {
    return <span style={{ fontSize: 12, color: colors.text3 }}>Unassigned</span>;
  }
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  const circle = {
    width: size,
    height: size,
    borderRadius: '50%',
    border: `2px solid ${colors.surface}`,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: fonts.ui,
    fontSize: 10,
    fontWeight: 600,
    flexShrink: 0,
  } as const;
  return (
    <span title={names.join(', ')} aria-label={`Assigned to ${names.join(', ')}`} style={{ display: 'inline-flex', alignItems: 'center' }}>
      {shown.map((n, i) => (
        <span key={i} style={{ ...circle, marginLeft: i === 0 ? 0 : -8, backgroundColor: colors.surface2, color: colors.text, zIndex: max - i }}>
          {initialsOf(n)}
        </span>
      ))}
      {extra > 0 && (
        <span style={{ ...circle, marginLeft: -8, backgroundColor: colors.border, color: colors.text2 }}>+{extra}</span>
      )}
    </span>
  );
}
