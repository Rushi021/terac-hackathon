-- Supabase exposes the public schema through its Data API to anyone holding the
-- publishable key. Enabling RLS with no policies denies that access entirely;
-- the app's server-side Prisma connection (postgres role) bypasses RLS.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
