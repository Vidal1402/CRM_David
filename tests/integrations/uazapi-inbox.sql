-- Executar em transação e SEMPRE terminar com ROLLBACK. Os triggers pg_net
-- só enviam após COMMIT; os contatos e mensagens de teste nunca persistem.
BEGIN;

DO $$
DECLARE
  v_first jsonb;
  v_duplicate jsonb;
  v_conv uuid;
  v_contact uuid;
  v_count integer;
BEGIN
  v_first := whatsapp_hub.ingest_uazapi_message('regression-atomic-1', '+550000000001', 'Teste transacional', 'Oi');
  v_conv := (v_first->>'conversation_id')::uuid;
  v_duplicate := whatsapp_hub.ingest_uazapi_message('regression-atomic-1', '+550000000001', 'Teste transacional', 'Oi');
  IF v_duplicate->>'deduped' <> 'true' OR v_duplicate->>'message_id' <> v_first->>'message_id' THEN
    RAISE EXCEPTION 'Retry duplicou mensagem';
  END IF;
  SELECT unread_count INTO v_count FROM whatsapp_hub.conversations WHERE id = v_conv;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Retry duplicou contador: %', v_count; END IF;

  UPDATE whatsapp_hub.conversations SET channel = 'whatsapp', status = 'human_active', ai_paused = true WHERE id = v_conv;
  PERFORM whatsapp_hub.ingest_uazapi_message('regression-atomic-2', '+550000000001', NULL, 'Segunda');
  IF NOT EXISTS (SELECT 1 FROM whatsapp_hub.conversations WHERE id = v_conv AND channel = 'uazapi' AND status = 'human_active' AND ai_paused AND unread_count = 2) THEN
    RAISE EXCEPTION 'Roteamento ou handoff incorreto';
  END IF;

  -- Um claim legado sem mensagem não pode impedir recuperação.
  INSERT INTO whatsapp_hub.webhook_events (zernio_event_id, event_type) VALUES ('uazapi:msg:regression-stale', 'message.received');
  PERFORM whatsapp_hub.ingest_uazapi_message('regression-stale', '+550000000001', NULL, 'Recuperada');
  IF NOT EXISTS (SELECT 1 FROM whatsapp_hub.messages WHERE zernio_message_id = 'uazapi:regression-stale') THEN
    RAISE EXCEPTION 'Claim legado bloqueou mensagem';
  END IF;

  -- Falha DEPOIS da criação de contato/conversa reverte tudo.
  BEGIN
    PERFORM whatsapp_hub.ingest_uazapi_message('regression-failure', '+550000000002', 'Teste rollback', 'Inválida', 'invalid-type');
    RAISE EXCEPTION 'Tipo inválido não falhou';
  EXCEPTION WHEN invalid_text_representation THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM whatsapp_hub.contacts WHERE phone = '+550000000002') OR
    EXISTS (SELECT 1 FROM whatsapp_hub.webhook_events WHERE zernio_event_id = 'uazapi:msg:regression-failure') THEN
    RAISE EXCEPTION 'Falha deixou dados ou claim parciais';
  END IF;
  PERFORM whatsapp_hub.ingest_uazapi_message('regression-failure', '+550000000002', 'Teste rollback', 'Reenvio válido');

  IF has_function_privilege('authenticated', 'whatsapp_hub.ingest_uazapi_message(text,text,text,text,text,text)', 'EXECUTE') OR
     has_function_privilege('anon', 'whatsapp_hub.ingest_uazapi_message(text,text,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'RPC não está restrita à service role';
  END IF;
END;
$$;

ROLLBACK;
