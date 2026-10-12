-- Planos comerciais por usuário (demo/licença nesta instância).
-- inicial R$297 · intermediario R$497 · avancado R$897
-- Quem já está na base fica no avançado para não travar o owner.

DO $$ BEGIN
  CREATE TYPE whatsapp_hub.commercial_plan AS ENUM ('inicial', 'intermediario', 'avancado');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE whatsapp_hub.app_users
  ADD COLUMN IF NOT EXISTS commercial_plan whatsapp_hub.commercial_plan NOT NULL DEFAULT 'avancado';

COMMENT ON COLUMN whatsapp_hub.app_users.commercial_plan IS
  'Plano comercial desta conta: inicial (297), intermediario (497), avancado (897).';
