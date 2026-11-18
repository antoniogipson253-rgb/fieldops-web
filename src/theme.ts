import type { CSSProperties } from 'react';

/* FieldOps design tokens (Direction A, High-Vis Industrial).
   Mirrors the CSS variables in src/index.css; keep the two in sync.
   Orange (accent) is for actions and the current page only, never for a status. */

export const colors = {
  bg: '#0A0F1E',
  surface: '#111827',
  surface2: '#1A2235',
  border: '#2A3445',
  text: '#F9FAFB',
  text2: '#C7CDD6',
  text3: '#9CA3AF',
  accent: '#F97316',
  accentHover: '#FB923C',
  onAccent: '#0A0F1E',
  green: '#22C55E',
  blue: '#60A5FA',
  amber: '#FBBF24',
  red: '#F87171',
  gray: '#9CA3AF',
  /** Card fill for an alert stat (e.g. flagged clock-ins above 0). */
  redSurface: '#2A1618',
  /** Progress bar track. */
  track: '#1F2937',
} as const;

export const fonts = {
  ui: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  display: "'Barlow Condensed', 'Arial Narrow', 'Inter', sans-serif",
} as const;

export const radius = { card: 12, control: 8, pill: 999 } as const;

export const space = { cardPadding: 20 } as const;

/** Appends a two-digit alpha to a #RRGGBB color. 0.15 gives the chip tint. */
export function tint(hex: string, alpha = 0.15): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, '0');
  return `${hex}${a.toUpperCase()}`;
}

/* ---------- Status ---------- */

export type StatusTone = 'green' | 'blue' | 'amber' | 'red' | 'gray';

const STATUS_TONE: Record<string, StatusTone> = {
  // green: done / active
  active: 'green',
  completed: 'green',
  complete: 'green',
  done: 'green',
  // blue: in progress
  in_progress: 'blue',
  // amber: on hold / medium
  on_hold: 'amber',
  medium: 'amber',
  // red: high / flagged
  high: 'red',
  flagged: 'red',
  // gray: open / archived (and low priority)
  open: 'gray',
  archived: 'gray',
  low: 'gray',
  // automatic daily report sends
  sent: 'green',
  delivery_uncertain: 'amber',
  failed: 'red',
  // calendar: past due and not done
  overdue: 'red',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  completed: 'Completed',
  complete: 'Complete',
  done: 'Done',
  in_progress: 'In progress',
  on_hold: 'On hold',
  medium: 'Medium',
  high: 'High',
  flagged: 'Flagged',
  open: 'Open',
  archived: 'Archived',
  low: 'Low',
  sent: 'Sent',
  delivery_uncertain: 'Delivery uncertain',
  failed: 'Not delivered',
  overdue: 'Overdue',
};

export function statusTone(status: string | null | undefined): StatusTone {
  return STATUS_TONE[(status ?? '').toLowerCase()] ?? 'gray';
}

export function statusColor(status: string | null | undefined): string {
  return colors[statusTone(status)];
}

export function statusLabel(status: string | null | undefined): string {
  const key = (status ?? '').toLowerCase();
  if (STATUS_LABEL[key]) return STATUS_LABEL[key];
  const words = key.replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Unknown';
}

/* ---------- Style helpers (spread into inline styles) ---------- */

/** Status chip: full-strength text on a 15% tint, fully rounded. */
export function chip(status: string | null | undefined): CSSProperties {
  const c = statusColor(status);
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '3px 10px',
    borderRadius: radius.pill,
    backgroundColor: tint(c),
    color: c,
    fontFamily: fonts.ui,
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1.4,
    whiteSpace: 'nowrap',
  };
}

/** Standard card. Add className "fo-card fo-card-link" for a clickable card with hover lift. */
export const card: CSSProperties = {
  backgroundColor: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.card,
  padding: space.cardPadding,
};

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/** Class names that give a button its hover, press and disabled behavior. */
export function buttonClass(variant: ButtonVariant = 'primary'): string {
  return `fo-btn fo-btn-${variant}`;
}

/** Spread onto a <button>: className plus inline style, optionally with style overrides. */
export function btn(variant: ButtonVariant = 'primary', extra?: CSSProperties) {
  return { className: buttonClass(variant), style: { ...button(variant), ...extra } };
}

/** Small uppercase section label, e.g. card titles and form labels. */
export const sectionLabel: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: colors.text3,
};

/** Text inputs, selects and textareas. */
export const input: CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  backgroundColor: colors.surface2,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.control,
  color: colors.text,
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

/** Button styles. Add className "fo-btn" for hover, press and disabled behavior. */
export function button(variant: ButtonVariant = 'primary'): CSSProperties {
  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '10px 16px',
    borderRadius: radius.control,
    fontFamily: fonts.ui,
    fontSize: 14,
    fontWeight: 600,
    lineHeight: 1.2,
    cursor: 'pointer',
    border: '1px solid transparent',
  };
  switch (variant) {
    case 'primary':
      // Always dark text on orange: white on orange fails contrast.
      return { ...base, backgroundColor: colors.accent, borderColor: colors.accent, color: colors.onAccent };
    case 'secondary':
      return { ...base, backgroundColor: colors.surface2, borderColor: colors.border, color: colors.text };
    case 'ghost':
      return { ...base, backgroundColor: 'transparent', borderColor: colors.border, color: colors.text2 };
    case 'danger':
      return { ...base, backgroundColor: tint(colors.red), borderColor: colors.red, color: colors.red };
  }
}
