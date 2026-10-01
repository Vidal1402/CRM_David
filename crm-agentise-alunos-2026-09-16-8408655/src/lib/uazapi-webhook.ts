// Contrato oficial: https://docs.uazapi.com/ — GET/POST /webhook.
export interface UazapiWebhook {
  id?: string;
  enabled?: boolean;
  url?: string;
  events?: string[];
  excludeMessages?: string[];
  addUrlEvents?: boolean;
  addUrlTypesMessages?: boolean;
}

export function getUazapiWebhookUrl(): string {
  const base = (process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('SUPABASE_URL ausente no runtime.');
  return `${base}/functions/v1/whatsapp-inbound?provider=uazapi`;
}

export function inspectUazapiWebhook(webhooks: UazapiWebhook[], expectedUrl: string) {
  const matches = webhooks.filter((hook) => hook.url === expectedUrl);
  const ready = matches.some((hook) =>
    hook.enabled === true &&
    hook.events?.includes('messages') &&
    !hook.addUrlEvents && !hook.addUrlTypesMessages &&
    !hook.excludeMessages?.some((filter) =>
      ['fromMeNo', 'isGroupNo', 'wasNotSentByApi'].includes(filter)),
  );
  return {
    webhook_ready: ready,
    webhook_error: ready ? null : matches.length
      ? 'O webhook está desativado ou filtra mensagens recebidas. Repare a configuração abaixo.'
      : 'O WhatsApp está conectado, mas não há webhook deste CRM na instância. Registre-o abaixo para receber mensagens.',
  };
}

export async function readUazapiWebhooks(serverUrl: string, token: string): Promise<UazapiWebhook[]> {
  const response = await fetch(`${serverUrl.replace(/\/+$/, '')}/webhook`, {
    headers: { token },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Não foi possível consultar o webhook na Uazapi (HTTP ${response.status}).`);
  const body: unknown = await response.json();
  // A API atual retorna array; servidores anteriores retornavam um objeto.
  if (Array.isArray(body)) return body.filter((item) => item && typeof item === 'object');
  if (body && typeof body === 'object' && 'url' in body) return [body as UazapiWebhook];
  throw new Error('A Uazapi retornou uma configuração de webhook inválida.');
}

export async function registerUazapiWebhook(serverUrl: string, token: string, expectedUrl?: string) {
  const hook = expectedUrl ?? getUazapiWebhookUrl();
  const webhooks = await readUazapiWebhooks(serverUrl, token);
  const existing = webhooks.find((item) => item.url === hook);
  // Atualiza somente o webhook deste CRM; preserva outras integrações.
  const response = await fetch(`${serverUrl.replace(/\/+$/, '')}/webhook`, {
    method: 'POST',
    headers: { token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(existing?.id ? { action: 'update', id: existing.id } : { action: 'add' }),
      enabled: true,
      url: hook,
      events: ['messages', 'connection'],
      excludeMessages: ['wasSentByApi', 'isGroupYes'],
      addUrlEvents: false,
      addUrlTypesMessages: false,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Uazapi rejeitou o webhook (HTTP ${response.status}).`);
  // Só confirma sucesso depois de consultar a configuração efetivamente salva.
  const health = inspectUazapiWebhook(await readUazapiWebhooks(serverUrl, token), hook);
  if (!health.webhook_ready) throw new Error(health.webhook_error!);
  return { webhook_url: hook, ...health };
}
