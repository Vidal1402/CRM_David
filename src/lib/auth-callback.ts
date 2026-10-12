// Tokens de convite/reset do Supabase vêm no hash (#access_token=…&type=invite)
// ou, no fluxo PKCE, em ?code=. Se o Site URL do Auth não for /invite, o
// convidado cai em / ou /setup, o React Router troca a rota e o fragmento some
// — a pessoa vê login + wizard em vez de definir senha e entrar.

export function isAuthCallbackLocation(search = '', hash = ''): boolean {
  const blob = `${search}${hash}`;
  if (/[?&#]access_token=/.test(blob) || /[?&#]refresh_token=/.test(blob)) return true;
  if (/[?&#]type=(invite|recovery|magiclink|signup|email)/.test(blob)) return true;
  if (/[?&#]code=/.test(search) && /[?&#](type=|iss=)/.test(blob)) return true;
  return false;
}

export function captureAuthCallback(): void {
  if (typeof window === 'undefined') return;
  const { pathname, search, hash } = window.location;
  if (!isAuthCallbackLocation(search, hash)) return;
  if (pathname === '/invite') return;
  window.location.replace(`${window.location.origin}/invite${search}${hash}`);
}
