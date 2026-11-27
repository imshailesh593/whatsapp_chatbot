import { prisma } from '../lib/prisma';
import { photoTag } from '../lib/photoTag';
import { joinParts, splitMessage } from '../lib/split';
import type { BotConfig, BotService } from './botConfig';

/**
 * Photos attached to saved messages. They are kept in the database (so backups include them and the 90-day sweep of chat
 * attachments never removes them). Which message uses which photo is stored on the workspace as "photoId:part", where part
 * says which of a split message's parts the photo goes with.
 */

/** The photo sent with the very first reply to a new customer, whether Gemini or the menu writes it. */
export const FIRST_REPLY = 'firstReply';

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export interface PhotoRef {
  id: string;
  part: number;
}

export function parsePhotoRef(value: unknown): PhotoRef | null {
  const m = /^([0-9a-f-]{36}):([0-2])$/.exec(String(value ?? ''));
  return m ? { id: m[1], part: Number(m[2]) } : null;
}

export const refString = (ref: PhotoRef | null) => (ref ? `${ref.id}:${ref.part}` : '');

export const photoMap = (value: unknown): Record<string, string> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, string>) : {});

export const photoFor = (cfg: BotConfig, messageId: string): PhotoRef | null => parsePhotoRef(photoMap(cfg.ws.messagePhotos)[messageId]);

/** The saved text, with its photo's tag in front of the part the photo goes with. */
export function withPhoto(cfg: BotConfig, messageId: string, text: string): string {
  const ref = photoFor(cfg, messageId);
  if (!ref) return text;
  const parts = splitMessage(text);
  if (!parts.length) return text;
  const at = Math.min(ref.part, parts.length - 1);
  parts[at] = `${photoTag(ref.id)} ${parts[at]}`;
  return parts.length > 1 ? joinParts(parts) : parts[0];
}

/** A service's question in the owner's exact wording, with its photo. */
export const questionText = (cfg: BotConfig, service: BotService, index: number) =>
  withPhoto(cfg, `question.${service.key}.${service.questions[index].key}`, service.questions[index].prompt);

/** JPG and PNG only: both show as ordinary photos on WhatsApp. Judged by the file's own first bytes, not its name. */
export function photoType(b: Buffer): 'image/jpeg' | 'image/png' | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png';
  return null;
}

export async function loadPhoto(workspaceId: string, id: string): Promise<{ mime: string; data: Buffer } | null> {
  const row = await prisma.messagePhoto.findFirst({ where: { id, workspaceId } });
  return row ? { mime: row.mime, data: Buffer.from(row.data) } : null;
}

/** Stores an upload. Nothing uses it until a message is saved with it; uploads never saved are cleared after a day. */
export async function storePhoto(workspaceId: string, data: Buffer, mime: string): Promise<string> {
  await removeUnusedPhotos(workspaceId);
  const row = await prisma.messagePhoto.create({ data: { workspaceId, mime, data: new Uint8Array(data) } });
  return row.id;
}

async function removeUnusedPhotos(workspaceId: string): Promise<void> {
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { messagePhotos: true } });
  const history = await prisma.messageRevision.findMany({ where: { workspaceId }, select: { beforePhoto: true, afterPhoto: true } });
  const used = [...Object.values(photoMap(ws.messagePhotos)), ...history.flatMap((r) => [r.beforePhoto, r.afterPhoto])]
    .map((v) => parsePhotoRef(v)?.id)
    .filter((id): id is string => !!id);
  await prisma.messagePhoto.deleteMany({ where: { workspaceId, id: { notIn: used }, createdAt: { lt: new Date(Date.now() - 86_400_000) } } });
}
