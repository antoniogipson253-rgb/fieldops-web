import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useIsAdmin, useUserRole } from '../lib/useIsAdmin';

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: isAdmin } = useIsAdmin();
  const { data: userRole } = useUserRole();
  const isPM = userRole === 'project_manager';

  const allNavItems = [
    { path: '/', label: 'Dashboard', show: true },
    { path: '/projects', label: 'Projects', show: true },
    { path: '/tasks', label: 'Tasks', show: true },
    { path: '/calendar', label: 'Calendar', show: true },
    { path: '/team', label: 'Team', show: true },
    { path: '/reports', label: 'Reports', show: true },
    { path: '/punch-list', label: 'Punch List', show: !!(isAdmin || isPM) },
    { path: '/payroll', label: 'Payroll', show: !!isAdmin },
    { path: '/files', label: 'Files', show: true },
    { path: '/profile', label: 'Profile', show: true },
  ];

  const navItems = allNavItems.filter((item) => item.show);

  return (
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
    }}>
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
  );
}