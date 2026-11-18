import type { CSSProperties } from 'react';

export type IconName = 'check' | 'x' | 'alert' | 'plus' | 'chevron-left' | 'chevron-right' | 'chevron-down' | 'arrow-right' | 'trash' | 'mail' | 'dollar' | 'clock' | 'clipboard' | 'shield' | 'logout' | 'upload' | 'search';

const PATHS: Record<IconName, string> = {
  check: 'M4 12.5l5 5L20 6.5',
  x: 'M6 6l12 12M18 6L6 18',
  alert: 'M12 3.5L2.5 20h19L12 3.5zM12 10v4.5M12 17.5v.01',
  plus: 'M12 5v14M5 12h14',
  'chevron-left': 'M15 5l-7 7 7 7',
  'chevron-right': 'M9 5l7 7-7 7',
  'chevron-down': 'M5 9l7 7 7-7',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  dollar: 'M12 3v18M16.5 7.5C16 5.8 14.3 5 12 5c-2.6 0-4.5 1.2-4.5 3.2 0 4.6 9 2.4 9 7 0 2-1.9 3.3-4.5 3.3-2.4 0-4.2-.9-4.8-2.8',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  clipboard: 'M9 4h6v3H9zM8 5H6v16h12V5h-2M9 12h6M9 16h4',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6l8-3zM12 8v4M12 15.5v.01',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
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
