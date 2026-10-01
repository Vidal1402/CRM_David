-- ============================================================================
-- Integração Canal Pro (Grupo OLX / ZAP Imóveis) — leads via webhook
-- ----------------------------------------------------------------------------
-- O portal envia POST na Edge Function `grupozap-leads` (Authorization Basic
-- com a SECRET_KEY do CRM). Esta migration cria:
--   1. portal_lead_events — idempotência por originLeadId (o portal reenvia
--      leads em falha; duplicado responde 2xx sem recriar).
--   2. Seed no utm_channel_map — leads de portal derivam
--      origin_channel = portal_imoveis via _derive_deal_traffic().
--   3. RPC ingest_portal_lead — cria o deal na primeira etapa do funil
--      comercial; se o contato já tem negócio aberto, registra a consulta
--      como atividade (nota) em vez de duplicar o card.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

-- 1. Idempotência ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_hub.portal_lead_events (
  origin_lead_id TEXT PRIMARY KEY,
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  contact_id     UUID REFERENCES whatsapp_hub.contacts(id) ON DELETE SET NULL,
  deal_id        UUID REFERENCES whatsapp_hub.deals(id) ON DELETE SET NULL,
  processed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE whatsapp_hub.portal_lead_events ENABLE ROW LEVEL SECURITY;

-- Leitura para o app; escrita só via service role (Edge Function).
DROP POLICY IF EXISTS portal_lead_events_read ON whatsapp_hub.portal_lead_events;
CREATE POLICY portal_lead_events_read ON whatsapp_hub.portal_lead_events
  FOR SELECT TO authenticated USING (true);

-- 2. Mapeamento de canal -----------------------------------------------------
INSERT INTO whatsapp_hub.utm_channel_map (match_type, match_value, traffic_type, origin_channel, priority)
SELECT * FROM (VALUES
  ('source', 'grupo_olx',   'organico', 'portal_imoveis', 90),
  ('source', 'zap_imoveis', 'organico', 'portal_imoveis', 90),
  ('source', 'vivareal',    'organico', 'portal_imoveis', 90),
  ('source', 'olx',         'organico', 'portal_imoveis', 90)
) AS seed(match_type, match_value, traffic_type, origin_channel, priority)
WHERE NOT EXISTS (
  SELECT 1 FROM whatsapp_hub.utm_channel_map m
  WHERE m.match_type = seed.match_type AND m.match_value = seed.match_value
);

-- 3. RPC de ingestão ---------------------------------------------------------
CREATE OR REPLACE FUNCTION whatsapp_hub.ingest_portal_lead(
  p_contact_id UUID,
  p_payload    JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
DECLARE
  v_deal      UUID;
  v_pipeline  UUID;
  v_stage     UUID;
  v_title     TEXT;
  v_deduped   BOOLEAN := false;
  v_note      TEXT;
  v_listing   TEXT := NULLIF(btrim(p_payload ->> 'clientListingId'), '');
  v_message   TEXT := NULLIF(btrim(p_payload ->> 'message'), '');
BEGIN
  v_note := concat_ws(E'\n',
    'Lead recebido do Canal Pro (Grupo OLX / ZAP Imóveis).',
    CASE WHEN v_listing IS NOT NULL THEN 'Imóvel (código no CRM): ' || v_listing END,
    CASE WHEN p_payload ->> 'transactionType' = 'RENT' THEN 'Interesse: aluguel'
         WHEN p_payload ->> 'transactionType' = 'SELL' THEN 'Interesse: compra' END,
    CASE WHEN NULLIF(p_payload ->> 'temperature', '') IS NOT NULL
         THEN 'Temperatura: ' || (p_payload ->> 'temperature') END,
    CASE WHEN NULLIF(p_payload -> 'extraData' ->> 'leadType', '') IS NOT NULL
         THEN 'Canal: ' || (p_payload -> 'extraData' ->> 'leadType') END,
    CASE WHEN v_message IS NOT NULL THEN 'Mensagem: ' || v_message END
  );

  -- Contato já tem negócio aberto → não duplica card, só registra a consulta.
  SELECT id INTO v_deal
  FROM whatsapp_hub.deals
  WHERE contact_id = p_contact_id AND status = 'open'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_deal IS NOT NULL THEN
    v_deduped := true;
  ELSE
    SELECT id INTO v_pipeline
    FROM whatsapp_hub.pipelines WHERE kind = 'comercial'
    ORDER BY position, created_at LIMIT 1;
    SELECT id INTO v_stage
    FROM whatsapp_hub.stages
    WHERE pipeline_id = v_pipeline AND NOT is_won AND NOT is_lost
    ORDER BY position LIMIT 1;
    SELECT COALESCE(NULLIF(btrim(name), ''), phone, email, 'Lead')
    INTO v_title FROM whatsapp_hub.contacts WHERE id = p_contact_id;

    INSERT INTO whatsapp_hub.deals (
      contact_id, pipeline_id, stage_id, title, status,
      utm_source, utm_medium,
      attribution_method, raw_tracking
    ) VALUES (
      p_contact_id, v_pipeline, v_stage, v_title, 'open',
      'grupo_olx', 'portal',
      'portal_imoveis', p_payload
    )
    RETURNING id INTO v_deal;
  END IF;

  INSERT INTO whatsapp_hub.crm_activities (contact_id, deal_id, type, title, body, done)
  VALUES (p_contact_id, v_deal, 'note', 'Lead Canal Pro', v_note, true);

  RETURN (
    SELECT jsonb_build_object(
      'deal_id', v_deal,
      'deduped', v_deduped,
      'attribution_method', d.attribution_method,
      'origin_channel', d.origin_channel,
      'traffic_type', d.traffic_type
    )
    FROM whatsapp_hub.deals d WHERE d.id = v_deal
  );
END;
$$;

REVOKE ALL ON FUNCTION whatsapp_hub.ingest_portal_lead(UUID, JSONB) FROM PUBLIC;
