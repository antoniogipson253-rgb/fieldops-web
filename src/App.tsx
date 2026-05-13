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

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: '#0A0F1E' }}>
      <Sidebar />
      <main style={{ flex: 1, overflowY: 'auto' }}>
        {children}
      </main>
    </div>
  );
}

function AuthGuard({ session, children }: { session: Session | null; children: React.ReactNode }) {
  if (!session) return <Navigate to="/login" replace />;
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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      queryClient.clear();
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        minHeight: '100vh', backgroundColor: '#0A0F1E',
        color: '#F97316', fontSize: 24, fontWeight: 'bold', letterSpacing: 4,
      }}>
        FIELDOPS
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={session ? <Navigate to="/" replace /> : <LoginPage />} />
          <Route path="/" element={<AuthGuard session={session}><AppLayout><DashboardPage /></AppLayout></AuthGuard>} />
          <Route path="/projects" element={<AuthGuard session={session}><AppLayout><ProjectsPage /></AppLayout></AuthGuard>} />
          <Route path="/projects/:id" element={<AuthGuard session={session}><AppLayout><ProjectDetailPage /></AppLayout></AuthGuard>} />
          <Route path="/projects/:id/chat" element={<AuthGuard session={session}><AppLayout><ChatPage /></AppLayout></AuthGuard>} />
          <Route path="/tasks" element={<AuthGuard session={session}><AppLayout><TasksPage /></AppLayout></AuthGuard>} />
          <Route path="/calendar" element={<AuthGuard session={session}><AppLayout><CalendarPage /></AppLayout></AuthGuard>} />
          <Route path="/team" element={<AuthGuard session={session}><AppLayout><TeamPage /></AppLayout></AuthGuard>} />
          <Route path="/reports" element={<AuthGuard session={session}><AppLayout><ReportsPage /></AppLayout></AuthGuard>} />
          <Route path="/files" element={<AuthGuard session={session}><AppLayout><FilesPage /></AppLayout></AuthGuard>} />
          <Route path="/profile" element={<AuthGuard session={session}><AppLayout><ProfilePage /></AppLayout></AuthGuard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}