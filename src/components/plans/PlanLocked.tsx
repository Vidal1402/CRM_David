import { Lock } from 'lucide-react';
import { FEATURE_MIN_PLAN, PLANS, SCREEN_TEMPLATES, formatPlanPrice, type PlanFeature } from '@/lib/plans';

export function PlanLocked({ feature }: { feature: PlanFeature }) {
  const copy = SCREEN_TEMPLATES[feature];
  const needed = FEATURE_MIN_PLAN[feature];
  const plan = PLANS[needed];

  return (
    <div className="glass-card mx-auto max-w-xl p-8 text-center">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl border border-[rgba(59,130,246,0.2)]">
        <Lock className="h-5 w-5 text-[var(--accent-primary)]" />
      </div>
      <div className="text-label">Plano {plan.name}</div>
      <h2 className="mt-1 text-2xl font-bold text-display">{copy.title}</h2>
      <p className="mx-auto mt-3 max-w-md text-sm text-[var(--color-text-secondary)]">{copy.body}</p>
      <div className="mt-6 rounded-xl border border-[rgba(59,130,246,0.15)] bg-white/[0.03] px-4 py-3 text-sm">
        <div className="font-semibold text-[var(--color-text-primary)]">
          {plan.name} · {formatPlanPrice(needed)}
        </div>
        <ul className="mt-2 space-y-1 text-left text-[var(--color-text-secondary)]">
          {plan.includes.map((item) => (
            <li key={item}>· {item}</li>
          ))}
        </ul>
      </div>
      <p className="mt-4 text-xs text-[var(--color-text-secondary)]">
        O admin altera o plano em Configurações → Equipe. Isto não cria um CRM novo: é o recorte desta instalação.
      </p>
    </div>
  );
}
