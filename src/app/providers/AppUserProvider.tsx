import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from './AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { parsePlan, type CommercialPlan } from '@/lib/plans';

// ----------------------------------------------------------------------------
// AppUserProvider
// ----------------------------------------------------------------------------
// Self-hosted single-org build: there is no tenant concept. The only thing
// we surface to consumers is the role read from auth.jwt().app_metadata.role
// (populated by the on_auth_user_created trigger).
//
// Role gating elsewhere in the app should consume `useAppUser().role` instead
// of querying the DB; the JWT is the source of truth for access control.
// ----------------------------------------------------------------------------

export type AppRole = 'admin' | 'operator';

interface AppUserContextValue {
  userId: string | null;
  role: AppRole | null;
  plan: CommercialPlan;
  loading: boolean;
  reloadPlan: () => Promise<void>;
}

const AppUserContext = createContext<AppUserContextValue | null>(null);

function readRoleFromUser(appMetadata: Record<string, unknown> | undefined): AppRole | null {
  if (!appMetadata) return null;
  const role = appMetadata['role'];
  if (role === 'admin' || role === 'operator') {
    return role;
  }
  return null;
}

export function AppUserProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [plan, setPlan] = useState<CommercialPlan>('avancado');
  const [planLoading, setPlanLoading] = useState(true);

  const role = useMemo(
    () => readRoleFromUser(user?.app_metadata as Record<string, unknown> | undefined),
    [user],
  );

  const loadPlan = useMemo(
    () => async (userId: string) => {
      const { data, error } = await getSupabase()
        .from('app_users')
        .select('commercial_plan')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) {
        setPlan('avancado');
        return;
      }
      setPlan(parsePlan((data as { commercial_plan?: unknown } | null)?.commercial_plan));
    },
    [],
  );

  useEffect(() => {
    if (!user?.id) {
      setPlan('avancado');
      setPlanLoading(false);
      return;
    }
    let cancelled = false;
    setPlanLoading(true);
    void loadPlan(user.id).finally(() => {
      if (!cancelled) setPlanLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id, loadPlan]);

  const reloadPlan = useMemo(
    () => async () => {
      if (user?.id) await loadPlan(user.id);
    },
    [user?.id, loadPlan],
  );

  const loading = authLoading || planLoading;

  const value = useMemo<AppUserContextValue>(
    () => ({ userId: user?.id ?? null, role, plan, loading, reloadPlan }),
    [user, role, plan, loading, reloadPlan],
  );

  return <AppUserContext.Provider value={value}>{children}</AppUserContext.Provider>;
}

export function useAppUser(): AppUserContextValue {
  const ctx = useContext(AppUserContext);
  if (!ctx) {
    throw new Error('useAppUser must be used inside <AppUserProvider>');
  }
  return ctx;
}
