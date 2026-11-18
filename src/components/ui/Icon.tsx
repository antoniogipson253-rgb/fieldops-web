import type { CSSProperties } from 'react';

export type IconName = 'check' | 'x' | 'alert' | 'plus' | 'chevron-left' | 'chevron-right' | 'arrow-right';

const PATHS: Record<IconName, string> = {
  check: 'M4 12.5l5 5L20 6.5',
  x: 'M6 6l12 12M18 6L6 18',
  alert: 'M12 3.5L2.5 20h19L12 3.5zM12 10v4.5M12 17.5v.01',
  plus: 'M12 5v14M5 12h14',
  'chevron-left': 'M15 5l-7 7 7 7',
  'chevron-right': 'M9 5l7 7-7 7',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
};

type Props = { name: IconName; size?: number; strokeWidth?: number; style?: CSSProperties; title?: string };

/** Small inline line icon; draws in the current text color. */
export default function Icon({ name, size = 14, strokeWidth = 2.25, style, title }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      style={{ flexShrink: 0, verticalAlign: '-2px', ...style }}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
