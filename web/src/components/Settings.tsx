import type { AdminUser, Overview } from '../types';
import Admins from './Admins';
import WhatsAppLink from './WhatsAppLink';
import BusinessProfile from './BusinessProfile';
import BotBuilder from './BotBuilder';
import Billing from './Billing';

export default function Settings({ overview, me, onChanged }: { overview: Overview; me: AdminUser; onChanged: () => void }) {
  return (
    <div className="space-y-6">
      <WhatsAppLink onChanged={onChanged} />
      <BusinessProfile workspace={overview.workspace} onSaved={onChanged} />
      <BotBuilder overview={overview} onSaved={onChanged} />
      <Billing me={me} />
      <Admins me={me} />
    </div>
  );
}
