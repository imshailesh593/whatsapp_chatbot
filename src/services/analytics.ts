import { prisma } from '../lib/prisma';
import { loadConfig } from './botConfig';
import { getStages } from './pipeline';

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Everything the Analytics tab shows, computed on demand from sessions and leads (simulator chats excluded). */
export async function analytics(workspaceId: string, days: number) {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (days - 1));
  const [cfg, stages] = await Promise.all([loadConfig(workspaceId), getStages(workspaceId)]);
  const title = (key: string | null) => (key ? cfg.services.find((s) => s.key === key)?.title ?? key : 'No service chosen');

  const sessions = await prisma.session.findMany({
    where: { workspaceId, createdAt: { gte: since }, NOT: { phoneNumber: { startsWith: 'SIM-' } } },
    select: { id: true, createdAt: true, lastInteractionAt: true, stage: true, selectedService: true, currentStep: true, source: true, lead: { select: { createdAt: true, stageKey: true, serviceCategory: true } } }
  });

  const started = sessions.length;
  const pickedService = sessions.filter((s) => s.selectedService).length;
  const leads = sessions.filter((s) => s.lead);
  const closedWon = leads.filter((s) => stages.find((x) => x.key === s.lead!.stageKey)?.kind === 'won').length;
  const booked = leads.filter((s) => s.lead!.stageKey === 'booked').length;

  // minutes from first message to finished questionnaire
  const mins = leads.map((s) => (s.lead!.createdAt.getTime() - s.createdAt.getTime()) / 60_000).sort((a, b) => a - b);
  const median = mins.length ? mins[Math.floor(mins.length / 2)] : null;

  // per-day series (UTC days)
  const series: Record<string, { day: string; started: number; leads: number }> = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setUTCDate(d.getUTCDate() + i);
    series[dayKey(d)] = { day: dayKey(d), started: 0, leads: 0 };
  }
  for (const s of sessions) series[dayKey(s.createdAt)] && series[dayKey(s.createdAt)].started++;
  for (const s of leads) series[dayKey(s.lead!.createdAt)] && series[dayKey(s.lead!.createdAt)].leads++;

  // by service
  const byService = new Map<string, { key: string | null; title: string; started: number; leads: number }>();
  for (const s of sessions) {
    const k = s.selectedService ?? '__none';
    const row = byService.get(k) ?? { key: s.selectedService, title: title(s.selectedService), started: 0, leads: 0 };
    row.started++;
    if (s.lead) row.leads++;
    byService.set(k, row);
  }

  // by campaign tag
  const bySource = new Map<string, { source: string; started: number; leads: number }>();
  for (const s of sessions) {
    const k = s.source ?? '(direct)';
    const row = bySource.get(k) ?? { source: k, started: 0, leads: 0 };
    row.started++;
    if (s.lead) row.leads++;
    bySource.set(k, row);
  }

  // where people give up: chats that stopped mid-questionnaire for over a day
  const cutoff = Date.now() - 86_400_000;
  const drops = new Map<string, { service: string; question: string; count: number }>();
  for (const s of sessions) {
    if (s.lead || s.stage !== 'IN_QUESTIONNAIRE' || s.lastInteractionAt.getTime() > cutoff) continue;
    const svc = cfg.services.find((x) => x.key === s.selectedService);
    const q = svc?.questions[s.currentStep];
    if (!svc || !q) continue;
    const k = `${svc.key}:${s.currentStep}`;
    const row = drops.get(k) ?? { service: svc.title, question: `Q${s.currentStep + 1}: ${q.prompt}`, count: 0 };
    row.count++;
    drops.set(k, row);
  }

  const byStage = stages.map((st) => ({ key: st.key, label: st.label, color: st.color, count: leads.filter((s) => s.lead!.stageKey === st.key).length }));

  return {
    days,
    totals: {
      started,
      pickedService,
      leads: leads.length,
      booked,
      won: closedWon,
      completionRate: started ? leads.length / started : 0,
      medianMinutesToComplete: median === null ? null : Math.round(median * 10) / 10
    },
    series: Object.values(series),
    byService: [...byService.values()].sort((a, b) => b.started - a.started),
    bySource: [...bySource.values()].sort((a, b) => b.started - a.started).slice(0, 12),
    byStage,
    dropOffs: [...drops.values()].sort((a, b) => b.count - a.count).slice(0, 8)
  };
}
