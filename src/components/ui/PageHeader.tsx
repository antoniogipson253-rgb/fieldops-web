import { Fragment, type ReactNode } from 'react';
import { colors, fonts } from '../../theme';

type Crumb = { label: string; onClick?: () => void };

type Props = {
  title: ReactNode;
  /** Line(s) under the title. */
  subtitle?: ReactNode;
  /** e.g. [{ label: 'Projects', onClick }, { label: project.name }] */
  breadcrumb?: Crumb[];
  /** Right-hand side: buttons, legend, date. Wraps under the title on narrow screens. */
  actions?: ReactNode;
};

export const pageTitleStyle = {
  fontFamily: fonts.display,
  fontSize: 34,
  fontWeight: 700,
  lineHeight: 1.05,
  letterSpacing: '0.01em',
  color: colors.text,
  margin: 0,
  overflowWrap: 'anywhere' as const,
};

export default function PageHeader({ title, subtitle, breadcrumb, actions }: Props) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
      <div style={{ minWidth: 0, flex: '1 1 260px' }}>
        {breadcrumb && breadcrumb.length > 0 && (
          <nav aria-label="Breadcrumb" style={{ fontSize: 12, color: colors.text3, marginBottom: 6, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {breadcrumb.map((c, i) => (
              <Fragment key={i}>
                {i > 0 && <span aria-hidden="true">/</span>}
                {c.onClick ? (
                  <button
                    type="button"
                    onClick={c.onClick}
                    style={{ background: 'none', border: 'none', padding: 0, color: colors.text3, fontSize: 12, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}
                  >
                    {c.label}
                  </button>
                ) : (
                  <span aria-current="page" style={{ color: colors.text2 }}>{c.label}</span>
                )}
              </Fragment>
            ))}
          </nav>
        )}
        <h1 style={pageTitleStyle}>{title}</h1>
        {subtitle != null && <div style={{ marginTop: 6, fontSize: 14, color: colors.text2 }}>{subtitle}</div>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{actions}</div>}
    </div>
  );
}
