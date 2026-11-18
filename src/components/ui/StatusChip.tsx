import { chip, statusLabel } from '../../theme';

type Props = {
  /** Status or priority key, e.g. "active", "in_progress", "on_hold", "high", "open". */
  status: string | null | undefined;
  /** Optional text; defaults to a readable label for the status. */
  label?: string;
};

/** Green done/active, blue in progress, amber on hold/medium, red high/flagged, gray open/archived. */
export default function StatusChip({ status, label }: Props) {
  return <span style={chip(status)}>{label ?? statusLabel(status)}</span>;
}
