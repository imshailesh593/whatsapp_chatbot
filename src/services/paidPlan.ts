import { prisma } from '../lib/prisma';
import { planById } from '../plans';
import { invalidateConfig } from './botConfig';

/** Days of access one payment buys when the customer pays by link or reference instead of a card subscription. */
export const LINK_DAYS = 30;

/**
 * Switches a plan on (or extends it) for LINK_DAYS days after a confirmed payment.
 * Paying again for the same plan before it ends adds days; a different plan starts now.
 * Returns false when the business or plan is unknown, or the business is not billed.
 */
export async function activatePaidPlan(workspaceId: string, planId: string, provider: 'razorpay_link' | 'manual_pay'): Promise<boolean> {
  const plan = planById(planId);
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!plan || !ws || ws.plan === 'internal') return false;
  const now = Date.now();
  const stacking = ws.plan === plan.id && ws.planStatus === 'active' && !!ws.currentPeriodEnd && ws.currentPeriodEnd.getTime() > now;
  const from = stacking ? ws.currentPeriodEnd!.getTime() : now;
  await prisma.workspace.update({
    where: { id: ws.id },
    data: { plan: plan.id, planStatus: 'active', currentPeriodEnd: new Date(from + LINK_DAYS * 86_400_000), cancelAtPeriodEnd: false, billingProvider: provider, providerSubscriptionId: null }
  });
  invalidateConfig(ws.id);
  return true;
}
