import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Circle, ListChecks, X } from 'lucide-react';
import { useAppUser } from '@/app/providers/AppUserProvider';
import { useSetupProgress, type SetupStepId } from '@/hooks/useSetupProgress';
import { STORAGE_KEYS } from '@/lib/constants';

const STEPS: {
  id: SetupStepId;
  title: string;
  hint: string;
  to: string;
  required: boolean;
}[] = [
  {
    id: 'funnel',
    title: 'Criar um funil comercial',
    hint: 'Funil → Gerenciar funis. Sem isso o WhatsApp não consegue jogar leads no kanban.',
    to: '/funil',
    required: true,
  },
  {
    id: 'whatsapp',
    title: 'Conectar um número WhatsApp',
    hint: 'Configurações → Credenciais. Zernio (oficial) ou Uazapi (não oficial).',
    to: '/settings/profile',
    required: true,
  },
  {
    id: 'team',
    title: 'Convidar a equipe',
    hint: 'Opcional. Configurações → Equipe. O e-mail sai pelo Auth do Supabase.',
    to: '/settings/profile',
    required: false,
  },
  {
    id: 'inbox',
    title: 'Receber a primeira mensagem de teste',
    hint: 'De outro celular, envie um WhatsApp para o número conectado e responda na Caixa.',
    to: '/inbox',
    required: false,
  },
];

function isDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(STORAGE_KEYS.setupChecklistDismissed) === '1';
}

export function SetupChecklist() {
  const { role } = useAppUser();
  const progress = useSetupProgress();
  const [hidden, setHidden] = useState(isDismissed);

  if (role !== 'admin' || hidden) return null;
  if (progress.loading) return null;

  const done = {
    funnel: progress.funnelReady,
    whatsapp: progress.whatsappReady,
    team: progress.teamReady,
    inbox: progress.inboxReady,
  };
  const requiredDone = STEPS.filter((s) => s.required).every((s) => done[s.id]);
  if (requiredDone && progress.inboxReady && progress.teamReady) return null;

  const completed = STEPS.filter((s) => done[s.id]).length;

  const dismiss = () => {
    window.localStorage.setItem(STORAGE_KEYS.setupChecklistDismissed, '1');
    setHidden(true);
  };

  return (
    <div className="glass-card p-5 sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[rgba(59,130,246,0.2)]">
            <ListChecks className="h-5 w-5 text-[var(--accent-primary)]" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Primeiros passos</h2>
            <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">
              {completed} de {STEPS.length} concluídos. O deploy já está no ar; falta ligar o uso.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dispensar checklist"
          className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <ol className="space-y-2">
        {STEPS.map((step, index) => {
          const ok = done[step.id];
          return (
            <li key={step.id}>
              <Link
                to={step.to}
                className="flex items-start gap-3 rounded-xl border border-[rgba(59,130,246,0.12)] bg-white/[0.02] px-3 py-3 transition hover:border-[rgba(59,130,246,0.35)]"
              >
                <span className="mt-0.5">
                  {ok ? (
                    <Check className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Circle className="h-4 w-4 text-[var(--color-text-secondary)]" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[var(--color-text-secondary)]">
                      {index + 1}.
                    </span>
                    <span
                      className={`text-sm font-medium ${ok ? 'text-[var(--color-text-secondary)] line-through' : 'text-[var(--color-text-primary)]'}`}
                    >
                      {step.title}
                    </span>
                    {!step.required && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                        opcional
                      </span>
                    )}
                  </span>
                  {!ok && (
                    <span className="mt-1 block text-xs text-[var(--color-text-secondary)]">{step.hint}</span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
