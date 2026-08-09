import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  'https://zddythsszyznsguiuiss.supabase.co';

const supabaseKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_yHALwh67VW1COYUdpTIj2A_cFzxGYWT';

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    'Supabase Client Warning: VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables are missing. Utilizing fallback configuration.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export default supabase;
