import type { InputHTMLAttributes, ReactNode } from 'react';
import Icon from './ui/Icon';

/* Placeholder marketing copy for the sign-in pages. Change it here only. */
export const AUTH_HEADLINE: string[] = ['Every job.', 'One crew.', 'One place.'];
export const AUTH_TAGLINE = 'Field management for contractors.';

/**
 * Layout "F" (orange diagonal) used by Login, Forgot password, Reset password and Accept invite.
 * Desktop (900px+): orange panel with a diagonal right edge, form on the dark side.
 * Phone: a slim orange band with the wordmark, then the form. Layout lives in index.css (.fo-auth-*).
 */
export default function AuthShell({
  title,
  subtitle,
  children,
  center = false,
}: {
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode;
  /** Center the heading and content (used by message screens such as "Check your email"). */
  center?: boolean;
}) {
  return (
    <div className="fo-auth">
      <aside className="fo-auth-brand">
        <div className="fo-auth-wordmark">
          <span>FieldOps Pro</span>
          <span className="fo-auth-wordmark-bar" aria-hidden="true" />
        </div>
        <div className="fo-auth-hero">
          <p className="fo-auth-headline">
            {AUTH_HEADLINE.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </p>
          <p className="fo-auth-tagline">{AUTH_TAGLINE}</p>
        </div>
      </aside>
      <main className="fo-auth-main">
        <div className={`fo-auth-form${center ? ' is-center' : ''}`}>
          <h1 className="fo-auth-title">{title}</h1>
          {subtitle && <p className="fo-auth-subtitle">{subtitle}</p>}
          {children}
        </div>
      </main>
    </div>
  );
}

/** Label and input pair. `labelAside` sits on the right of the label row (e.g. "Forgot password"). */
export function AuthField({
  id,
  label,
  labelAside,
  hint,
  ...inputProps
}: { id: string; label: string; labelAside?: ReactNode; hint?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="fo-auth-field">
      <div className="fo-auth-label-row">
        <label htmlFor={id} className="fo-auth-label">{label}</label>
        {labelAside}
      </div>
      <input id={id} className="fo-auth-input" aria-describedby={hint ? `${id}-hint` : undefined} {...inputProps} />
      {hint && <p id={`${id}-hint`} className="fo-auth-hint">{hint}</p>}
    </div>
  );
}

/** Red error line, placed above the main button. */
export function AuthError({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="fo-auth-msg is-error">
      <Icon name="alert" size={15} />
      <span>{children}</span>
    </div>
  );
}

/** Green confirmation line. */
export function AuthSuccess({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="fo-auth-msg is-success">
      <Icon name="check" size={15} strokeWidth={3} />
      <span>{children}</span>
    </div>
  );
}
