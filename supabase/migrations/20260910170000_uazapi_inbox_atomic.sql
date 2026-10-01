CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub;

ALTER TABLE whatsapp_hub.messages ADD COLUMN IF NOT EXISTS delivery_error text;

-- Recebimento, atribuição e deduplicação devem confirmar juntos. O claim
-- anterior em webhook_events podia sobreviver a uma falha e descartar retries.
CREATE OR REPLACE FUNCTION whatsapp_hub.ingest_uazapi_message(
  p_message_id text,
  p_phone text,
  p_name text,
  p_text text,
  p_content_type text DEFAULT 'text',
  p_media_url text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO whatsapp_hub
AS $$
DECLARE
  v_contact_id uuid;
  v_conversation_id uuid;
  v_message_id uuid;
  v_attribution jsonb;
BEGIN
  IF NULLIF(btrim(p_message_id), '') IS NULL OR p_phone !~ '^\+[0-9]{6,15}$' OR p_phone IS NULL THEN
    RAISE EXCEPTION 'Mensagem Uazapi sem ID ou telefone válido';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('uazapi:msg:' || p_message_id, 0));

  SELECT id, conversation_id INTO v_message_id, v_conversation_id
    FROM whatsapp_hub.messages WHERE zernio_message_id = 'uazapi:' || p_message_id;
  IF FOUND THEN
    RETURN jsonb_build_object('deduped', true, 'message_id', v_message_id, 'conversation_id', v_conversation_id);
  END IF;

  INSERT INTO whatsapp_hub.contacts (phone, name, source)
    VALUES (p_phone, p_name, 'whatsapp')
    ON CONFLICT (phone) DO UPDATE
      SET name = COALESCE(whatsapp_hub.contacts.name, EXCLUDED.name)
    RETURNING id INTO v_contact_id;

  INSERT INTO whatsapp_hub.conversations (contact_id, channel, status, last_message_at)
    VALUES (v_contact_id, 'uazapi', 'ai_active', now())
    ON CONFLICT (contact_id) DO UPDATE SET
      channel = 'uazapi',
      last_message_at = now(),
      status = CASE WHEN whatsapp_hub.conversations.status = 'closed'
        THEN 'ai_active'::whatsapp_hub.conversation_status ELSE whatsapp_hub.conversations.status END,
      closed_at = NULL
    RETURNING id INTO v_conversation_id;

  v_attribution := whatsapp_hub.attribute_inbound_lead(v_contact_id, COALESCE(p_text, ''), NULL, 'uazapi');

  INSERT INTO whatsapp_hub.messages (
    conversation_id, direction, sender_type, content_type, content,
    media_url, zernio_message_id, is_private_note
  ) VALUES (
    v_conversation_id, 'inbound', 'contact', p_content_type::whatsapp_hub.content_type,
    p_text, p_media_url, 'uazapi:' || p_message_id, false
  ) RETURNING id INTO v_message_id;

  UPDATE whatsapp_hub.conversations SET unread_count = unread_count + 1 WHERE id = v_conversation_id;
  INSERT INTO whatsapp_hub.webhook_events (zernio_event_id, event_type)
    VALUES ('uazapi:msg:' || p_message_id, 'message.received')
    ON CONFLICT (zernio_event_id) DO UPDATE SET processed_at = now();

  RETURN jsonb_build_object('deduped', false, 'message_id', v_message_id,
    'conversation_id', v_conversation_id, 'attribution', v_attribution);
END;
$$;

REVOKE ALL ON FUNCTION whatsapp_hub.ingest_uazapi_message(text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION whatsapp_hub.ingest_uazapi_message(text, text, text, text, text, text) TO service_role;

-- Anexos do inbox são privados; o frontend assina a URL após autenticação.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('whatsapp-hub-inbox-media', 'whatsapp-hub-inbox-media', false, 26214400)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS wh_inbox_media_read ON storage.objects;
CREATE POLICY wh_inbox_media_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'whatsapp-hub-inbox-media'
  AND whatsapp_hub.current_user_role() IN ('admin', 'operator'));
