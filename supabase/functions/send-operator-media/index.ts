import { storeInboxMedia } from '../_shared/whatsapp/media.ts';
// ============================================================================
// send-operator-media
// ----------------------------------------------------------------------------
// Operador anexa uma mídia (imagem/áudio/vídeo/documento) numa conversa. O
// arquivo chega como multipart/form-data e fica no Storage privado (máx 25MB).
// O provedor recebe uma URL temporária. O histórico mantém a referência
// permanente ao Storage, e o navegador renova a assinatura para reprodução.
//
// Notas privadas NÃO passam por aqui — são texto e nunca vão ao Zernio.
// ============================================================================

import { requireCaller, AuthError } from '../_shared/auth.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { sendUazapiMessage } from '../_shared/whatsapp/outbound.ts';
import {
  ZernioError,
  createInboxConversation,
  loadZernioContext,
  sendInboxMessage,
} from '../_shared/zernio.ts';

const MAX_BYTES = 25 * 1024 * 1024;

function classify(mime: string): 'image' | 'audio' | 'video' | 'document' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'document';
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const caller = await requireCaller(req);
    if (caller.role !== 'admin' && caller.role !== 'operator') {
      return jsonResponse({ ok: false, error: 'Sem permissão para enviar mensagens.' }, { status: 403 });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return jsonResponse({ ok: false, error: 'Esperado multipart/form-data.' }, { status: 400 });
    }

    const conversationId = String(form.get('conversation_id') ?? '').trim();
    const caption = String(form.get('content') ?? '').trim();
    const voiceNote = String(form.get('voice_note') ?? '') === 'true';
    const file = form.get('file');

    if (!conversationId) {
      return jsonResponse({ ok: false, error: 'conversation_id ausente.' }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return jsonResponse({ ok: false, error: 'Arquivo ausente.' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return jsonResponse({ ok: false, error: 'Arquivo excede 25MB.' }, { status: 400 });
    }

    const admin = getAdminClient();

    const { data: conv, error: convErr } = await admin
      .from('conversations')
      .select('id, contact_id, whatsapp_channel_id, channel, zernio_conversation_id')
      .eq('id', conversationId)
      .maybeSingle();
    if (convErr) return jsonResponse({ ok: false, error: convErr.message }, { status: 500 });
    if (!conv) return jsonResponse({ ok: false, error: 'Conversa não encontrada.' }, { status: 404 });
    const convRow = conv as { whatsapp_channel_id: string | null; id: string; contact_id: string; channel: string; zernio_conversation_id: string | null };
    if (!["whatsapp", "uazapi"].includes(convRow.channel ?? "")) {
      return jsonResponse({ error: "Canal não disponível nesta edição." }, { status: 400 });
    }

    const contentType = classify(file.type || '');
    const mime = file.type || 'application/octet-stream';
    const filename = voiceNote ? 'voice-note.ogg' : (file.name || `arquivo-${contentType}`);
    const bytes = new Uint8Array(await file.arrayBuffer());

    if (convRow.channel === 'uazapi') {
      const { data: contact, error: contactError } = await admin.from('contacts').select('phone').eq('id', convRow.contact_id).single();
      if (contactError || !contact?.phone) return jsonResponse({ ok: false, error: 'Contato sem telefone.' }, { status: 400 });
      const bucket = 'whatsapp-hub-inbox-media';
      const path = `${conversationId}/${crypto.randomUUID()}/${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const storage = admin.storage.from(bucket);
      const { error: uploadError } = await storage.upload(path, bytes, { contentType: mime });
      if (uploadError) throw uploadError;
      const { data: signed, error: signError } = await storage.createSignedUrl(path, 3600);
      if (signError || !signed) throw signError ?? new Error('Falha ao assinar anexo.');
      const { data: message, error: insertError } = await admin.from('messages').insert({
        conversation_id: conversationId, direction: 'outbound', sender_type: 'operator',
        sender_id: caller.userId, content_type: contentType, content: caption || null,
        media_url: `storage://${bucket}/${path}`, is_private_note: false,
      }).select('id').single();
      if (insertError) throw insertError;
      await admin.from('conversations').update({
        last_message_at: new Date().toISOString(), status: 'human_active', ai_paused: true, assigned_to: caller.userId,
      }).eq('id', conversationId);
      try {
        const sent = await sendUazapiMessage(contact.phone, caption, signed.signedUrl, contentType, convRow.whatsapp_channel_id, filename);
        const { error } = await admin.from('messages').update({
          meta_status: 'sent', zernio_message_id: sent.messageId ? `uazapi:${convRow.whatsapp_channel_id ?? "legacy"}:${sent.messageId}` : null,
        }).eq('id', message.id);
        if (error) throw error;
        return jsonResponse({ ok: true, message_id: message.id, sent_via: 'uazapi' });
      } catch (err) {
        const deliveryError = err instanceof Error ? err.message : 'Falha ao enviar anexo via Uazapi.';
        await admin.from('messages').update({ meta_status: 'failed', delivery_error: deliveryError }).eq('id', message.id);
        return jsonResponse({ ok: true, message_id: message.id, sent_via: 'uazapi',
          uazapi_error: deliveryError });
      }
    }

    const ctx = await loadZernioContext(convRow.whatsapp_channel_id);

    // Armazena uma cópia privada e fornece ao provedor uma URL temporária.
    const storedPath = `${conversationId}/${crypto.randomUUID()}/${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storedMediaUrl = await storeInboxMedia(admin, storedPath, bytes, mime);
    const {data:signedMedia,error:signError}=await admin.storage.from('whatsapp-hub-inbox-media').createSignedUrl(storedPath,3600);
    if(signError || !signedMedia)throw new Error('Não foi possível disponibilizar o anexo para envio.');
    const mediaUrl=signedMedia.signedUrl;

    // 2. Resolve a conversa 1:1 no Zernio (cria pelo telefone se necessário).
    let zernioConversationId = convRow.zernio_conversation_id;
    if (!zernioConversationId) {
      const { data: contactRow } = await admin
        .from('contacts')
        .select('phone')
        .eq('id', convRow.contact_id)
        .maybeSingle();
      const phone = (contactRow as { phone?: string } | null)?.phone ?? null;
      if (!phone) return jsonResponse({ ok: false, error: 'Contato sem telefone.' }, { status: 400 });
      const created = await createInboxConversation({ apiKey: ctx.apiKey, accountId: ctx.accountId, participantId: phone });
      zernioConversationId = created.conversationId;
      if (zernioConversationId) {
        await admin.from('conversations').update({ zernio_conversation_id: zernioConversationId }).eq('id', conversationId);
      }
    }
    if (!zernioConversationId) {
      return jsonResponse({ ok: false, error: 'Não foi possível resolver a conversa no Zernio.' }, { status: 502 });
    }

    // 4. Persiste a linha (media_url = url do Zernio, baixável pelo thread).
    const { data: inserted, error: insErr } = await admin
      .from('messages')
      .insert({
        conversation_id: conversationId,
        direction: 'outbound',
        sender_type: 'operator',
        sender_id: caller.userId,
        content_type: contentType,
        content: caption || null,
        media_url: storedMediaUrl,
        meta_status: null,
        is_private_note: false,
      })
      .select('id')
      .single();
    if (insErr) return jsonResponse({ ok: false, error: insErr.message }, { status: 500 });

    let zernioError: string | undefined;
    try {
    const sent = await sendInboxMessage({
      apiKey: ctx.apiKey,
      accountId: ctx.accountId,
      conversationId: zernioConversationId,
      attachmentUrl: mediaUrl,
      attachmentType: contentType === 'document' ? 'file' : contentType,
      attachmentName: filename,
      voiceNote,
      text: caption || undefined,
    });

      const {error:statusError}=await admin.from('messages').update({meta_status:'sent',zernio_message_id:sent.messageId}).eq('id',inserted.id);
      if(statusError)throw new Error('Envio aceito, mas não foi possível atualizar o registro. Verifique antes de reenviar.');
    } catch(error) {
      zernioError=error instanceof Error?error.message:'Falha ao enviar anexo.';
      await admin.from('messages').update({meta_status:'failed',delivery_error:zernioError}).eq('id',inserted.id);
    }

    await admin
      .from('conversations')
      .update({
        last_message_at: new Date().toISOString(),
        status: 'human_active',
        ai_paused: true,
        assigned_to: caller.userId,
      })
      .eq('id', conversationId);

    return jsonResponse({
      ok: true,
      message_id: (inserted as { id: string }).id,
      media_url: mediaUrl,
      sent_to_zernio: !zernioError,
      zernio_error: zernioError,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonResponse({ ok: false, error: err.message }, { status: err.status });
    }
    if (err instanceof ZernioError) {
      return jsonResponse({ ok: false, error: err.message }, { status: err.status === 401 ? 401 : 502 });
    }
    console.error('send-operator-media error', err);
    return jsonResponse({ ok: false, error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 });
  }
});
