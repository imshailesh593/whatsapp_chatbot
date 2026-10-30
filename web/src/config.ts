import type { StageDef } from './types';

/** One small dot in the badge's own colour, so every service looks the same apart from its colour. */
const DOT = '●';
const BADGES = [
  'bg-blue-500/15 text-blue-300 border-blue-500/30',
  'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  'bg-purple-500/15 text-purple-300 border-purple-500/30',
  'bg-amber-500/15 text-amber-300 border-amber-500/30',
  'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  'bg-rose-500/15 text-rose-300 border-rose-500/30'
];

/** Services are defined per business, so the colour is derived from the service key. */
export function serviceStyle(key: string | null, title: string | null) {
  let h = 0;
  for (const ch of key ?? '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { icon: DOT, shortTitle: title ?? key ?? '', badge: BADGES[h % BADGES.length] };
}

export const COLOR_CLS: Record<string, string> = {
  emerald: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  blue: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  amber: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  purple: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  green: 'bg-green-500/20 text-green-300 border-green-500/40',
  rose: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  orange: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
  cyan: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  slate: 'bg-slate-500/20 text-slate-300 border-slate-500/40'
};

/** Label and badge classes for a contact's pipeline stage (null = still answering the questions). */
export function stageBadge(stages: StageDef[], pipeline: string | null): { label: string; cls: string } {
  if (pipeline === null) return { label: '⏳ Answering', cls: COLOR_CLS.amber };
  const s = stages.find((x) => x.key === pipeline);
  return { label: s?.label ?? pipeline, cls: COLOR_CLS[s?.color ?? 'slate'] ?? COLOR_CLS.slate };
}

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
