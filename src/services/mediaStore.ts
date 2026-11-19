import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

/** Photos, videos and documents shown in the Inbox live on disk next to the WhatsApp session (the same persistent volume). */
const base = () => path.resolve(process.env.MEDIA_PATH || path.join(path.dirname(path.resolve(process.env.WA_SESSION_PATH || '.wa_auth')), 'media'));

export interface StoredMedia {
  id: string;
  kind: 'image' | 'video' | 'document';
  mime: string;
  name: string;
  size: number;
  caption?: string;
}

const UUID = /^[0-9a-f-]{36}$/;
export const fileOf = (workspaceId: string, id: string): string | null => (UUID.test(id) && /^[A-Za-z0-9_-]+$/.test(workspaceId) ? path.join(base(), workspaceId, id) : null);

/** Writes the bytes and returns what the chat log keeps about the file. */
export function saveMedia(workspaceId: string, buffer: Buffer, meta: Omit<StoredMedia, 'id' | 'size'>): StoredMedia {
  const id = randomUUID();
  const file = fileOf(workspaceId, id)!;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, buffer, { mode: 0o600 });
  return { id, size: buffer.length, ...meta };
}

/** What a browser may show inline; everything else is offered as a download. */
const INLINE = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|quicktime|3gpp|webm)|application\/pdf)$/;
export const servedType = (mime: string) => (INLINE.test(mime) ? { type: mime, inline: true } : { type: 'application/octet-stream', inline: false });
