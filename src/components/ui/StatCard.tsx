import type { ReactNode } from 'react';
import { colors, fonts, radius, tint, type StatusTone } from '../../theme';

type Props = {
  label: string;
  value: ReactNode;
  /** Small line under the number, e.g. "of 12 total". */
  sub?: ReactNode;
  /** Colour of the 3px top bar. Use "accent" (orange) for the main stat only. */
  tone?: 'accent' | StatusTone;
  /** When true the card fills with a red tint, e.g. flagged clock-ins above 0. */
  alert?: boolean;
};

export default function StatCard({ label, value, sub, tone = 'gray', alert = false }: Props) {
  const bar = alert ? colors.red : tone === 'accent' ? colors.accent : colors[tone];
  return (
    <div
      style={{
        backgroundColor: alert ? tint(colors.red, 0.12) : colors.surface,
        border: `1px solid ${alert ? colors.red : colors.border}`,
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
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: colors.text2,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: fonts.display,
          fontSize: 38,
          fontWeight: 700,
          lineHeight: 1,
          color: alert ? colors.red : colors.text,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      {sub != null && (
        <div style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.text3, marginTop: 6 }}>{sub}</div>
      )}
    </div>
  );
}
