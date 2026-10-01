import { requireServiceRole, AuthError } from '../_shared/auth.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { getCredential } from '../_shared/credentials.ts';
import { syncZernioChannels, syncUazapiChannels } from '../_shared/channel-sync.ts';
import { jsonResponse } from '../_shared/cors.ts';
Deno.serve(async(req)=>{try{await requireServiceRole(req);const key=await getCredential('zernio_api_key');await syncUazapiChannels(getAdminClient(),getCredential);return jsonResponse({ok:true,count:key?await syncZernioChannels(getAdminClient(),key):0});}catch(e){return jsonResponse({error:e instanceof AuthError?'Acesso negado':'Falha ao sincronizar canais'},{status:e instanceof AuthError?e.status:502});}});
