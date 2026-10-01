import { NavLink } from 'react-router-dom';
import { BarChart3 } from 'lucide-react';
import { NAV_ITEMS } from './nav-config';
import { useAppUser } from '@/app/providers/AppUserProvider';

export function Sidebar() {
  const { role } = useAppUser();
  return (
    <aside className="app-sidebar hidden md:flex md:flex-col w-60 shrink-0 sticky top-0 h-screen" aria-label="Navegação principal">
      <div className="h-20 flex items-center gap-3 px-6 text-white">
        <svg aria-hidden="true" viewBox="0 0 28 28" className="h-7 w-7"><rect width="28" height="28" rx="4" fill="currentColor"/><path d="M7 22 12.4 8.5 14.6 14 11.4 22ZM12.6 6H17L23 22h-4.6Z" fill="var(--sidebar-bg)"/></svg>
        <span className="text-[25px] font-medium tracking-[-0.04em]">Agentise</span>
      </div>
      <div className="flex items-center gap-3 px-5 pt-2 pb-7">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-white/5 text-blue-300"><BarChart3 className="h-4 w-4" /></div>
        <div className="text-xs leading-5"><div className="font-semibold text-slate-200">Central de vendas</div><div className="text-[var(--sidebar-muted)]">Meu workspace</div></div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3">
        <div className="px-3 pb-3 text-[10px] uppercase tracking-[0.15em] text-[var(--sidebar-muted)]">Gerenciar</div>
        <div className="space-y-1">{NAV_ITEMS.filter(item => !item.adminOnly || role === 'admin').map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className="sidebar-link"><Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.7} /><span>{label}</span></NavLink>
        ))}</div>
      </nav>
      <div className="mx-5 py-5 border-t border-white/10 text-xs text-[var(--sidebar-muted)]">Seu negócio, organizado.</div>
    </aside>
  );
}
