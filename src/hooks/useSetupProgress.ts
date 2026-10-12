import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';

export type SetupStepId = 'funnel' | 'whatsapp' | 'team' | 'inbox';

export interface SetupProgress {
  loading: boolean;
  funnelReady: boolean;
  whatsappReady: boolean;
  teamReady: boolean;
  inboxReady: boolean;
}

const empty: SetupProgress = {
  loading: true,
  funnelReady: false,
  whatsappReady: false,
  teamReady: false,
  inboxReady: false,
};

export function useSetupProgress(): SetupProgress {
  const [state, setState] = useState<SetupProgress>(empty);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getSupabase();
      const [pipelines, channels, operators, conversations] = await Promise.all([
        supabase.from('pipelines').select('id', { count: 'exact', head: true }).eq('kind', 'comercial'),
        supabase.from('whatsapp_channels').select('id, connected, enabled'),
        supabase.schema('whatsapp_hub').rpc('list_operators'),
        supabase.from('conversations').select('id', { count: 'exact', head: true }),
      ]);
      if (cancelled) return;
      const channelRows = (channels.data ?? []) as { connected: boolean; enabled: boolean }[];
      setState({
        loading: false,
        funnelReady: (pipelines.count ?? 0) > 0,
        whatsappReady: channelRows.some((c) => c.connected && c.enabled),
        teamReady: ((operators.data ?? []) as unknown[]).length > 1,
        inboxReady: (conversations.count ?? 0) > 0,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
