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

export default function Settings({ overview, me, onChanged }: { overview: Overview; me: AdminUser; onChanged: () => void }) {
  return (
    <div className="space-y-6">
      <WhatsAppLink onChanged={onChanged} />
      <BusinessProfile workspace={overview.workspace} onSaved={onChanged} />
      <BotBuilder overview={overview} onSaved={onChanged} />
      <Appointments me={me} />
      <PipelineEditor stages={overview.stages} onSaved={onChanged} />
      <Integrations />
      <Billing me={me} />
      <ReferAndEarn me={me} />
      <Admins me={me} />
    </div>
  );
}
