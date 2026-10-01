import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UazapiProvider } from '../../supabase/functions/_shared/whatsapp/uazapi-provider.ts';
import { inspectUazapiWebhook, registerUazapiWebhook } from '../../src/lib/uazapi-webhook.ts';

const provider = new UazapiProvider('https://instance.example/', 'test-instance-token');
const hook = 'https://project.supabase.co/functions/v1/whatsapp-inbound?provider=uazapi';
const message = { messageid: 'WA123', sender_pn: '5511999999999@s.whatsapp.net',
  chatid: '123456789012345@lid', text: 'Olá', messageType: 'Conversation',
  messageTimestamp: 1789000000000, fromMe: false, isGroup: false };

for (const [name, envelope] of Object.entries({
  message: { EventType: 'messages', message }, data: { event: 'message', data: message },
  nested: { event: 'messages', data: { message } }, root: message,
})) test(`recebe Message v2: ${name}`, () => {
  const result = provider.parseInboundWebhook(envelope);
  assert.equal(result?.from, '+5511999999999');
  assert.equal(result?.text, 'Olá');
  assert.equal(result?.messageId, 'WA123');
});

test('ignora grupos, eventos de conexão e não transforma LID em telefone', () => {
  assert.equal(provider.parseInboundWebhook({ message: { ...message, isGroup: true } }), null);
  assert.equal(provider.parseInboundWebhook({ event: 'connection', message }), null);
  assert.equal(provider.parseInboundWebhook({ message: { ...message, sender_pn: '', sender: '123456789012345@lid' } }), null);
});

test('marca echo para impedir loops e mantém texto Baileys legado', () => {
  assert.equal(provider.parseInboundWebhook({ message: { ...message, wasSentByApi: true } })?.isFromMe, true);
  const result = provider.parseInboundWebhook({ data: { key: { id: 'legacy', remoteJid: '5511999999999@s.whatsapp.net' }, message: { conversation: 'Oi' } } });
  assert.equal(result?.text, 'Oi');
});

test('detecta webhook ausente, destino errado e filtros que bloqueiam inbox', () => {
  assert.equal(inspectUazapiWebhook([], hook).webhook_ready, false);
  assert.equal(inspectUazapiWebhook([{ url: 'https://other.example', enabled: true, events: ['messages'] }], hook).webhook_ready, false);
  for (const override of [{ enabled: false }, { events: ['connection'] }, { addUrlEvents: true },
    { addUrlTypesMessages: true }, ...['isGroupNo', 'fromMeNo', 'wasNotSentByApi'].map(filter => ({ excludeMessages: [filter] }))]) {
    assert.equal(inspectUazapiWebhook([{ url: hook, enabled: true, events: ['messages'], ...override }], hook).webhook_ready, false);
  }
  assert.equal(inspectUazapiWebhook([{ url: hook, enabled: true, events: ['messages'], excludeMessages: ['wasSentByApi', 'isGroupYes'] }], hook).webhook_ready, true);
});

test('envia texto e mídia com token da instância e usa messageid original', async (t) => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal((options.headers as Record<string, string>).token, 'test-instance-token');
    assert.ok(options.signal);
    requests.push({ url, body: JSON.parse(options.body as string) });
    return Response.json({ id: 'internal:WA123', messageid: 'WA123', status: 'Sent' });
  });
  assert.equal((await provider.sendMessage('+55 (11) 99999-9999', 'Teste')).messageId, 'WA123');
  assert.equal((await provider.sendMessage('+5511999999999', 'Anexo', { mediaUrl: 'https://file.example/test.pdf', mediaType: 'document' })).ok, true);
  assert.deepEqual(requests.map(r => r.url), ['https://instance.example/send/text', 'https://instance.example/send/media']);
  assert.deepEqual(requests[0].body, { number: '5511999999999', text: 'Teste' });
  assert.equal(requests[1].body.type, 'document');
});

test('recusa HTTP 200 com erro ou resposta sem confirmação e oculta o token', async (t) => {
  const responses = [Response.json({ error: 'instance disconnected' }), Response.json({}),
    Response.json({ error: 'invalid test-instance-token' }, { status: 401 }),
    Response.json({ id: 'bad', status: 'Failed' })];
  t.mock.method(globalThis, 'fetch', async () => responses.shift()!);
  assert.match((await provider.sendMessage('5511999999999', 'Teste')).error!, /disconnected/);
  assert.equal((await provider.sendMessage('5511999999999', 'Teste')).ok, false);
  assert.equal((await provider.sendMessage('5511999999999', 'Teste')).error, 'invalid [token oculto]');
  assert.equal((await provider.sendMessage('5511999999999', 'Teste')).ok, false);
});

test('registra webhook sem sobrescrever outra integração e verifica o resultado', async (t) => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  const others = [{ id: 'other', url: 'https://other.example/hook', enabled: true, events: ['messages'] }];
  let saved: Record<string, unknown> | null = null;
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    if (options.method === 'POST') { saved = JSON.parse(options.body as string); return Response.json([saved]); }
    return Response.json(saved ? [...others, saved] : others);
  });
  assert.equal((await registerUazapiWebhook('https://instance.example/', 'token')).webhook_ready, true);
  assert.equal(saved!['action'], 'add');
  assert.equal(saved!['addUrlEvents'], false);
});

test('repara o webhook existente por ID e não confirma um registro não aplicado', async (t) => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  const current = { id: 'ours', url: hook, enabled: false, events: ['messages'] };
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    if (options.method === 'POST') {
      const body = JSON.parse(options.body as string);
      assert.equal(body.action, 'update'); assert.equal(body.id, 'ours');
    }
    return Response.json([current]);
  });
  await assert.rejects(registerUazapiWebhook('https://instance.example', 'token'), /desativado/);
});
