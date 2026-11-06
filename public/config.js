/* Online accounts (optional). Fill these in from your Supabase project: Project Settings → API.
   Both values are public by design (they are in every copy of the app); your data is protected by the
   row-level security in supabase/schema.sql. Never put the service_role key here.
   You can also leave this empty and enter them in the app (Settings → Account). */
window.DUES_CONFIG = {
  supabaseUrl: '',        // https://xxxx.supabase.co
  supabaseAnonKey: '',    // the "anon" / "publishable" key
  redirectTo: ''          // where password-reset emails send people: https://your-site/reset.html (optional)
};
