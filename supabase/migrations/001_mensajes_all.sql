-- ============================================================
-- MENSAJES ALL · migración 001  (PENDIENTE DE APROBACIÓN)
-- Solo agrega columnas/tablas/políticas. No borra ni modifica datos.
-- Es idempotente: se puede ejecutar más de una vez.
-- ============================================================

-- 1) Columnas nuevas ------------------------------------------------
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS auto_reply_sent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS order_data jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS sent_by text;   -- 'automatic' | 'agent' | NULL (entrantes)

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS address text;

-- 2) Evitar duplicados a nivel de base de datos ----------------------
-- (requiere que no existan whatsapp_message_id repetidos)
CREATE UNIQUE INDEX IF NOT EXISTS messages_whatsapp_message_id_key
  ON public.messages (whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

-- 3) Respuestas rápidas ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.quick_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.quick_replies (title, body)
SELECT 'DESMANCHADOR FUCSIA',
       'hola!! espero que estés bien , el desmanchador fucsia vale $80.000 el galón y $ 40.000 el litro, el valor del envió es de $14.000 si es pago anticipado y si es contra entrega valdría $19.000. ( para algunas ciudades el precio de envió cambia) normalmente llega en 4 o 5 días hábiles a tu dirección también esto depende de tu ubicación. si deseas hacer el pedido me das nombre completo, dirección, ciudad, teléfono, cantidad del producto (litro o galón) y si es pago contra entrega o anticipado.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.quick_replies WHERE title = 'DESMANCHADOR FUCSIA'
);

-- 4) RLS: solo usuarios autenticados (sin acceso anónimo) ------------
-- El webhook y /api/send-message usan la SECRET key, que ignora RLS.
ALTER TABLE public.contacts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quick_replies ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- contacts: leer y editar datos del cliente
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='contacts' AND policyname='agents_select_contacts') THEN
    CREATE POLICY agents_select_contacts ON public.contacts
      FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='contacts' AND policyname='agents_update_contacts') THEN
    CREATE POLICY agents_update_contacts ON public.contacts
      FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;

  -- conversations: leer y editar estado / no leídos / datos del pedido
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='conversations' AND policyname='agents_select_conversations') THEN
    CREATE POLICY agents_select_conversations ON public.conversations
      FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='conversations' AND policyname='agents_update_conversations') THEN
    CREATE POLICY agents_update_conversations ON public.conversations
      FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;

  -- messages: solo lectura (los envíos pasan por el servidor)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='messages' AND policyname='agents_select_messages') THEN
    CREATE POLICY agents_select_messages ON public.messages
      FOR SELECT TO authenticated USING (true);
  END IF;

  -- quick_replies: lectura y gestión
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='quick_replies' AND policyname='agents_all_quick_replies') THEN
    CREATE POLICY agents_all_quick_replies ON public.quick_replies
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 5) Tiempo real -----------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='conversations') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='contacts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.contacts;
  END IF;
END $$;
