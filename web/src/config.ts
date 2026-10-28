import type { ServiceId, Status } from './types';

export const SERVICE_STYLE: Record<ServiceId, { icon: string; shortTitle: string; badge: string }> = {
  COACHING: { icon: '📚', shortTitle: 'Coaching', badge: 'bg-blue-100 text-blue-800 border-blue-200' },
  LICENSING: { icon: '🩺', shortTitle: 'Licensing', badge: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  JOBS: { icon: '💼', shortTitle: 'Overseas Jobs', badge: 'bg-purple-100 text-purple-800 border-purple-200' },
  VISA_PR: { icon: '✈️', shortTitle: 'Visa & PR', badge: 'bg-amber-100 text-amber-800 border-amber-200' },
  GENERAL: { icon: '🌐', shortTitle: 'General Enquiry', badge: 'bg-slate-100 text-slate-800 border-slate-200' }
};

export const STATUS_STYLE: Record<Status, { label: string; cls: string }> = {
  CONSULTATION_BOOKED: { label: '🗓 Topmate Booked', cls: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
  COMPLETED: { label: '✓ Qualified', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
  IN_PROGRESS: { label: '⏳ Answering', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  FOLLOW_UP: { label: '📞 Follow-up', cls: 'bg-blue-500/20 text-blue-300 border-blue-500/40' }
};

export const humanize = (key: string) => key.replace(/_/g, ' ');

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export const displayPhone = (p: string) => (/^\d+$/.test(p) ? `+${p}` : p);
export const waLink = (p: string) => `https://wa.me/${p.replace(/\D/g, '')}`;
