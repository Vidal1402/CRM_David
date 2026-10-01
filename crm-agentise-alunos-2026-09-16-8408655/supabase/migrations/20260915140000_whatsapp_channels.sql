CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub;

CREATE TABLE whatsapp_hub.whatsapp_channels (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 provider text NOT NULL CHECK (provider IN ('zernio','uazapi')),
 external_id text NOT NULL,
 profile_id text,
 name text NOT NULL,
 phone text,
 connected boolean NOT NULL DEFAULT false,
 enabled boolean NOT NULL DEFAULT true,
 ai_enabled boolean NOT NULL DEFAULT false,
 ai_prompt text NOT NULL DEFAULT 'Você é um assistente comercial. Seja cordial, objetivo e responda em português. Não invente preços ou condições. Quando não souber, ofereça atendimento humano.',
 add_to_funnel boolean NOT NULL DEFAULT false,
 pipeline_id uuid REFERENCES whatsapp_hub.pipelines(id) ON DELETE SET NULL,
 assignment_mode text NOT NULL DEFAULT 'round_robin' CHECK (assignment_mode IN ('round_robin','fixed')),
 operator_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 last_operator_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 webhook_ready boolean NOT NULL DEFAULT false,
 synced_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider,external_id)
);
ALTER TABLE whatsapp_hub.whatsapp_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY channels_read ON whatsapp_hub.whatsapp_channels FOR SELECT TO authenticated USING (true);
-- Escrita somente pela API administrativa; nunca permite alterar segredos pelo PostgREST.
GRANT SELECT ON whatsapp_hub.whatsapp_channels TO authenticated;
GRANT ALL ON whatsapp_hub.whatsapp_channels TO service_role;

ALTER TABLE whatsapp_hub.conversations ADD COLUMN whatsapp_channel_id uuid REFERENCES whatsapp_hub.whatsapp_channels(id);
ALTER TABLE whatsapp_hub.conversations DROP CONSTRAINT IF EXISTS conversations_contact_id_key;
CREATE UNIQUE INDEX conversations_contact_number_unique ON whatsapp_hub.conversations(contact_id,whatsapp_channel_id) WHERE whatsapp_channel_id IS NOT NULL;
CREATE UNIQUE INDEX conversations_legacy_contact_unique ON whatsapp_hub.conversations(contact_id) WHERE whatsapp_channel_id IS NULL;
DROP TRIGGER IF EXISTS student_conversation_guard ON whatsapp_hub.conversations;

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
   CASE WHEN ch.ai_enabled THEN 'ai_active'::whatsapp_hub.conversation_status ELSE 'human_active'::whatsapp_hub.conversation_status END,
   NOT ch.ai_enabled,assigned,now(),p_external_conversation_id,now()) RETURNING id INTO vid;
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
  status=CASE WHEN status='closed' THEN CASE WHEN ch.ai_enabled THEN 'ai_active'::whatsapp_hub.conversation_status ELSE 'human_active'::whatsapp_hub.conversation_status END ELSE status END,
  ai_paused=CASE WHEN status='closed' THEN NOT ch.ai_enabled ELSE ai_paused END,closed_at=NULL WHERE id=vid;
 INSERT INTO whatsapp_hub.messages(conversation_id,direction,sender_type,content_type,content,media_url,zernio_message_id,is_private_note)
 VALUES(vid,'inbound','contact',p_content_type::whatsapp_hub.content_type,p_text,p_media_url,external_mid,false) RETURNING id INTO mid;
 RETURN jsonb_build_object('message_id',mid,'conversation_id',vid,'new_conversation',is_new);
END; $$;
REVOKE ALL ON FUNCTION whatsapp_hub.ingest_channel_message(uuid,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION whatsapp_hub.ingest_channel_message(uuid,text,text,text,text,text,text,text) TO service_role;

-- Agente opcional por número: confirma a transação antes do processamento assíncrono.
CREATE OR REPLACE FUNCTION whatsapp_hub.channel_ai_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO whatsapp_hub AS $$
BEGIN
 IF NEW.direction='inbound' AND NEW.sender_type='contact' AND NOT NEW.is_private_note
 AND EXISTS(SELECT 1 FROM whatsapp_hub.conversations c JOIN whatsapp_hub.whatsapp_channels ch ON ch.id=c.whatsapp_channel_id
 WHERE c.id=NEW.conversation_id AND ch.enabled AND ch.ai_enabled AND NOT c.ai_paused) THEN
  PERFORM whatsapp_hub._invoke_edge_with_body('process-ai-message',jsonb_build_object('message_id',NEW.id));
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER on_channel_ai AFTER INSERT ON whatsapp_hub.messages FOR EACH ROW EXECUTE FUNCTION whatsapp_hub.channel_ai_trigger();
SELECT cron.schedule('wh-sync-channels','* * * * *',$cron$SELECT whatsapp_hub._cron_invoke_edge('sync-whatsapp-channels')$cron$);

-- Uma única resposta automática por inbound, mesmo com retries do pg_net.
ALTER TABLE whatsapp_hub.messages ADD COLUMN ai_reply_to uuid REFERENCES whatsapp_hub.messages(id);
CREATE UNIQUE INDEX messages_ai_reply_unique ON whatsapp_hub.messages(ai_reply_to) WHERE ai_reply_to IS NOT NULL;

ALTER TABLE whatsapp_hub.templates ADD COLUMN whatsapp_channel_id uuid REFERENCES whatsapp_hub.whatsapp_channels(id);
