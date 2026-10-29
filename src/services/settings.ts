import { prisma } from '../lib/prisma';

const cache = new Map<string, { at: number; value: unknown }>();

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10_000) return hit.value as T;
  const row = await prisma.setting.findUnique({ where: { key } });
  const value = (row ? row.value : fallback) as T;
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await prisma.setting.upsert({ where: { key }, update: { value: value as any }, create: { key, value: value as any } });
  cache.delete(key);
}
