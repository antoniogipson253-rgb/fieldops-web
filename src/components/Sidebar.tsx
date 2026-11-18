import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useIsAdmin, useUserRole } from '../lib/useIsAdmin';
import { colors, fonts, tint } from '../theme';

const BOTTOM_NAV_PATHS = ['/', '/projects', '/tasks', '/team', '/profile'];

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  project_manager: 'Project Manager',
  worker: 'Worker',
  client: 'Client',
};

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Display name for the user block: the profiles.full_name the Profile page shows, then the
 * name saved at sign-up (session metadata), then the email.
 * The profile query uses the same key and query as ProfilePage, so the two share one cached
 * copy, and saving a new name on Profile (which invalidates 'web-profile') updates the sidebar.
 */
function useDisplayName(): string {
  const [sessionUser, setSessionUser] = useState<{ id: string; metaName: string; email: string } | null>(null);
  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!alive || !session) return;
      const meta = session.user.user_metadata ?? {};
      setSessionUser({
        id: session.user.id,
        metaName: typeof meta.full_name === 'string' ? meta.full_name.trim() : '',
        email: session.user.email ?? '',
      });
    });
    return () => { alive = false; };
  }, []);

  const { data: profile } = useQuery({
    queryKey: ['web-profile', sessionUser?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', sessionUser!.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!sessionUser,
  });

  const profileName = typeof profile?.full_name === 'string' ? profile.full_name.trim() : '';
  return profileName || sessionUser?.metaName || sessionUser?.email || '';
}

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: isAdmin } = useIsAdmin();
  const { data: userRole } = useUserRole();
  const isPM = userRole === 'project_manager';
  const [moreOpen, setMoreOpen] = useState(false);
  const userName = useDisplayName();
  const roleLabel = userRole ? ROLE_LABELS[userRole] ?? userRole : '';

  const allNavItems = [
    { path: '/', label: 'Dashboard', show: true },
    { path: '/projects', label: 'Projects', show: true },
    { path: '/tasks', label: 'Tasks', show: true },
    { path: '/calendar', label: 'Calendar', show: true },
    { path: '/team', label: 'Team', show: true },
    { path: '/reports', label: 'Reports', show: true },
    { path: '/punch-list', label: 'Punch List', show: !!(isAdmin || isPM) },
    { path: '/payroll', label: 'Payroll', show: !!isAdmin },
    { path: '/timesheet', label: 'Timesheet', show: !!isAdmin },
    { path: '/files', label: 'Files', show: true },
    { path: '/profile', label: 'Settings', show: true },
    { path: '/incidents', label: 'Incidents', show: !!isAdmin },
  ];

  const navItems = allNavItems.filter((item) => item.show);
  const bottomItems = navItems.filter((item) => BOTTOM_NAV_PATHS.includes(item.path));
  const moreItems = navItems.filter((item) => !BOTTOM_NAV_PATHS.includes(item.path));

  const signOutButton = (
    <button
      type="button"
      className="fo-btn"
      onClick={() => supabase.auth.signOut()}
      style={{
        width: '100%',
        padding: '9px 12px',
        backgroundColor: 'transparent',
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        color: colors.text2,
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      Sign Out
    </button>
  );

  return (
    <>
      {/* ── DESKTOP SIDEBAR ── */}
      <div
        className="desktop-sidebar"
        style={{
          width: 220,
          height: '100vh',
          flexShrink: 0,
          backgroundColor: colors.bg,
          borderRight: `1px solid ${colors.border}`,
          display: 'flex',
          flexDirection: 'column',
          position: 'sticky',
          top: 0,
        }}
      >
        {/* Wordmark */}
        <div style={{ padding: '24px 20px 20px' }}>
          <div
            style={{
              fontFamily: fonts.display,
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: '0.05em',
              lineHeight: 1,
              color: colors.text,
              whiteSpace: 'nowrap',
            }}
          >
            FIELDOPS<span style={{ color: colors.accent }}> PRO</span>
          </div>
          <div style={{ width: 36, height: 3, borderRadius: 2, backgroundColor: colors.accent, marginTop: 8 }} />
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <button
                key={item.path}
                type="button"
                className={`fo-nav-item${isActive ? ' is-active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => navigate(item.path)}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* User block */}
        <div style={{ borderTop: `1px solid ${colors.border}`, padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div
              aria-hidden="true"
              style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                flexShrink: 0,
                backgroundColor: tint(colors.accent, 0.18),
                color: colors.accent,
                fontFamily: fonts.ui,
                fontSize: 11,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {userName ? initialsFor(userName) : ''}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: fonts.ui, fontSize: 12, fontWeight: 500, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {userName}
              </div>
              <div style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {roleLabel}
              </div>
            </div>
          </div>
          {signOutButton}
        </div>
      </div>

      {/* ── MOBILE BOTTOM TAB BAR ── */}
      <div className="mobile-bottom-nav" style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 64,
        backgroundColor: colors.bg,
        borderTop: `1px solid ${colors.border}`,
        display: 'flex',
        alignItems: 'stretch',
        zIndex: 1000,
      }}>
        {bottomItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <button
              key={item.path}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => navigate(item.path)}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'transparent',
                border: 'none',
                borderTop: `2px solid ${isActive ? colors.accent : 'transparent'}`,
                cursor: 'pointer',
                gap: 4,
              }}
            >
              <span style={{
                fontSize: 11,
                fontWeight: isActive ? 700 : 500,
                color: isActive ? colors.accent : colors.text3,
                letterSpacing: 0.5,
              }}>
                {item.label}
              </span>
            </button>
          );
        })}

        {/* More button */}
        {moreItems.length > 0 && (
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'transparent',
              border: 'none',
              borderTop: '2px solid transparent',
              cursor: 'pointer',
              gap: 4,
            }}
          >
            <span style={{ fontSize: 18, color: colors.text3, lineHeight: 1 }}>•••</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: colors.text3, letterSpacing: 0.5 }}>More</span>
          </button>
        )}
      </div>

      {/* ── MORE SHEET (slides up) ── */}
      {moreOpen && (
        <div
          onClick={() => setMoreOpen(false)}
          style={{
            position: 'fixed', inset: 0, backgroundColor: '#00000080', zIndex: 1001,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              bottom: 64,
              left: 0,
              right: 0,
              backgroundColor: colors.bg,
              borderTop: `1px solid ${colors.border}`,
              borderRadius: '16px 16px 0 0',
              padding: '12px 12px 8px',
            }}
          >
            <div style={{ width: 40, height: 4, backgroundColor: colors.border, borderRadius: 2, margin: '0 auto 12px' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {moreItems.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                  <button
                    key={item.path}
                    type="button"
                    className={`fo-nav-item${isActive ? ' is-active' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => { navigate(item.path); setMoreOpen(false); }}
                    style={{ padding: '12px 12px' }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
            <div style={{ padding: '8px 4px 0' }}>
              {signOutButton}
            </div>
          </div>
        </div>
      )}

      {/* ── CSS to show/hide sidebar vs bottom nav ── */}
      <style>{`
        .desktop-sidebar { display: flex !important; }
        .mobile-bottom-nav { display: none !important; }

        @media (max-width: 767px) {
          .desktop-sidebar { display: none !important; }
          .mobile-bottom-nav { display: flex !important; }
        }
      `}</style>
    </>
  );
}
