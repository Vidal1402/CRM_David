CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub;

-- Expõe somente os dados de identificação dos membros, como na RPC anterior.
DROP FUNCTION whatsapp_hub.list_operators();
CREATE FUNCTION whatsapp_hub.list_operators()
RETURNS TABLE (user_id uuid, email text, role whatsapp_hub.tenant_role, name text)
LANGUAGE sql SECURITY DEFINER
SET search_path = whatsapp_hub, auth, public, pg_temp
AS $$
 SELECT au.user_id, u.email::text, au.role,
   COALESCE(NULLIF(trim(u.raw_user_meta_data->>'display_name'),''),
            NULLIF(trim(u.raw_user_meta_data->>'full_name'),''),
            NULLIF(trim(u.raw_user_meta_data->>'name'),''), u.email::text)
 FROM whatsapp_hub.app_users au JOIN auth.users u ON u.id=au.user_id
 ORDER BY au.role, u.email;
$$;
REVOKE EXECUTE ON FUNCTION whatsapp_hub.list_operators() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION whatsapp_hub.list_operators() TO authenticated, service_role;
