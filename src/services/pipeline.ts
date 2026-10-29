import { prisma } from '../lib/prisma';

export interface StageDef {
  key: string;
  label: string;
  color: string;
  kind: 'open' | 'won' | 'lost';
}

export const COLORS = ['emerald', 'blue', 'amber', 'purple', 'green', 'rose', 'slate', 'orange', 'cyan'] as const;
/** The bot depends on these two: "new" is where leads start, "booked" is set when a customer confirms a booking. */
export const SYSTEM_STAGES = ['new', 'booked'] as const;
export const MAX_STAGES = 12;

export const DEFAULT_STAGES: StageDef[] = [
  { key: 'new', label: 'New lead', color: 'emerald', kind: 'open' },
  { key: 'contacted', label: 'Contacted', color: 'blue', kind: 'open' },
  { key: 'follow_up', label: 'Follow-up', color: 'amber', kind: 'open' },
  { key: 'booked', label: 'Booked', color: 'purple', kind: 'open' },
  { key: 'won', label: 'Won', color: 'green', kind: 'won' },
  { key: 'lost', label: 'Lost', color: 'rose', kind: 'lost' }
];

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);

/** Returns the workspace's pipeline, creating the default one the first time. */
export async function getStages(workspaceId: string): Promise<StageDef[]> {
  let rows = await prisma.stage.findMany({ where: { workspaceId }, orderBy: { position: 'asc' } });
  if (rows.length === 0) {
    await prisma.stage.createMany({
      data: DEFAULT_STAGES.map((s, position) => ({ workspaceId, position, ...s })),
      skipDuplicates: true
    });
    rows = await prisma.stage.findMany({ where: { workspaceId }, orderBy: { position: 'asc' } });
  }
  return rows.map((r) => ({ key: r.key, label: r.label, color: r.color, kind: r.kind as StageDef['kind'] }));
}

/** Replaces the pipeline. Leads sitting in a removed stage fall back to "new". Throws a readable Error when invalid. */
export async function saveStages(workspaceId: string, input: unknown): Promise<StageDef[]> {
  if (!Array.isArray(input) || input.length < 2) throw new Error('A pipeline needs at least two stages');
  if (input.length > MAX_STAGES) throw new Error(`At most ${MAX_STAGES} stages are supported`);
  const used = new Set<string>();
  const stages: StageDef[] = input.map((raw: any, i) => {
    const label = String(raw?.label ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!label) throw new Error(`Stage ${i + 1} needs a name`);
    let key = slug(String(raw?.key ?? '')) || slug(label) || `stage_${i + 1}`;
    for (let n = 2; used.has(key); n++) key = `${key.replace(/_\d+$/, '')}_${n}`;
    used.add(key);
    const color = (COLORS as readonly string[]).includes(raw?.color) ? raw.color : 'slate';
    const kind = raw?.kind === 'won' || raw?.kind === 'lost' ? raw.kind : 'open';
    return { key, label, color, kind };
  });
  for (const k of SYSTEM_STAGES) if (!used.has(k)) throw new Error(`The "${k === 'new' ? 'New lead' : 'Booked'}" stage is used by the bot and cannot be removed`);
  if (stages[0].key !== 'new') throw new Error('"New lead" must stay the first stage');

  await prisma.$transaction(async (tx) => {
    await tx.lead.updateMany({ where: { workspaceId, stageKey: { notIn: stages.map((s) => s.key) } }, data: { stageKey: 'new' } });
    await tx.stage.deleteMany({ where: { workspaceId } });
    await tx.stage.createMany({ data: stages.map((s, position) => ({ workspaceId, position, ...s })) });
  });
  return stages;
}

export async function stageExists(workspaceId: string, key: string): Promise<boolean> {
  return (await getStages(workspaceId)).some((s) => s.key === key);
}
