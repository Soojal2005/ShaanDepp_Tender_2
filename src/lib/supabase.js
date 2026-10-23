import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// The portal has its own server-side cookie sessions. This client is only for
// explicitly public Supabase data, such as the synthetic showcase records.
export const supabase = url && key
  ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  : null;

export async function getSampleTenders() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('tenders')
    .select('id,title,department,submission_deadline')
    .eq('provider_id', 'sample')
    .order('id', { ascending: false })
    .limit(3);
  if (error) throw error;
  return data ?? [];
}
