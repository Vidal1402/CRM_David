import { UazapiProvider } from '../_shared/whatsapp/uazapi-provider.ts';
import { storeInboxMedia } from '../_shared/whatsapp/media.ts';
// ============================================================================
// whatsapp-inbound  (público, HMAC-verified para Zernio)  · Fase 4
// ----------------------------------------------------------------------------
// Fecha o loop de atribuição: mensagem inbound → origem no lead.
//   1. Roteia pelo provedor (?provider= ou detecção por X-Zernio-Signature).
//   2. Zernio: valida HMAC (X-Zernio-Signature) contra zernio_webhook_secret.
//   3. parseInboundWebhook do adapter (Fase 3). Ignora echo (isFromMe) e não-msg.
//   4. Idempotência por messageId em whatsapp_hub.webhook_events.
//   5. Resolve/cria o contato (por telefone).
//   6. extractReferral → chama a RPC attribute_inbound_lead, que aplica a
//      hierarquia CTWA > código de rastreio > whatsapp_direto.
//
// Deploy com --no-verify-jwt: provedores chamam anonimamente; o HMAC (Zernio) e
// a resolução de credenciais são os gates. Uazapi/Baileys não assinam (ASSUMIDO).
// ============================================================================

import { getAdminClient } from '../_shared/supabase-admin.ts';
import { getCredential } from '../_shared/credentials.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import {
  resolveInboundProvider,
  type ProviderName,
} from '../_shared/whatsapp/index.ts';

// --- HMAC (mesmo esquema do zernio-webhook) --------------------------------
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function hmacSha256(secret: string, payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
}
function toHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}
function toB64(b: Uint8Array): string {
  let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s);
}
function signatureMatches(header: string, mac: Uint8Array): boolean {
  const got = (header.startsWith('sha256=') ? header.slice(7) : header).trim();
  return timingSafeEqualStr(got, toHex(mac)) || timingSafeEqualStr(got, toB64(mac));
}

// Nome distinto do normalizePhone de _shared/whatsapp/types.ts — o bundler do
// bootstrap inlina os _shared no mesmo escopo do módulo.
function toE164(raw: string): string {
  const t = raw.trim();
  return t.startsWith('+') ? t : `+${t}`;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, { status: 405 });
  }

  const url = new URL(req.url);
  const hasZernioSig = req.headers.get('X-Zernio-Signature') !== null;
  const hint = (url.searchParams.get('provider') as ProviderName | null)
    ?? (hasZernioSig ? 'zernio' : undefined);

  const rawBody = await req.text();

  // Zernio: HMAC obrigatório.
  if (hint === 'zernio' || hasZernioSig) {
    const secret = await getCredential('zernio_webhook_secret');
    const sig = req.headers.get('X-Zernio-Signature') ?? '';
    if (!secret) return jsonResponse({ ok: false, error: 'webhook secret ausente' }, { status: 500 });
    if (!sig) return jsonResponse({ ok: false, error: 'assinatura ausente' }, { status: 401 });
    const mac = await hmacSha256(secret, rawBody);
    if (!signatureMatches(sig, mac)) {
      return jsonResponse({ ok: false, error: 'assinatura inválida' }, { status: 401 });
    }
  }

  let payload: unknown;
  try { payload = JSON.parse(rawBody); }
  catch { return jsonResponse({ ok: false, error: 'JSON inválido' }, { status: 400 }); }

  const channelId = url.searchParams.get('channel_id');
  if (hint !== 'uazapi' || !channelId) return jsonResponse({error:'Número não identificado.'},{status:400});
  const expected = await getCredential(`channel_${channelId}_webhook`);
  if (!expected || !timingSafeEqualStr(expected,url.searchParams.get('secret')??'')) return jsonResponse({error:'Webhook não autorizado.'},{status:401});
  const admin=getAdminClient();
  const {data:channel,error:channelError}=await admin.from('whatsapp_channels').select('*').eq('id',channelId).eq('provider','uazapi').single();
  if(channelError||!channel)return jsonResponse({error:'Número desconhecido.'},{status:404});
  if(!channel.enabled)return jsonResponse({ok:true,skipped:'disabled'});
  const creds={uazapi_server_url:await getCredential(`channel_${channelId}_url`),uazapi_instance_token:await getCredential(`channel_${channelId}_token`)};
  const provider=resolveInboundProvider('uazapi',creds);
  if(!provider)return jsonResponse({error:'Instância não configurada.'},{status:400});
  const inbound=provider.parseInboundWebhook(payload);
  if(!inbound||inbound.isFromMe)return jsonResponse({ok:true,skipped:'non-inbound'});
  const {data:duplicate}=await admin.from('messages').select('id').eq('zernio_message_id',`uazapi:${channelId}:${inbound.messageId}`).maybeSingle();
  if(duplicate)return jsonResponse({ok:true,deduped:true});
  if(inbound.contentType && inbound.contentType!=='text') {
    try {
      const media=await (provider as UazapiProvider).downloadMedia(inbound.messageId);
      const path=`inbound/${channelId}/${encodeURIComponent(inbound.messageId)}`;
      inbound.mediaUrl=await storeInboxMedia(admin,path,media.bytes,media.mime);
    } catch { return jsonResponse({error:'Mídia indisponível; recebimento deve ser reenviado.'},{status:503}); }
  }
  const {data,error}=await admin.rpc('ingest_channel_message',{p_channel_id:channelId,p_message_id:inbound.messageId,p_phone:toE164(inbound.from),p_name:inbound.senderName??null,p_text:inbound.text,p_content_type:inbound.contentType??'text',p_media_url:inbound.mediaUrl??null});
  if(error)return jsonResponse({error:'Falha ao salvar mensagem.'},{status:500});
  return jsonResponse({ok:true,...data});
});
