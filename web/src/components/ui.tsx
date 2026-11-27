import { ReactNode, useEffect, useState } from 'react';
import { Menu, Moon, PanelLeftClose, PanelLeftOpen, Sun, X } from 'lucide-react';
import { useTheme } from '../theme';
import Logo from './Logo';

/** Light / dark switch used in every top bar. */
export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  return (
    <button
      onClick={toggle}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label="Toggle light and dark mode"
      className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-line bg-card text-muted hover:text-fg hover:border-line-strong transition"
    >
      {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}

export interface NavEntry {
  id: string;
  label: string;
  icon: ReactNode;
  badge?: ReactNode;
}

export interface NavGroup {
  label?: string;
  items: NavEntry[];
}

/** The page frame shared by the business console and the platform admin: sidebar, top bar, page header. */
export function AppShell({
  brand, subtitle, groups, active, onSelect, sidebarFooter, topRight, title, description, headerRight, banners, children
}: {
  brand: string;
  subtitle?: string;
  groups: NavGroup[];
  active: string;
  onSelect: (id: string) => void;
  sidebarFooter?: ReactNode;
  topRight?: ReactNode;
  title: string;
  description?: string;
  headerRight?: ReactNode;
  banners?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // the desktop sidebar can shrink to an icon rail; the choice is remembered in this browser
  const [rail, setRail] = useState(() => { try { return localStorage.getItem('lk_rail') === '1'; } catch { return false; } });
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null);
  const toggleRail = () => setRail((v) => { const n = !v; try { localStorage.setItem('lk_rail', n ? '1' : '0'); } catch { /* ignore */ } return n; });
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const navFor = (c: boolean) => (
    <nav className={`flex-1 overflow-y-auto py-3 space-y-5 ${c ? 'px-2' : 'px-3'}`}>
      {groups.map((g, gi) => (
        <div key={gi}>
          {g.label && !c && <p className="px-3 mb-1.5 text-[12.5px] font-semibold uppercase tracking-wider text-muted">{g.label}</p>}
          {g.label && c && gi > 0 && <div className="mx-3 mb-2 border-t border-line" />}
          <div className="space-y-0.5">
            {g.items.map((n) => {
              const on = n.id === active;
              return (
                <button
                  key={n.id}
                  onClick={() => { onSelect(n.id); setOpen(false); }}
                  aria-current={on ? 'page' : undefined}
                  aria-label={n.label}
                  onMouseEnter={c ? (e) => { const r = e.currentTarget.getBoundingClientRect(); setTip({ label: n.label, top: r.top + r.height / 2 }); } : undefined}
                  onMouseLeave={c ? () => setTip(null) : undefined}
                  className={`relative w-full flex items-center ${c ? 'justify-center h-12 [&_svg]:w-[22px] [&_svg]:h-[22px]' : 'gap-3 px-3 py-2'} rounded-xl text-sm transition ${
                    on ? 'bg-brand-soft text-brand-text font-semibold' : 'text-fg2 hover:bg-subtle hover:text-fg font-medium'
                  }`}
                >
                  <span className={`shrink-0 ${on ? 'text-brand-text' : 'text-muted'}`}>{n.icon}</span>
                  {!c && <span className="truncate">{n.label}</span>}
                  {!c && n.badge !== undefined && <span className="ml-auto">{n.badge}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const sidebarFor = (c: boolean) => (
    <>
      <div className={`h-16 shrink-0 flex items-center border-b border-line ${c ? 'justify-center' : 'px-5 gap-3'}`}>
        <Logo size={36} />
        {!c && <div className="min-w-0">
          <div className="font-semibold text-fg leading-tight truncate" title={brand}>{brand}</div>
          {subtitle && <div className="text-[12.5px] text-muted leading-tight truncate mt-0.5" title={subtitle}>{subtitle}</div>}
        </div>}
      </div>
      {navFor(c)}
      {sidebarFooter && !c && <div className="shrink-0 p-3 border-t border-line">{sidebarFooter}</div>}
      {c && (
        <div className="shrink-0 p-2 border-t border-line">
          <button onClick={toggleRail} aria-label="Expand the sidebar"
            onMouseEnter={(e) => { const r = e.currentTarget.getBoundingClientRect(); setTip({ label: 'Expand the sidebar', top: r.top + r.height / 2 }); }} onMouseLeave={() => setTip(null)}
            className="w-full h-12 flex items-center justify-center rounded-xl text-muted hover:bg-subtle hover:text-fg transition"><PanelLeftOpen className="w-[22px] h-[22px]" /></button>
        </div>
      )}
    </>
  );

  return (
    <div className="min-h-screen bg-app text-fg">
      {rail && tip && <div className="hidden lg:block fixed z-50 left-[80px] -translate-y-1/2 px-3 py-1.5 rounded-lg bg-fg text-app text-sm font-semibold shadow-pop pointer-events-none whitespace-nowrap" style={{ top: tip.top }}>{tip.label}</div>}
      <aside className={`hidden lg:flex fixed inset-y-0 left-0 ${rail ? 'w-[72px]' : 'w-64'} flex-col bg-card border-r border-line z-40 transition-[width] duration-200`}>{sidebarFor(rail)}</aside>

      {open && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] flex flex-col bg-card border-r border-line shadow-pop">
            <button onClick={() => setOpen(false)} aria-label="Close menu" className="absolute top-4 right-3 p-1.5 text-muted hover:text-fg"><X className="w-4 h-4" /></button>
            {sidebarFor(false)}
          </aside>
        </div>
      )}

      <div className={`${rail ? 'lg:pl-[72px]' : 'lg:pl-64'} min-h-screen flex flex-col transition-[padding] duration-200`}>
        <header className="sticky top-0 z-30 h-16 bg-card/85 backdrop-blur border-b border-line px-4 lg:px-8 flex items-center gap-3">
          <button onClick={() => setOpen(true)} aria-label="Open menu" className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg border border-line text-fg2"><Menu className="w-4 h-4" /></button>
          <button onClick={toggleRail} aria-label={rail ? 'Expand the sidebar' : 'Collapse the sidebar'} title={rail ? 'Expand the sidebar' : 'Collapse the sidebar'} className="hidden lg:inline-flex items-center justify-center w-9 h-9 rounded-lg border border-line bg-card text-muted hover:text-fg hover:border-line-strong transition">
            {rail ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
          <div className="lg:hidden flex items-center gap-2 min-w-0"><Logo size={28} /><span className="hidden sm:inline font-semibold truncate max-w-[30vw]">{brand}</span></div>
          <div className="ml-auto flex items-center gap-2">{topRight}</div>
        </header>
        <main className="flex-1 w-full max-w-[1400px] mx-auto px-4 lg:px-8 py-6 lg:py-8">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
              {description && <p className="text-sm text-muted mt-1 max-w-2xl">{description}</p>}
            </div>
            {headerRight}
          </div>
          {banners}
          {children}
        </main>
      </div>
    </div>
  );
}

/** A coloured note at the top of the page (payment problem, bot paused, ...). */
export function Banner({ tone, children, action }: { tone: 'danger' | 'warn' | 'info'; children: ReactNode; action?: ReactNode }) {
  const cls = tone === 'danger' ? 'bg-danger-soft border-danger-line text-danger' : tone === 'warn' ? 'bg-warn-soft border-warn-line text-warn' : 'bg-info-soft border-info-line text-info';
  return (
    <div className={`mb-4 px-4 py-3 rounded-xl border text-sm flex flex-wrap items-center justify-between gap-3 ${cls}`}>
      <span className="font-medium">{children}</span>
      {action}
    </div>
  );
}

/** A headline number with a label and a small tinted icon. */
export function Stat({ label, value, icon, tone = 'brand', hint }: { label: string; value: ReactNode; icon: ReactNode; tone?: 'brand' | 'info' | 'violet' | 'warn'; hint?: string }) {
  const tint = tone === 'brand' ? 'bg-brand-soft text-brand-text' : tone === 'info' ? 'bg-info-soft text-info' : tone === 'violet' ? 'bg-violet-soft text-violet' : 'bg-warn-soft text-warn';
  return (
    <div className="bg-card border border-line rounded-2xl shadow-card p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted">{label}</p>
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${tint}`}>{icon}</span>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-fg tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}
