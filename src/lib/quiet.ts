import type { Prisma } from '@prisma/client';

/** After a customer is sent the consultation link, nothing is sent to them on the business's own initiative (follow-ups, broadcasts) for this long. */
export const LINK_QUIET_DAYS = 7;

/** Sessions that are not in that quiet period (the link was never sent, or was sent longer ago). */
export const outsideLinkQuiet = (now = Date.now()): Prisma.SessionWhereInput => ({
  OR: [{ consultLinkSentAt: null }, { consultLinkSentAt: { lt: new Date(now - LINK_QUIET_DAYS * 86_400_000) } }]
});
