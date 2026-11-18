import { btn, colors, fonts, radius } from '../../theme';

type Props = {
  title: string;
  message?: string;
  /** Optional main action, e.g. "Add a task". */
  actionLabel?: string;
  onAction?: () => void;
  /** Smaller padding and title, for use inside a card or side panel. */
  compact?: boolean;
};

export default function EmptyState({ title, message, actionLabel, onAction, compact = false }: Props) {
  return (
    <div
      style={{
        border: `1px dashed ${colors.border}`,
        borderRadius: radius.card,
        padding: compact ? '20px 16px' : '32px 20px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontFamily: fonts.display, fontSize: compact ? 19 : 22, fontWeight: 700, letterSpacing: '0.03em', color: colors.text }}>
        {title}
      </div>
      {message && (
        <p style={{ fontFamily: fonts.ui, fontSize: compact ? 13 : 14, lineHeight: 1.5, color: colors.text2, margin: '6px auto 0', maxWidth: 420 }}>
          {message}
        </p>
      )}
      {actionLabel && onAction && (
        <button type="button" onClick={onAction} {...btn('primary', { marginTop: compact ? 12 : 16, padding: compact ? '8px 14px' : '10px 16px', fontSize: compact ? 13 : 14 })}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
