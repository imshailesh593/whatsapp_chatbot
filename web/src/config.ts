import type { StageDef } from './types';

/** One small dot in the badge's own colour, so every service looks the same apart from its colour. */
const DOT = '●';
const BADGES = [
  'bg-info-soft text-info border-info-line/30',
  'bg-brand-soft text-brand-text border-brand/30',
  'bg-violet-soft text-violet border-violet-line/30',
  'bg-warn-soft text-warn border-warn-line/30',
  'bg-info-soft text-info border-info-line/30',
  'bg-danger-soft text-danger border-danger-line/30'
];

/** Services are defined per business, so the colour is derived from the service key. */
export function serviceStyle(key: string | null, title: string | null) {
  let h = 0;
  for (const ch of key ?? '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { icon: DOT, shortTitle: title ?? key ?? '', badge: BADGES[h % BADGES.length] };
}

export const COLOR_CLS: Record<string, string> = {
  emerald: 'bg-brand-soft text-brand-text border-brand/40',
  blue: 'bg-info-soft text-info border-info-line/40',
  amber: 'bg-warn-soft text-warn border-warn-line/40',
  purple: 'bg-violet-soft text-violet border-violet-line/40',
  green: 'bg-brand-soft text-brand-text border-brand/40',
  rose: 'bg-danger-soft text-danger border-danger-line/40',
  orange: 'bg-warn-soft text-warn border-warn-line/40',
  cyan: 'bg-info-soft text-info border-info-line/40',
  slate: 'bg-muted/20 text-fg2 border-line-strong/40'
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
