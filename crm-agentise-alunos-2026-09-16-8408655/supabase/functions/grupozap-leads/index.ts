// ============================================================================
// grupozap-leads  (público, deploy com --no-verify-jwt)
// ----------------------------------------------------------------------------
// Webhook de leads do Canal Pro (Grupo OLX / ZAP Imóveis / VivaReal).
// O portal envia POST JSON com header `Authorization: Basic base64("vivareal:
// <SECRET_KEY>")`. Validamos a SECRET_KEY (credencial `grupozap_secret_key`),
// deduplicamos por originLeadId (portal_lead_events), resolvemos/criamos o
// contato e chamamos a RPC ingest_portal_lead, que cria o card na primeira
// etapa do funil comercial (ou registra atividade se já há negócio aberto).
//
// Contrato de resposta (só o status HTTP importa para o GrupoZap):
//   2xx = recebido · 401 = SECRET_KEY inválida · 4xx = lead inválido
//   (reprocessado depois) · 5xx = erro nosso (o portal reenvia).
// Docs: https://developers.grupozap.com/webhooks/integration_leads.html
// ============================================================================

import { getAdminClient } from '../_shared/supabase-admin.ts';
import { getCredential } from '../_shared/credentials.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';

interface GrupoZapLead {
  leadOrigin?: string;        // 'Grupo OLX' | 'MCMV_OLX'
  timestamp?: string;
  originLeadId?: string;      // sempre presente; chave de dedupe
  originListingId?: string;
  clientListingId?: string;   // obrigatório em lead de anúncio
  name?: string;
  email?: string;
  ddd?: string;
  phone?: string;
  phoneNumber?: string;       // deprecado (DDD + número)
  message?: string;
  temperature?: string;
  transactionType?: string;   // 'RENT' | 'SELL'
  extraData?: Record<string, unknown>;
}

function clean(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

// Telefone do portal chega como ddd + phone (ou phoneNumber legado), sem
// código do país. Normaliza para E.164 BR, padrão da tabela contacts.
function normalizeBrPhone(ddd: string | null, phone: string | null, legacy: string | null): string | null {
  const digits = (ddd && phone ? `${ddd}${phone}` : legacy ?? '').replace(/[^\d]/g, '');
  if (digits.length < 10) return null;
  return digits.startsWith('55') && digits.length >= 12 ? `+${digits}` : `+55${digits}`;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Authorization: Basic base64("vivareal:<SECRET_KEY>") → extrai a SECRET_KEY.
function extractSecretKey(header: string | null): string | null {
  if (!header) return null;
  const [scheme, b64] = header.split(' ');
  if (scheme?.toLowerCase() !== 'basic' || !b64) return null;
  try {
    const decoded = atob(b64.trim());
    const sep = decoded.indexOf(':');
    return sep >= 0 ? decoded.slice(sep + 1) : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, { status: 405 });
  }

  // 1. Autenticação — valida que a requisição vem do GrupoZap.
  // Se a grupozap_secret_key não estiver configurada, aceita sem autenticação
  // (útil quando o Canal Pro não envia Authorization header).
  // Quando configurada, exige que o header Authorization: Basic bata exatamente.
  const secret =
    (await getCredential('grupozap_secret_key')) ??
    Deno.env.get('GRUPOZAP_SECRET_KEY') ?? null;
  if (secret) {
    const provided = extractSecretKey(req.headers.get('authorization'));
    if (!provided || !timingSafeEqualStr(provided, secret)) {
      console.log(JSON.stringify({ event: 'grupozap_lead_rejected', reason: 'invalid_secret' }));
      return jsonResponse({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
  } else {
    console.log(JSON.stringify({ event: 'grupozap_lead_no_auth', note: 'secret not configured, accepting without auth' }));
  }

  let body: GrupoZapLead;
  try { body = (await req.json()) as GrupoZapLead; }
  catch { return jsonResponse({ ok: false, error: 'JSON inválido' }, { status: 400 }); }

  // 2. Validações do contrato GrupoZap.
  const leadOrigin = clean(body.leadOrigin) ?? 'Grupo OLX';
  const isMcmv = leadOrigin === 'MCMV_OLX';
  if (!isMcmv && !clean(body.clientListingId)) {
    // 4xx para o portal revisar e reprocessar (regra da documentação).
    return jsonResponse({ ok: false, error: 'clientListingId ausente' }, { status: 400 });
  }

  const phone = normalizeBrPhone(clean(body.ddd), clean(body.phone), clean(body.phoneNumber));
  const email = clean(body.email);
  const name = clean(body.name);
  if (!phone && !email) {
    return jsonResponse({ ok: false, error: 'Lead sem telefone e sem email' }, { status: 400 });
  }

  const admin = getAdminClient();

  // 3. Idempotência — claim atômico por originLeadId (PK). Retry do portal
  // com o mesmo lead responde 2xx sem recriar nada.
  const originLeadId = clean(body.originLeadId);
  if (originLeadId) {
    const { error: claimErr } = await admin
      .from('portal_lead_events')
      .insert({ origin_lead_id: originLeadId, payload: body });
    if (claimErr) {
      if (claimErr.code === '23505') {
        return jsonResponse({ ok: true, deduped: true });
      }
      return jsonResponse({ ok: false, error: `evento: ${claimErr.message}` }, { status: 500 });
    }
  }

  // Desfaz o claim se a ingestão falhar, para o reenvio do portal funcionar.
  const releaseClaim = async () => {
    if (originLeadId) {
      await admin.from('portal_lead_events').delete().eq('origin_lead_id', originLeadId);
    }
  };

  try {
    // 4. Resolve/cria contato por telefone (preferido) ou email.
    let contactId: string | null = null;
    const lookup = phone
      ? admin.from('contacts').select('id').eq('phone', phone).maybeSingle()
      : admin.from('contacts').select('id').eq('email', email!).maybeSingle();
    const { data: existing, error: lookupErr } = await lookup;
    if (lookupErr) throw new Error(`contato: ${lookupErr.message}`);
    if (existing) contactId = (existing as { id: string }).id;
    else {
      const insert: Record<string, unknown> = { name, source: 'canal_pro' };
      if (phone) insert.phone = phone;
      if (email) insert.email = email;
      const { data: created, error } = await admin
        .from('contacts').insert(insert).select('id').single();
      if (error) throw new Error(`contato: ${error.message}`);
      contactId = (created as { id: string }).id;
    }

    // 5. Cria o card na primeira etapa do funil (ou atividade se já há deal).
    const { data: result, error: rpcErr } = await admin.rpc('ingest_portal_lead', {
      p_contact_id: contactId,
      p_payload: body,
    });
    if (rpcErr) throw new Error(`ingestão: ${rpcErr.message}`);

    if (originLeadId) {
      await admin
        .from('portal_lead_events')
        .update({ contact_id: contactId, deal_id: (result as { deal_id?: string })?.deal_id ?? null })
        .eq('origin_lead_id', originLeadId);
    }

    console.log(JSON.stringify({ event: 'grupozap_lead_ingested', originLeadId, leadOrigin, result }));
    return jsonResponse({ ok: true, result });
  } catch (err) {
    await releaseClaim();
    const message = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ event: 'grupozap_lead_failed', originLeadId, error: message }));
    return jsonResponse({ ok: false, error: message }, { status: 500 });
  }
});
