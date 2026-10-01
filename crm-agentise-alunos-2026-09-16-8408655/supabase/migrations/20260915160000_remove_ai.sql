CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub;

DROP TRIGGER IF EXISTS on_channel_ai ON whatsapp_hub.messages;
DROP TRIGGER IF EXISTS on_inbound_message ON whatsapp_hub.messages;
DROP TRIGGER IF EXISTS on_audio_inbound ON whatsapp_hub.messages;
DROP FUNCTION IF EXISTS whatsapp_hub.channel_ai_trigger();
DROP FUNCTION IF EXISTS whatsapp_hub._on_audio_inbound();
UPDATE whatsapp_hub.whatsapp_channels SET ai_enabled=false;
UPDATE whatsapp_hub.ai_agent_config SET is_active=false;
UPDATE whatsapp_hub.conversations SET status='human_active' WHERE status='ai_active';
UPDATE whatsapp_hub.conversations SET ai_paused=true WHERE NOT ai_paused;
ALTER TABLE whatsapp_hub.conversations ALTER COLUMN status SET DEFAULT 'human_active';
ALTER TABLE whatsapp_hub.conversations ALTER COLUMN ai_paused SET DEFAULT true;
-- Impede clientes antigos de reativar o agente. Histórico permanece disponível.
CREATE OR REPLACE FUNCTION whatsapp_hub.student_conversation_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO whatsapp_hub AS $$
BEGIN
 IF NEW.channel NOT IN ('whatsapp','uazapi') THEN RAISE EXCEPTION 'Canal indisponível'; END IF;
 NEW.ai_paused := true;
 IF NEW.status='ai_active' THEN NEW.status := 'human_active'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER student_conversation_guard BEFORE INSERT OR UPDATE ON whatsapp_hub.conversations
FOR EACH ROW EXECUTE FUNCTION whatsapp_hub.student_conversation_guard();
ALTER TABLE whatsapp_hub.whatsapp_channels ADD CONSTRAINT channels_ai_disabled CHECK (ai_enabled=false);

CREATE OR REPLACE FUNCTION whatsapp_hub.ingest_channel_message(
 p_channel_id uuid, p_message_id text, p_phone text, p_name text,
 p_text text, p_content_type text DEFAULT 'text', p_media_url text DEFAULT NULL,
 p_external_conversation_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO whatsapp_hub AS $$
DECLARE
 ch whatsapp_hub.whatsapp_channels%ROWTYPE;
 cid uuid; vid uuid; mid uuid; did uuid; sid uuid; assigned uuid;
 external_mid text; is_new boolean := false;
BEGIN
 SELECT * INTO ch FROM whatsapp_hub.whatsapp_channels WHERE id=p_channel_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Número não cadastrado'; END IF;
 IF NOT ch.enabled THEN RETURN jsonb_build_object('skipped','disabled'); END IF;
 IF p_phone IS NULL OR p_phone !~ '^\+[0-9]{6,15}$' OR NULLIF(p_message_id,'') IS NULL THEN RAISE EXCEPTION 'Mensagem inválida'; END IF;
 external_mid := CASE WHEN ch.provider='uazapi' THEN 'uazapi:'||ch.id||':'||p_message_id ELSE p_message_id END;
 SELECT id,conversation_id INTO mid,vid FROM whatsapp_hub.messages WHERE zernio_message_id=external_mid;
 IF FOUND THEN RETURN jsonb_build_object('deduped',true,'message_id',mid,'conversation_id',vid); END IF;
 INSERT INTO whatsapp_hub.contacts(phone,name,source) VALUES(p_phone,p_name,'whatsapp')
 ON CONFLICT(phone) DO UPDATE SET name=COALESCE(whatsapp_hub.contacts.name,EXCLUDED.name) RETURNING id INTO cid;
 SELECT id,assigned_to INTO vid,assigned FROM whatsapp_hub.conversations WHERE contact_id=cid AND whatsapp_channel_id=ch.id;
 IF vid IS NULL THEN
  is_new := true;
  IF ch.assignment_mode='fixed' THEN assigned := ch.operator_id;
  ELSE
   SELECT user_id INTO assigned FROM whatsapp_hub.app_users WHERE accepted_at IS NOT NULL
    AND (ch.last_operator_id IS NULL OR user_id>ch.last_operator_id) ORDER BY user_id LIMIT 1;
   IF assigned IS NULL THEN SELECT user_id INTO assigned FROM whatsapp_hub.app_users WHERE accepted_at IS NOT NULL ORDER BY user_id LIMIT 1; END IF;
   UPDATE whatsapp_hub.whatsapp_channels SET last_operator_id=assigned WHERE id=ch.id;
  END IF;
  INSERT INTO whatsapp_hub.conversations(contact_id,whatsapp_channel_id,channel,status,ai_paused,assigned_to,assigned_at,zernio_conversation_id,last_message_at)
  VALUES(cid,ch.id,CASE WHEN ch.provider='uazapi' THEN 'uazapi' ELSE 'whatsapp' END,
   'human_active'::whatsapp_hub.conversation_status,
   true,assigned,now(),p_external_conversation_id,now()) RETURNING id INTO vid;
 END IF;
 IF ch.add_to_funnel AND ch.pipeline_id IS NOT NULL THEN
  SELECT id INTO did FROM whatsapp_hub.deals WHERE contact_id=cid AND pipeline_id=ch.pipeline_id AND status='open' ORDER BY created_at DESC LIMIT 1;
  IF did IS NULL THEN
   SELECT id INTO sid FROM whatsapp_hub.stages WHERE pipeline_id=ch.pipeline_id AND NOT is_won AND NOT is_lost ORDER BY position LIMIT 1;
   IF sid IS NOT NULL THEN
    INSERT INTO whatsapp_hub.deals(contact_id,pipeline_id,stage_id,title,status,owner_id,lead_type,temperature,traffic_type,origin_channel,first_contact_at)
    VALUES(cid,ch.pipeline_id,sid,COALESCE(p_name,p_phone),'open',assigned,'Lead','Morno','organico','whatsapp',now()) RETURNING id INTO did;
   END IF;
  END IF;
 END IF;
 UPDATE whatsapp_hub.conversations SET last_message_at=now(),unread_count=unread_count+1,
  zernio_conversation_id=COALESCE(p_external_conversation_id,zernio_conversation_id),
  active_deal_id=COALESCE(active_deal_id,did),
  status=CASE WHEN status='closed' THEN 'human_active'::whatsapp_hub.conversation_status ELSE status END,
  ai_paused=CASE WHEN status='closed' THEN true ELSE ai_paused END,closed_at=NULL WHERE id=vid;
 INSERT INTO whatsapp_hub.messages(conversation_id,direction,sender_type,content_type,content,media_url,zernio_message_id,is_private_note)
 VALUES(vid,'inbound','contact',p_content_type::whatsapp_hub.content_type,p_text,p_media_url,external_mid,false) RETURNING id INTO mid;
 RETURN jsonb_build_object('message_id',mid,'conversation_id',vid,'new_conversation',is_new);
END; $$;
REVOKE ALL ON FUNCTION whatsapp_hub.ingest_channel_message(uuid,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION whatsapp_hub.ingest_channel_message(uuid,text,text,text,text,text,text,text) TO service_role;

