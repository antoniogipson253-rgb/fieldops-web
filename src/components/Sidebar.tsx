import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const navItems = [
  { path: '/', label: 'Dashboard', icon: '📊' },
  { path: '/projects', label: 'Projects', icon: '📋' },
  { path: '/tasks', label: 'Tasks', icon: '✅' },
  { path: '/calendar', label: 'Calendar', icon: '📅' },
  { path: '/team', label: 'Team', icon: '👥' },
  { path: '/reports', label: 'Reports', icon: '📝' },
  { path: '/files', label: 'Files', icon: '📁' },
  { path: '/profile', label: 'Profile', icon: '👤' },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div style={{
      width: 240,
      minHeight: '100vh',
      backgroundColor: '#0D1321',
      borderRight: '1px solid #1F2937',
      display: 'flex',
      flexDirection: 'column',
      padding: '24px 0',
      position: 'sticky',
      top: 0,
    }}>
      {/* Logo */}
      <div style={{
        paddingLeft: 24,
        paddingRight: 24,
        marginBottom: 32,
      }}>
        <div style={{
          fontSize: 20,
          fontWeight: 900,
          color: '#FFFFFF',
          letterSpacing: 4,
        }}>FIELDOPS</div>
        <div style={{
          fontSize: 11,
          color: '#F97316',
          fontWeight: 600,
          letterSpacing: 2,
          marginTop: 2,
        }}>PRO DASHBOARD</div>
      </div>

      {/* Nav Items */}
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
                gap: 12,
                width: '100%',
                padding: '12px 24px',
                backgroundColor: isActive ? '#F9731615' : 'transparent',
                borderLeft: isActive ? '3px solid #F97316' : '3px solid transparent',
                border: 'none',
                borderLeftStyle: 'solid',
                borderLeftWidth: 3,
                borderLeftColor: isActive ? '#F97316' : 'transparent',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 18 }}>{item.icon}</span>
              <span style={{
                fontSize: 14,
                fontWeight: isActive ? 700 : 500,
                color: isActive ? '#F97316' : '#9CA3AF',
              }}>
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Sign Out */}
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