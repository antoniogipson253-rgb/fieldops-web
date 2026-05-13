import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

export function useIsAdmin() {
  return useQuery({
    queryKey: ['web-is-admin'],
    queryFn: async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return false;
        const { data, error } = await supabase
          .from('company_members')
          .select('role')
          .eq('user_id', user.id)
          .eq('role', 'admin')
          .maybeSingle();
        if (error) return false;
        return !!data;
      } catch { return false; }
    },
    staleTime: 1000 * 60 * 5,
    retry: 2,
  });
}

export function useIsProjectManager() {
  return useQuery({
    queryKey: ['web-is-project-manager'],
    queryFn: async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return false;
        const { data, error } = await supabase
          .from('company_members')
          .select('role')
          .eq('user_id', user.id)
          .maybeSingle();
        if (error) return false;
        return data?.role === 'admin' || data?.role === 'project_manager';
      } catch { return false; }
    },
    staleTime: 1000 * 60 * 5,
    retry: 2,
  });
}

export function useIsProjectOwner(projectId: string) {
  return useQuery({
    queryKey: ['web-is-project-owner', projectId],
    queryFn: async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !projectId) return false;
        const { data, error } = await supabase
          .from('project_members')
          .select('role')
          .eq('project_id', projectId)
          .eq('user_id', user.id)
          .eq('role', 'owner')
          .maybeSingle();
        if (error) return false;
        return !!data;
      } catch { return false; }
    },
    enabled: !!projectId,
    staleTime: 1000 * 60 * 5,
    retry: 2,
  });
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ['web-current-user'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    },
  });
}

export function useUserRole() {
  return useQuery({
    queryKey: ['web-user-role'],
    queryFn: async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return 'worker';
        const { data, error } = await supabase
          .from('company_members')
          .select('role')
          .eq('user_id', user.id)
          .maybeSingle();
        if (error) return 'worker';
        return data?.role ?? 'worker';
      } catch { return 'worker'; }
    },
    staleTime: 1000 * 60 * 5,
    retry: 2,
  });
}