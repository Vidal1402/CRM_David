import { getCredential } from '../src/lib/credentials.js';
import { requireAdmin } from '../src/lib/admin-auth.js';
import { getUazapiWebhookUrl, inspectUazapiWebhook, readUazapiWebhooks, registerUazapiWebhook } from '../src/lib/uazapi-webhook.js';

// Status e webhook da instância Uazapi (server-side; o token nunca vai ao browser).
// Doc oficial (docs.uazapi.com):
//   GET  /instance/status  — header `token` (da instância; admintoken NÃO é necessário)
//                            → { instance, status: { connected, loggedIn, jid } }
//   POST /webhook          — header `token` → { enabled, url, events[...] }
// GET  aqui → status da conexão + URL do webhook a cadastrar.
// POST aqui → registra o webhook na Uazapi automaticamente.

type ApiRequest = {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
  end: () => void;
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

    const auth = await requireAdmin(req.headers?.authorization ?? req.headers?.Authorization);
    if (auth.ok === false) {
      return res.status(auth.status).json({ success: false, message: auth.message });
    }

    const serverUrl = ((await getCredential('uazapi_server_url')) ?? '').replace(/\/$/, '');
    const token = (await getCredential('uazapi_instance_token')) ?? '';
    const hook = getUazapiWebhookUrl();

    if (!serverUrl || !token) {
      return res.status(200).json({ success: true, configured: false, webhook_url: hook });
    }

    if (req.method === 'GET') {
      // Saúde da conexão: GET /instance/status com o token da instância.
      const r = await fetch(`${serverUrl}/instance/status`, {
        headers: { token },
        signal: AbortSignal.timeout(10000),
      });
      const body = (await r.json().catch(() => ({}))) as {
        status?: { connected?: boolean; loggedIn?: boolean };
        instance?: { name?: string; profileName?: string; owner?: string };
      };
      if (!r.ok) {
        return res.status(200).json({
          success: true,
          configured: true,
          connected: false,
          error: `Uazapi respondeu ${r.status}`,
          webhook_url: hook,
        });
      }
      let webhookHealth: { webhook_ready: boolean; webhook_error: string | null };
      try {
        webhookHealth = inspectUazapiWebhook(await readUazapiWebhooks(serverUrl, token), hook);
      } catch (err) {
        webhookHealth = { webhook_ready: false, webhook_error: err instanceof Error ? err.message : 'Falha ao consultar webhook.' };
      }
      return res.status(200).json({
        success: true,
        configured: true,
        connected: Boolean(body.status?.connected),
        logged_in: Boolean(body.status?.loggedIn),
        instance_name: body.instance?.profileName ?? body.instance?.name ?? null,
        webhook_url: hook,
        ...webhookHealth,
      });
    }

    return res.status(200).json({ success: true, ...await registerUazapiWebhook(serverUrl, token) });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : 'Erro interno',
    });
  }
}
