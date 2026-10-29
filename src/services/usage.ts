import { prisma } from '../lib/prisma';
import { accessState, currentPeriod } from '../plans';
import type { Workspace } from '@prisma/client';

export async function getUsage(workspaceId: string) {
  const row = await prisma.usage.findUnique({ where: { workspaceId_period: { workspaceId, period: currentPeriod() } } });
  return { conversations: row?.conversations ?? 0, aiReplies: row?.aiReplies ?? 0 };
}

async function bump(workspaceId: string, field: 'conversations' | 'aiReplies'): Promise<void> {
  const period = currentPeriod();
  await prisma.usage.upsert({
    where: { workspaceId_period: { workspaceId, period } },
    update: { [field]: { increment: 1 } },
    create: { workspaceId, period, [field]: 1 }
  });
}

/** A brand-new customer chat is about to start: allowed within the plan? Counts it when allowed. */
export async function admitConversation(ws: Workspace): Promise<boolean> {
  const { limits } = accessState(ws);
  if (limits.conversations !== Infinity && (await getUsage(ws.id)).conversations >= limits.conversations) return false;
  await bump(ws.id, 'conversations');
  return true;
}

/** May an AI-written answer be produced? Counts it when allowed. Over the limit the bot falls back to its fixed replies. */
export async function admitAiReply(ws: Workspace): Promise<boolean> {
  const { limits } = accessState(ws);
  if (limits.aiReplies !== Infinity && (await getUsage(ws.id)).aiReplies >= limits.aiReplies) return false;
  await bump(ws.id, 'aiReplies');
  return true;
}
