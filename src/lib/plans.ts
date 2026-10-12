export type CommercialPlan = 'inicial' | 'intermediario' | 'avancado';

export type PlanFeature =
  | 'dashboard_basic'
  | 'dashboard_sales'
  | 'dashboard_origin'
  | 'inbox'
  | 'funil'
  | 'contacts'
  | 'campaigns'
  | 'settings_account'
  | 'settings_credentials'
  | 'settings_team'
  | 'settings_products'
  | 'lead_assignment';

export const PLAN_ORDER: CommercialPlan[] = ['inicial', 'intermediario', 'avancado'];

export const PLANS: Record<
  CommercialPlan,
  { id: CommercialPlan; name: string; price: number; tagline: string; includes: string[] }
> = {
  inicial: {
    id: 'inicial',
    name: 'Inicial',
    price: 297,
    tagline: 'Atendimento e funil no dia a dia.',
    includes: [
      'Caixa de entrada WhatsApp',
      'Contatos e funil comercial',
      'Dashboard de vendas ganhas/perdidas',
      'Conectar número (Credenciais)',
    ],
  },
  intermediario: {
    id: 'intermediario',
    name: 'Intermediário',
    price: 497,
    tagline: 'Escala o time e o disparo.',
    includes: [
      'Tudo do Inicial',
      'Disparos em massa e templates',
      'Catálogo de produtos',
      'Convites de equipe',
      'Ranking, forecast e tempos no dashboard',
    ],
  },
  avancado: {
    id: 'avancado',
    name: 'Avançado',
    price: 897,
    tagline: 'Origem de tráfego e fila automática.',
    includes: [
      'Tudo do Intermediário',
      'Widgets de origem (UTM / campanha / ads)',
      'Personalizar dashboard',
      'Fila de atribuição automática de leads',
    ],
  },
};

export const FEATURE_MIN_PLAN: Record<PlanFeature, CommercialPlan> = {
  dashboard_basic: 'inicial',
  inbox: 'inicial',
  funil: 'inicial',
  contacts: 'inicial',
  settings_account: 'inicial',
  settings_credentials: 'inicial',
  dashboard_sales: 'intermediario',
  campaigns: 'intermediario',
  settings_team: 'intermediario',
  settings_products: 'intermediario',
  dashboard_origin: 'avancado',
  lead_assignment: 'avancado',
};

export const SCREEN_TEMPLATES: Record<
  PlanFeature,
  { title: string; body: string }
> = {
  dashboard_basic: {
    title: 'Dashboard',
    body: 'Indicadores de vendas ganhas e perdidas no plano Inicial.',
  },
  dashboard_sales: {
    title: 'Dashboard comercial completo',
    body: 'Ranking, forecast e tempos de atendimento entram no plano Intermediário (R$ 497).',
  },
  dashboard_origin: {
    title: 'Origem do tráfego',
    body: 'UTM, campanha, anúncios e posts orgânicos são do plano Avançado (R$ 897).',
  },
  inbox: {
    title: 'Caixa de entrada',
    body: 'Conversas do WhatsApp conectado. Incluso no Inicial.',
  },
  funil: {
    title: 'Funil',
    body: 'Kanban de negócios. Incluso no Inicial.',
  },
  contacts: {
    title: 'Contatos',
    body: 'Base, importação e tags. Incluso no Inicial.',
  },
  campaigns: {
    title: 'Disparos em massa',
    body: 'Campanhas e templates oficiais/não oficiais. Plano Intermediário (R$ 497).',
  },
  settings_account: {
    title: 'Conta',
    body: 'E-mail, senha e som. Incluso em todos os planos.',
  },
  settings_credentials: {
    title: 'Credenciais WhatsApp',
    body: 'Zernio e Uazapi. Incluso no Inicial para o número funcionar.',
  },
  settings_team: {
    title: 'Equipe',
    body: 'Convites de admin/operador. Plano Intermediário (R$ 497).',
  },
  settings_products: {
    title: 'Produtos',
    body: 'Catálogo atribuível aos leads. Plano Intermediário (R$ 497).',
  },
  lead_assignment: {
    title: 'Atribuição automática',
    body: 'Fila e rodízio de leads. Plano Avançado (R$ 897).',
  },
};

export function parsePlan(value: unknown): CommercialPlan {
  if (value === 'inicial' || value === 'intermediario' || value === 'avancado') return value;
  return 'avancado';
}

export function planRank(plan: CommercialPlan): number {
  return PLAN_ORDER.indexOf(plan);
}

export function hasPlanFeature(plan: CommercialPlan, feature: PlanFeature): boolean {
  return planRank(plan) >= planRank(FEATURE_MIN_PLAN[feature]);
}

export function formatPlanPrice(plan: CommercialPlan): string {
  return PLANS[plan].price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
