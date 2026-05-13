import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://dpmlpqenanyoxfupferv.supabase.co';
const supabaseAnonKey = 'sb_publishable_l3UkvSdVE5ZjJrLJYoaLHQ_e17x5xQg';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});