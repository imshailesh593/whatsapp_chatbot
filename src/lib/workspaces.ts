import { prisma } from './prisma';
import { hashPassword } from './auth';
import { TRIAL_DAYS } from '../plans';
import { DEFAULT_STAGES } from '../services/pipeline';

export const DEFAULT_WORKSPACE_ID = 'default-workspace';

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'business';

/** Creates a tenant and its first (owner) user. The bot stays paused until the owner goes live. */
export async function createWorkspaceWithOwner(opts: { businessName: string; email: string; password: string; referredById?: string | null; bonusTrialDays?: number }) {
  const base = slugify(opts.businessName);
  let slug = base;
  for (let n = 2; await prisma.workspace.findUnique({ where: { slug } }); n++) slug = `${base}-${n}`;
  const passwordHash = await hashPassword(opts.password);
  return prisma.workspace.create({
    data: {
      slug,
      name: opts.businessName,
      businessName: opts.businessName,
      botEnabled: false,
      stages: { create: DEFAULT_STAGES.map((s, position) => ({ ...s, position })) },
      referredById: opts.referredById ?? null,
      trialEndsAt: new Date(Date.now() + (TRIAL_DAYS + (opts.referredById ? opts.bonusTrialDays ?? 0 : 0)) * 86_400_000),
      adminUsers: { create: { email: opts.email, passwordHash, role: 'owner' } }
    },
    include: { adminUsers: true }
  });
}
