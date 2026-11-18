import type { ReactNode } from 'react';
import { colors, fonts, radius, type StatusTone } from '../../theme';
import Skeleton from './Skeleton';

type Props = {
  label: string;
  /** The number. Pass undefined while loading to show a placeholder. */
  value: ReactNode | undefined;
  /** Small line under the number, e.g. "of 12 total". */
  sub?: ReactNode;
  /** Colour of the 3px top bar. Use "accent" (orange) for the main stat only. */
  tone?: 'accent' | StatusTone;
  /** When true the card fills with the red alert surface and the number turns red. */
  alert?: boolean;
};

export default function StatCard({ label, value, sub, tone = 'gray', alert = false }: Props) {
  const bar = alert ? colors.red : tone === 'accent' ? colors.accent : colors[tone];
  return (
    <div
      style={{
        backgroundColor: alert ? colors.redSurface : colors.surface,
        border: `1px solid ${colors.border}`,
        borderTop: `3px solid ${bar}`,
        borderRadius: radius.card,
        padding: '14px 16px 16px',
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontFamily: fonts.ui,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: colors.text2,
          lineHeight: 1.3,
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      {value === undefined ? (
        <Skeleton width={56} height={36} />
      ) : (
        <div
          style={{
            fontFamily: fonts.display,
            fontSize: 40,
            fontWeight: 700,
            lineHeight: 1,
            color: alert ? colors.red : colors.text,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </div>
      )}
      {sub != null && (
        <div style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.text3, marginTop: 6 }}>{sub}</div>
      )}
    </div>
  );
}
