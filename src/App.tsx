import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { Session } from '@supabase/supabase-js';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import TasksPage from './pages/TasksPage';
import TeamPage from './pages/TeamPage';
import ReportsPage from './pages/ReportsPage';
import FilesPage from './pages/FilesPage';
import ChatPage from './pages/ChatPage';
import ProfilePage from './pages/ProfilePage';
import CalendarPage from './pages/CalendarPage';
import Sidebar from './components/Sidebar';
import PayrollPage from './pages/PayrollPage';
import PunchListPage from './pages/PunchListPage';
import IncidentsPage from './pages/IncidentsPage';
import AcceptInvitePage from './pages/AcceptInvitePage';
import ClientPortalPage from './pages/ClientPortalPage';
import ClientLoginPage from './pages/ClientLoginPage';
import SetPasswordPage from './pages/SetPasswordPage';
import TimesheetPage from './pages/TimesheetPage';
import DailyReportsPage from './pages/DailyReportsPage';

const PLANS = [
  {
    id: 'field',
    name: 'Field Plan',
    price: '$2,500/year',
    employees: '1-10 employees',
    priceId: 'price_1TXScSDmd1wcZvf6j7URtxhK',
    popular: false,
    features: ['Full platform access', 'Task management', 'Clock in/out with GPS', 'Scheduling', 'Photo uploads', 'Reports', '1TB storage'],
  },
  {
    id: 'crew',
    name: 'Crew Plan',
    price: '$6,000/year',
    employees: '11-40 employees',
    priceId: 'price_1TXSeADmd1wcZvf6GteMGf9L',
    popular: true,
    features: ['Everything in Field Plan', 'Advanced reporting', 'Role permissions', 'Multi-project dashboard', 'Priority support', 'Client portal access', '2TB storage'],
  },
  {
    id: 'project',
    name: 'Project Plan',
    price: '$12,000/year',
    employees: '41-120 employees',
    priceId: 'price_1TXSfGDmd1wcZvf6Bv74UzZ8',
    popular: false,
    features: ['Everything in Crew Plan', 'Advanced workforce analytics', 'Multi-job oversight tools', 'Custom onboarding', 'Dedicated support priority', '2TB storage'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise Plan',
    price: 'Custom Pricing',
    employees: '120+ employees',
    priceId: null,
    popular: false,
    features: ['Custom workflows', 'Integration support', 'Dedicated onboarding', 'Enterprise deployment support'],
  },
];

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 1000 * 60 * 5,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: true,
    },
  },
});

function TrialGuard({ children }: { children: React.ReactNode }) {
  const [trialExpired, setTrialExpired] = useState(false);
  const [trialDaysLeft, setTrialDaysLeft] = useState<number | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  useEffect(() => {
    async function checkTrial() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from('profiles')
        .select('trial_end, is_subscribed, role')
        .eq('id', user.id)
        .single();
      if (error || !data) return;
      if (data.is_subscribed === true) return;
      if (data.role === 'client') return;
      const now = new Date();
      const trialEnd = new Date(data.trial_end);
      const daysLeft = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysLeft <= 0) {
        setTrialExpired(true);
      } else {
        setTrialDaysLeft(daysLeft);
      }
    }
    checkTrial();
  }, []);

  async function handleUpgrade(priceId: string | null, planId: string) {
    if (!priceId) {
      window.location.href = 'mailto:fieldops.pro1@gmail.com?subject=Enterprise Plan Inquiry';
      return;
    }
    setCheckoutLoading(planId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/create-checkout`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
          body: JSON.stringify({ priceId }),
        }
      );
      const { url } = await response.json();
      if (url) window.location.href = url;
    } catch (e) {
      alert('Something went wrong. Please try again.');
    } finally {
      setCheckoutLoading(null);
    }
  }

  if (trialExpired) {
    return (
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#0D1117', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '48px 24px', zIndex: 9999, overflowY: 'auto' }}>
        <div style={{ width: '100%', maxWidth: 1100 }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#F97316', letterSpacing: 4, marginBottom: 16, textTransform: 'uppercase' as const }}>FieldOps Pro</div>
            <h1 style={{ fontSize: 42, fontWeight: 900, color: '#FFFFFF', margin: '0 0 12px 0', letterSpacing: 1, textTransform: 'uppercase' as const }}>Simple, Transparent Pricing</h1>
            <p style={{ color: '#6B7280', fontSize: 16, margin: 0 }}>Your free trial has ended. Choose the plan that fits your business. Cancel anytime.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginBottom: 32 }}>
            {PLANS.map((plan) => (
              <div key={plan.id} style={{ backgroundColor: '#111827', borderRadius: 8, padding: '32px 28px', border: plan.popular ? '2px solid #F97316' : '1px solid #1F2937', position: 'relative', display: 'flex', flexDirection: 'column' }}>
                {plan.popular && (
                  <div style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', backgroundColor: '#F97316', color: '#FFFFFF', fontSize: 11, fontWeight: 800, padding: '4px 16px', borderRadius: 20, letterSpacing: 2, whiteSpace: 'nowrap' as const }}>
                    MOST POPULAR
                  </div>
                )}
                <div style={{ fontSize: 16, fontWeight: 900, color: '#FFFFFF', marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' as const }}>{plan.name}</div>
                <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 24 }}>{plan.employees}</div>
                <div style={{ marginBottom: 28 }}>
                  {plan.priceId ? (
                    <>
                      <span style={{ fontSize: 40, fontWeight: 900, color: '#FFFFFF' }}>{plan.price.split('/')[0]}</span>
                      <span style={{ fontSize: 15, color: '#6B7280', marginLeft: 4 }}>/year</span>
                    </>
                  ) : (
                    <span style={{ fontSize: 32, fontWeight: 900, color: '#FFFFFF' }}>CUSTOM</span>
                  )}
                </div>
                <div style={{ flex: 1, marginBottom: 28 }}>
                  {plan.features.map((f) => (
                    <div key={f} style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 10, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <div style={{ width: 18, height: 18, borderRadius: 9, border: '1.5px solid #F97316', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                        <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#F97316' }} />
                      </div>
                      {f}
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => handleUpgrade(plan.priceId, plan.id)}
                  disabled={checkoutLoading === plan.id}
                  style={{ width: '100%', padding: '14px', backgroundColor: plan.popular ? '#F97316' : 'transparent', border: `1px solid ${plan.popular ? '#F97316' : '#374151'}`, borderRadius: 6, color: '#FFFFFF', fontSize: 13, fontWeight: 800, letterSpacing: 2, cursor: checkoutLoading === plan.id ? 'not-allowed' : 'pointer', opacity: checkoutLoading === plan.id ? 0.7 : 1, textTransform: 'uppercase' as const }}
                >
                  {checkoutLoading === plan.id ? 'Loading...' : plan.priceId ? 'Choose Plan' : 'Contact Sales'}
                </button>
              </div>
            ))}
          </div>
          <p style={{ textAlign: 'center', color: '#374151', fontSize: 13 }}>* Onboarding is included with every plan.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {trialDaysLeft !== null && trialDaysLeft <= 7 && (
        <div style={{ backgroundColor: '#F9731620', border: '1px solid #F97316', borderRadius: 0, padding: '10px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 100 }}>
          <span style={{ color: '#F97316', fontSize: 13, fontWeight: 700 }}>
            Your free trial expires in {trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''}
          </span>
          <a href="mailto:fieldops.pro1@gmail.com?subject=FieldOps Upgrade" style={{ color: '#F97316', fontSize: 12, fontWeight: 700, textDecoration: 'underline' }}>
            Upgrade Now
          </a>
        </div>
      )}
      {children}
    </>
  );
}

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: '#0A0F1E' }}>
      <Sidebar />
      <main style={{ flex: 1, overflowY: 'auto', paddingBottom: 'env(safe-area-inset-bottom)' }}
        className="app-main">
        <TrialGuard>
          {children}
        </TrialGuard>
      </main>
      <style>{`
        @media (max-width: 767px) {
          .app-main { padding-bottom: calc(64px + env(safe-area-inset-bottom)) !important; }
        }
      `}</style>
    </div>
  );
}


function ClientGuard({ session, children }: { session: Session | null; children: React.ReactNode }) {
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkRole() {
      if (!session) { setLoading(false); return; }
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single();
      setRole(data?.role ?? null);
      setLoading(false);
    }
    checkRole();
  }, [session]);

  if (!session) return <Navigate to="/login" replace />;
  if (loading) return null;
  if (role === 'client') return <Navigate to="/client-portal" replace />;
  return <>{children}</>;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      queryClient.clear();
      if (event === 'PASSWORD_RECOVERY') {
        window.location.href = '/set-password';
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#0A0F1E', color: '#F97316', fontSize: 24, fontWeight: 'bold', letterSpacing: 4 }}>
        FIELDOPS
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={session ? <Navigate to="/" replace /> : <LoginPage />} />
          <Route path="/client-login" element={session ? <Navigate to="/client-portal" replace /> : <ClientLoginPage />} />
          <Route path="/set-password" element={<SetPasswordPage />} />
          <Route path="/accept-invite" element={<AcceptInvitePage />} />
          <Route path="/client-portal" element={session ? <ClientPortalPage /> : <Navigate to="/client-login" replace />} />
          <Route path="/" element={<ClientGuard session={session}><AppLayout><DashboardPage /></AppLayout></ClientGuard>} />
          <Route path="/projects" element={<ClientGuard session={session}><AppLayout><ProjectsPage /></AppLayout></ClientGuard>} />
          <Route path="/projects/:id" element={<ClientGuard session={session}><AppLayout><ProjectDetailPage /></AppLayout></ClientGuard>} />
          <Route path="/projects/:id/chat" element={<ClientGuard session={session}><AppLayout><ChatPage /></AppLayout></ClientGuard>} />
          <Route path="/projects/:id/daily-reports" element={<ClientGuard session={session}><AppLayout><DailyReportsPage /></AppLayout></ClientGuard>} />
          <Route path="/tasks" element={<ClientGuard session={session}><AppLayout><TasksPage /></AppLayout></ClientGuard>} />
          <Route path="/calendar" element={<ClientGuard session={session}><AppLayout><CalendarPage /></AppLayout></ClientGuard>} />
          <Route path="/team" element={<ClientGuard session={session}><AppLayout><TeamPage /></AppLayout></ClientGuard>} />
          <Route path="/reports" element={<ClientGuard session={session}><AppLayout><ReportsPage /></AppLayout></ClientGuard>} />
          <Route path="/files" element={<ClientGuard session={session}><AppLayout><FilesPage /></AppLayout></ClientGuard>} />
          <Route path="/payroll" element={<ClientGuard session={session}><AppLayout><PayrollPage /></AppLayout></ClientGuard>} />
          <Route path="/profile" element={<ClientGuard session={session}><AppLayout><ProfilePage /></AppLayout></ClientGuard>} />
          <Route path="/punch-list" element={<ClientGuard session={session}><AppLayout><PunchListPage /></AppLayout></ClientGuard>} />
          <Route path="/incidents" element={<ClientGuard session={session}><AppLayout><IncidentsPage /></AppLayout></ClientGuard>} />
          <Route path="/timesheet" element={<ClientGuard session={session}><AppLayout><TimesheetPage /></AppLayout></ClientGuard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}