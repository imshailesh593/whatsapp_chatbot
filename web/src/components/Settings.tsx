import type { ReactNode } from 'react';
import { Bell, CalendarDays, CreditCard, Gift, GitBranch, MessageCircle, Plug, QrCode, Users } from 'lucide-react';
import type { AdminUser, Overview } from '../types';
import Admins from './Admins';
import WhatsAppLink from './WhatsAppLink';
import BusinessProfile from './BusinessProfile';
import BotBuilder from './BotBuilder';
import Billing from './Billing';
import PipelineEditor from './PipelineEditor';
import Integrations from './Integrations';
import Appointments from './Appointments';
import ReferAndEarn from './ReferAndEarn';

const ic = 'w-4 h-4';

const SECTIONS: { id: string; label: string; hint: string; icon: ReactNode }[] = [
  { id: 'whatsapp', label: 'WhatsApp', hint: 'Link your number', icon: <QrCode className={ic} /> },
  { id: 'business', label: 'Business & bot', hint: 'Greeting, facts, answers', icon: <Bell className={ic} /> },
  { id: 'menu', label: 'Menu & questions', hint: 'What the bot asks', icon: <MessageCircle className={ic} /> },
  { id: 'booking', label: 'Appointments', hint: 'Dates and times', icon: <CalendarDays className={ic} /> },
  { id: 'pipeline', label: 'Pipeline', hint: 'Lead stages', icon: <GitBranch className={ic} /> },
  { id: 'integrations', label: 'Integrations', hint: 'Webhooks and API', icon: <Plug className={ic} /> },
  { id: 'billing', label: 'Plan & billing', hint: 'Subscription', icon: <CreditCard className={ic} /> },
  { id: 'referral', label: 'Refer & earn', hint: 'Share and get paid', icon: <Gift className={ic} /> },
  { id: 'team', label: 'Team', hint: 'People and roles', icon: <Users className={ic} /> }
];

export default function Settings({ overview, me, onChanged, section, onSection }: { overview: Overview; me: AdminUser; onChanged: () => void; section: string; onSection: (s: string) => void }) {
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[230px_minmax(0,1fr)] gap-6 items-start">
      <nav aria-label="Settings sections" className="lg:sticky lg:top-24 -mx-4 px-4 lg:mx-0 lg:px-0 flex lg:flex-col gap-1 overflow-x-auto pb-1 lg:pb-0">
        {SECTIONS.map((s) => {
          const on = s.id === current.id;
          return (
            <button
              key={s.id}
              onClick={() => onSection(s.id)}
              aria-current={on ? 'page' : undefined}
              className={`shrink-0 flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition border ${
                on ? 'bg-card border-line shadow-card text-fg' : 'border-transparent text-fg2 hover:bg-subtle'
              }`}
            >
              <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${on ? 'bg-brand-soft text-brand-text' : 'bg-subtle text-muted'}`}>{s.icon}</span>
              <span className="min-w-0">
                <span className="block text-sm font-medium whitespace-nowrap">{s.label}</span>
                <span className="hidden lg:block text-[11px] text-muted truncate">{s.hint}</span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="min-w-0">
        {current.id === 'whatsapp' && <WhatsAppLink onChanged={onChanged} />}
        {current.id === 'business' && <BusinessProfile workspace={overview.workspace} onSaved={onChanged} />}
        {current.id === 'menu' && <BotBuilder overview={overview} onSaved={onChanged} />}
        {current.id === 'booking' && <Appointments me={me} />}
        {current.id === 'pipeline' && <PipelineEditor stages={overview.stages} onSaved={onChanged} />}
        {current.id === 'integrations' && <Integrations />}
        {current.id === 'billing' && <Billing me={me} />}
        {current.id === 'referral' && <ReferAndEarn me={me} />}
        {current.id === 'team' && <Admins me={me} />}
      </div>
    </div>
  );
}
