import { button, colors, fonts, radius } from '../../theme';

type Props = {
  title: string;
  message?: string;
  /** Optional main action, e.g. "Add a task". */
  actionLabel?: string;
  onAction?: () => void;
};

export default function EmptyState({ title, message, actionLabel, onAction }: Props) {
  return (
    <div
      style={{
        border: `1px dashed ${colors.border}`,
        borderRadius: radius.card,
        padding: '32px 20px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontFamily: fonts.display, fontSize: 22, fontWeight: 700, letterSpacing: '0.03em', color: colors.text }}>
        {title}
      </div>
      {message && (
        <p style={{ fontFamily: fonts.ui, fontSize: 14, lineHeight: 1.5, color: colors.text2, margin: '8px auto 0', maxWidth: 420 }}>
          {message}
        </p>
      )}
      {actionLabel && onAction && (
        <button type="button" className="fo-btn" onClick={onAction} style={{ ...button('primary'), marginTop: 16 }}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
