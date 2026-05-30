import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useIsAdmin, useUserRole } from '../lib/useIsAdmin';

const BOTTOM_NAV_PATHS = ['/', '/projects', '/tasks', '/team', '/profile'];

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: isAdmin } = useIsAdmin();
  const { data: userRole } = useUserRole();
  const isPM = userRole === 'project_manager';
  const [moreOpen, setMoreOpen] = useState(false);

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
    { path: '/profile', label: 'Profile', show: true },
    { path: '/incidents', label: 'Incidents', show: !!isAdmin },
  ];

  const navItems = allNavItems.filter((item) => item.show);
  const bottomItems = navItems.filter((item) => BOTTOM_NAV_PATHS.includes(item.path));
  const moreItems = navItems.filter((item) => !BOTTOM_NAV_PATHS.includes(item.path));

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  return (
    <>
      {/* ── DESKTOP SIDEBAR ── */}
      <div style={{
        width: 220,
        minHeight: '100vh',
        backgroundColor: '#0D1321',
        borderRight: '1px solid #1F2937',
        display: 'flex',
        flexDirection: 'column',
        padding: '24px 0',
        position: 'sticky',
        top: 0,
        // Hide on mobile via inline media-query workaround — we use a style tag below
      }} className="desktop-sidebar">
        <div style={{ paddingLeft: 24, paddingRight: 24, marginBottom: 32 }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#FFFFFF', letterSpacing: 4 }}>FIELDOPS</div>
          <div style={{ fontSize: 11, color: '#F97316', fontWeight: 600, letterSpacing: 2, marginTop: 2 }}>PRO DASHBOARD</div>
        </div>

        <nav style={{ flex: 1 }}>
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  width: '100%',
                  padding: '12px 24px',
                  backgroundColor: isActive ? '#F9731615' : 'transparent',
                  border: 'none',
                  borderLeftStyle: 'solid',
                  borderLeftWidth: 3,
                  borderLeftColor: isActive ? '#F97316' : 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{
                  fontSize: 14,
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? '#F97316' : '#9CA3AF',
                  letterSpacing: 1,
                }}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>

        <div style={{ padding: '0 16px' }}>
          <button
            onClick={() => supabase.auth.signOut()}
            style={{
              width: '100%',
              padding: '12px 16px',
              backgroundColor: 'transparent',
              border: '1px solid #374151',
              borderRadius: 8,
              color: '#6B7280',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* ── MOBILE BOTTOM TAB BAR ── */}
      <div className="mobile-bottom-nav" style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 64,
        backgroundColor: '#0D1321',
        borderTop: '1px solid #1F2937',
        display: 'flex',
        alignItems: 'stretch',
        zIndex: 1000,
      }}>
        {bottomItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'transparent',
                border: 'none',
                borderTop: `2px solid ${isActive ? '#F97316' : 'transparent'}`,
                cursor: 'pointer',
                gap: 4,
              }}
            >
              <span style={{
                fontSize: 11,
                fontWeight: isActive ? 700 : 500,
                color: isActive ? '#F97316' : '#6B7280',
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
            <span style={{ fontSize: 18, color: '#6B7280', lineHeight: 1 }}>•••</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: '#6B7280', letterSpacing: 0.5 }}>More</span>
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
              backgroundColor: '#0D1321',
              borderTop: '1px solid #1F2937',
              borderRadius: '16px 16px 0 0',
              padding: '12px 0 8px',
            }}
          >
            <div style={{ width: 40, height: 4, backgroundColor: '#374151', borderRadius: 2, margin: '0 auto 16px' }} />
            {moreItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <button
                  key={item.path}
                  onClick={() => { navigate(item.path); setMoreOpen(false); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    width: '100%',
                    padding: '14px 24px',
                    backgroundColor: isActive ? '#F9731615' : 'transparent',
                    border: 'none',
                    borderLeft: `3px solid ${isActive ? '#F97316' : 'transparent'}`,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span style={{
                    fontSize: 15,
                    fontWeight: isActive ? 700 : 500,
                    color: isActive ? '#F97316' : '#9CA3AF',
                    letterSpacing: 1,
                  }}>
                    {item.label}
                  </span>
                </button>
              );
            })}
            <div style={{ padding: '8px 16px 0' }}>
              <button
                onClick={() => supabase.auth.signOut()}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  backgroundColor: 'transparent',
                  border: '1px solid #374151',
                  borderRadius: 8,
                  color: '#6B7280',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Sign Out
              </button>
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