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

/** A deleted business takes its files with it. */
export function removeWorkspaceMedia(workspaceId: string): void {
  const dir = /^[A-Za-z0-9_-]+$/.test(workspaceId) ? path.join(base(), workspaceId) : null;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
}

/** Files older than the retention period are deleted (default 90 days, MEDIA_RETENTION_DAYS to change; 0 keeps everything). */
export function sweepOldMedia(now = Date.now()): number {
  const days = Number(process.env.MEDIA_RETENTION_DAYS ?? 90);
  if (!(days > 0) || !fs.existsSync(base())) return 0;
  const cutoff = now - days * 86_400_000;
  let removed = 0;
  for (const ws of fs.readdirSync(base(), { withFileTypes: true })) {
    if (!ws.isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(base(), ws.name))) {
      const file = path.join(base(), ws.name, f);
      try {
        if (UUID.test(f) && fs.statSync(file).mtimeMs < cutoff) { fs.unlinkSync(file); removed++; }
      } catch { /* gone already */ }
    }
  }
  return removed;
}

export function startMediaSweep(): { stop(): void } {
  const run = () => { try { const n = sweepOldMedia(); if (n) console.log(`[media] removed ${n} expired file(s)`); } catch (e) { console.error('[media] sweep failed:', (e as Error).message); } };
  const first = setTimeout(run, 30_000);
  const t = setInterval(run, 6 * 3600_000);
  return { stop: () => { clearTimeout(first); clearInterval(t); } };
}
