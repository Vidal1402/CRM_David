export type CredentialField = {
  key: string;
  label: string;
  helpText?: string;
  docsUrl?: string;
  placeholder?: string;
  inputType?: 'text' | 'password';
  validate: (value: string) => Promise<{ ok: boolean; message?: string }>;
};

export type SetupConfig = {
  toolName: string;
  toolSlug: string;
  appCredentials: CredentialField[];
  postBootstrapRedirect: string;
};

const ok = { ok: true } as const;

export const ZERNIO_API_BASE_URL =
  (typeof process !== 'undefined' ? process.env?.ZERNIO_API_BASE_URL : undefined) ||
  'https://zernio.com/api/v1';

async function validateZernio(value: string) {
  const v = value.trim();
  if (!/^sk_[a-f0-9]{64}$/i.test(v)) {
    return {
      ok: false,
      message: 'A chave Zernio deve ter o formato sk_ seguido de 64 caracteres hex.',
    };
  }
  // Ping real: GET /accounts confirma que a chave autentica no Zernio. A
  // resolucao de accountId/profileId/numero acontece no salvar (zernio-connect).
  const res = await fetch(`${ZERNIO_API_BASE_URL}/accounts`, {
    headers: { Authorization: `Bearer ${v}` },
  });
  return res.ok
    ? ok
    : { ok: false, message: 'Chave Zernio invalida ou sem permissao.' };
}

export const setupConfig: SetupConfig = {
  toolName: 'WhatsApp Hub',
  toolSlug: 'whatsapp-hub',
  postBootstrapRedirect: '/dashboard',
  // O aluno conecta o WhatsApp dentro do Zernio (Embedded Signup) e informa
  // apenas a Zernio API Key. accountId/profileId/tier/numero sao resolvidos
  // server-side no salvar (api/zernio-connect). Nada da Meta e coletado aqui.
  appCredentials: [
    {
      key: 'zernio_api_key',
      label: 'Zernio API Key',
      placeholder: 'sk_...',
      inputType: 'password',
      docsUrl: 'https://zernio.com/dashboard/api-keys',
      helpText:
        'Opcional. Atribuicao premium via Click-to-WhatsApp (ctwa_clid) + conformidade Meta. Conecte o WhatsApp no Zernio (Embedded Signup) e cole a API Key; numero, tier e webhook sao configurados automaticamente.',
      validate: validateZernio,
    },
    {
      key: 'uazapi_server_url',
      label: 'Uazapi Server URL',
      placeholder: 'https://seu-servidor.uazapi.com',
      inputType: 'text',
      helpText:
        'Opcional. Caminho acessivel (API nao-oficial). URL do seu servidor Uazapi.',
      validate: async (value) => {
        const v = value.trim();
        if (!v) return ok; // opcional
        return /^https:\/\/[^\s]+$/i.test(v)
          ? ok
          : { ok: false, message: 'Informe uma URL HTTPS valida (ex.: https://seu-servidor.uazapi.com).' };
      },
    },
    {
      key: 'uazapi_instance_token',
      label: 'Uazapi Instance Token',
      placeholder: 'token da instancia',
      inputType: 'password',
      helpText:
        'Opcional. Token da instancia Uazapi. Atribuicao via codigo de rastreio (Uazapi nao entrega ctwa_clid).',
      validate: async (value) => {
        const v = value.trim();
        if (!v) return ok; // opcional
        return v.length >= 8 ? ok : { ok: false, message: 'Token muito curto.' };
      },
    },
    {
      key: 'app_url',
      label: 'App URL',
      placeholder: 'https://seu-app.vercel.app',
      inputType: 'text',
      helpText: 'Opcional. URL publica usada em links de convite. Derivada do deploy se vazia.',
      validate: async (value) => {
        const v = value.trim();
        if (!v) return ok; // opcional
        return /^https:\/\/.+/i.test(v)
          ? ok
          : { ok: false, message: 'Informe uma URL HTTPS publica.' };
      },
    },

  ],
};
