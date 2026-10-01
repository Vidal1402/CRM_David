CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub;

-- Edição para alunos: atendimento humano, sem agente, follow-ups ou recompra.
-- Preserva tabelas históricas para não apagar dados em uma atualização.
DROP TRIGGER IF EXISTS on_inbound_message ON whatsapp_hub.messages;
ALTER TABLE whatsapp_hub.conversations ALTER COLUMN status SET DEFAULT 'human_active';
ALTER TABLE whatsapp_hub.conversations ALTER COLUMN ai_paused SET DEFAULT true;
UPDATE whatsapp_hub.ai_agent_config SET is_active = false;
UPDATE whatsapp_hub.follow_up_rules SET is_active = false;
UPDATE whatsapp_hub.repurchase_config SET auto_send = false;

CREATE OR REPLACE FUNCTION whatsapp_hub.student_conversation_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO whatsapp_hub AS $$
BEGIN
  IF NEW.channel NOT IN ('whatsapp', 'uazapi') THEN
    RAISE EXCEPTION 'Canal não disponível nesta edição';
  END IF;
  NEW.ai_paused := true;
  IF NEW.status = 'ai_active' THEN NEW.status := 'human_active'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS student_conversation_guard ON whatsapp_hub.conversations;
CREATE TRIGGER student_conversation_guard BEFORE INSERT OR UPDATE ON whatsapp_hub.conversations
FOR EACH ROW EXECUTE FUNCTION whatsapp_hub.student_conversation_guard();

DO $$
DECLARE job_name text;
BEGIN
  FOREACH job_name IN ARRAY ARRAY['wh-check-follow-ups', 'repurchase-dispatch-daily', 'repurchase-predictions-daily'] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = job_name) THEN
      PERFORM cron.unschedule(job_name);
    END IF;
  END LOOP;
END;
$$;
