// Envio outbound via Uazapi para conversas do canal 'uazapi'. Permite WABA
// (Zernio) e Uazapi coexistirem: cada conversa responde pelo provedor por onde
// a mensagem chegou; as credenciais dos dois podem estar configuradas juntas.

import { getAdminClient } from '../supabase-admin.ts';
import { getCredential } from '../credentials.ts';
import { UazapiProvider } from './uazapi-provider.ts';

export async function loadUazapiProvider(channelId?: string | null): Promise<UazapiProvider> {
  if(channelId){const {data,error}=await getAdminClient().from('whatsapp_channels').select('provider,enabled').eq('id',channelId).single();if(error||!data?.enabled||data.provider!=='uazapi')throw new Error('Número Uazapi indisponível.');}
  const serverUrl = ((await getCredential(channelId ? `channel_${channelId}_url` : 'uazapi_server_url')) ?? '').replace(/\/$/, '');
  const token = (await getCredential(channelId ? `channel_${channelId}_token` : 'uazapi_instance_token')) ?? '';
  if (!serverUrl || !token) {
    throw new Error('Credenciais Uazapi ausentes (server URL / instance token).');
  }
  return new UazapiProvider(serverUrl, token);
}

// Envia texto (e opcionalmente mídia) para o telefone do contato via Uazapi.
export async function sendUazapiMessage(
  phone: string,
  text: string,
  mediaUrl?: string | null,
  mediaType?: string,
  channelId?: string | null,
  filename?: string,
): Promise<{ messageId: string | null }> {
  const provider = await loadUazapiProvider(channelId);
  const result = await provider.sendMessage(phone, text, { mediaUrl: mediaUrl ?? undefined, mediaType, filename });
  if (!result.ok) {
    throw new Error(result.error ?? 'Erro ao enviar via Uazapi.');
  }
  return { messageId: result.messageId };
}
