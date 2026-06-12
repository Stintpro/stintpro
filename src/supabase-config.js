// SUPABASE CONFIGURATION — valores públicos (safe to commit)
// Obtén estos valores en: Supabase Dashboard → Settings → API
// La anon key es pública por diseño — las políticas RLS protegen los datos
const SUPABASE_URL      = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';

window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'stintpro_auth' }
});
