-- PUBLIVRA AI: DELETE EVERY TABLE in the public schema (all data is lost; it cannot be undone).
-- Use only to start from scratch. Run 001_schema.sql right after it.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
  END LOOP;
END $$;
