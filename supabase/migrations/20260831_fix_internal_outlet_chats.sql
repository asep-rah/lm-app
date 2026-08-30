-- Fix missing public.internal_outlet_chats (schema cache).
-- sender_id is UUID without FK to public.profiles — that table is not in this project.

CREATE TABLE IF NOT EXISTS public.internal_outlet_chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    outlet_id UUID REFERENCES public.outlets(id) ON DELETE CASCADE,
    sender_id UUID,
    sender_name TEXT NOT NULL,
    sender_role TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.internal_outlet_chats ADD COLUMN IF NOT EXISTS sender_id UUID;
ALTER TABLE public.internal_outlet_chats ADD COLUMN IF NOT EXISTS sender_name TEXT;
ALTER TABLE public.internal_outlet_chats ADD COLUMN IF NOT EXISTS sender_role TEXT;
ALTER TABLE public.internal_outlet_chats ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.internal_outlet_chats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all authenticated users chat policy" ON public.internal_outlet_chats;
CREATE POLICY "Allow all authenticated users chat policy"
ON public.internal_outlet_chats FOR ALL
USING (auth.role() = 'authenticated' OR auth.role() = 'anon')
WITH CHECK (auth.role() = 'authenticated' OR auth.role() = 'anon');

GRANT ALL ON public.internal_outlet_chats TO anon, authenticated;

ALTER TABLE public.internal_outlet_chats REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.internal_outlet_chats;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;
