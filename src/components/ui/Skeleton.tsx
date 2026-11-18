import type { CSSProperties } from 'react';
import { card } from '../../theme';

type Props = {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: CSSProperties;
};

/** One shimmering placeholder block. The shimmer stops when the device asks for reduced motion. */
export default function Skeleton({ width = '100%', height = 14, radius = 6, style }: Props) {
  return <span className="fo-skeleton" aria-hidden="true" style={{ width, height, borderRadius: radius, ...style }} />;
}

/** A card-shaped placeholder: a title line and a few text lines. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }} role="status" aria-label="Loading">
      <Skeleton width="45%" height={18} />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '70%' : '100%'} />
      ))}
    </div>
  );
}

/** A list of placeholder cards for a page that is loading. */
export function SkeletonList({ count = 3, lines = 2 }: { count?: number; lines?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} lines={lines} />
      ))}
    </div>
  );
}
