import { AsyncLocalStorage } from 'async_hooks';
import { prisma } from '../lib/prisma';
import { isSocial } from '../lib/channel';
import { splitMessage } from '../lib/split';
import { takePhotos } from '../lib/photoTag';
import { loadPhoto } from './messagePhotos';
import { saveMedia } from './mediaStore';

/** Thin seam between the conversation engine and whatever actually delivers messages (a WhatsApp link per workspace, or a fake in tests). */
export type MediaKind = 'image' | 'video' | 'document';
export interface OutgoingMedia { kind: MediaKind; buffer: Buffer; mime: string; fileName: string; caption?: string }

export interface Transport {
  sendText(to: string, text: string): Promise<void>;
  /** Sends a photo, video or document (WhatsApp only) */
  sendMedia?(to: string, media: OutgoingMedia): Promise<void>;
  /** Is the underlying connection usable right now? */
  ready?(): boolean;
}

const transports = new Map<string, Transport>();
const capture = new AsyncLocalStorage<string[]>();

/** Instagram and Facebook Messenger go out through Meta, not WhatsApp (registered by services/meta.ts). */
let social: ((workspaceId: string, to: string, text: string) => Promise<void>) | null = null;
export const setSocialSender = (fn: typeof social) => {
  social = fn;
};

export function setTransport(workspaceId: string, t: Transport | null): void {
  if (t) transports.set(workspaceId, t);
  else transports.delete(workspaceId);
}

/** True while running inside captureReplies (dashboard simulator): nothing is sent or logged as a real message. */
export const isCapturing = () => capture.getStore() !== undefined;

/** Runs fn and collects every reply the engine would have sent, without delivering any of them. */
export async function captureReplies(fn: () => Promise<void>): Promise<string[]> {
  const buf: string[] = [];
  await capture.run(buf, fn);
  return buf;
}

export async function logMessage(
  workspaceId: string,
  phone: string,
  direction: 'INBOUND' | 'OUTBOUND',
  text: string,
  wamid?: string,
  extra?: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.webhookLog.create({
      data: { workspaceId, phoneNumber: phone, direction, payload: { text, ...(wamid ? { wamid } : {}), ...(extra ?? {}) } as any }
    });
  } catch (err) {
    console.error('[log] failed to store message:', (err as Error).message);
  }
}

const MEDIA_ICON: Record<MediaKind, string> = { image: '📷', video: '🎥', document: '📄' };

/** Sends an attachment from the Inbox and records it in the chat log (name and kind, not the file itself). */
export async function sendMediaMessage(workspaceId: string, to: string, media: OutgoingMedia): Promise<void> {
  if (isSocial(to)) throw new Error('Attachments are not supported for Instagram / Facebook chats yet');
  const t = transports.get(workspaceId);
  if (!t?.sendMedia) throw new Error('WhatsApp is not connected for this workspace');
  await t.sendMedia(to, media);
  const label = `${MEDIA_ICON[media.kind]} ${media.fileName}` + (media.caption ? `\n${media.caption}` : '');
  try {
    const stored = saveMedia(workspaceId, media.buffer, { kind: media.kind, mime: media.mime, name: media.fileName, caption: media.caption });
    await logMessage(workspaceId, to, 'OUTBOUND', label, undefined, { media: stored });
  } catch (err) {
    console.error('[log] failed to store attachment:', (err as Error).message);
  }
}

/** Is a delivery channel connected for this workspace? */
export const transportReady = (workspaceId: string) => !!transports.get(workspaceId)?.ready?.();

/** Sends without writing to the customer chat log (owner alerts, which are not part of any customer conversation). */
export async function sendRaw(workspaceId: string, to: string, text: string): Promise<void> {
  const t = transports.get(workspaceId);
  if (!t) throw new Error('WhatsApp is not connected for this workspace');
  await t.sendText(to, text);
}

/** One customer message gets one reply: everything the engine says while handling it is held here and sent as a single message. */
interface Batch {
  to: string;
  parts: string[];
  open: boolean;
  /** A photo tag that goes in front of this reply, if there is a reply at all */
  lead?: string;
}
const batches = new AsyncLocalStorage<Batch>();

/** Pause between the parts of a split message, so they arrive in order and read like a person typing. */
const SPLIT_PAUSE_MS = 1200;

/** Delivers one reply, as several messages only where the owner's saved text asks for it with "[split]". */
async function deliver(workspaceId: string, to: string, text: string): Promise<void> {
  const parts = /\[split\]/i.test(text) ? splitMessage(text) : [text];
  for (let i = 0; i < parts.length; i++) {
    if (i > 0 && !isCapturing()) await new Promise((r) => setTimeout(r, SPLIT_PAUSE_MS));
    await deliverOne(workspaceId, to, parts[i]);
  }
}

async function deliverOne(workspaceId: string, to: string, text: string): Promise<void> {
  const buf = capture.getStore();
  if (buf) {
    // the simulator keeps the photo tags and turns them into pictures
    buf.push(text);
    return;
  }
  const { text: words, photos } = takePhotos(text);
  if (isSocial(to)) {
    // Instagram / Facebook get the text only: attachments are not supported there yet
    if (!social) throw new Error('Instagram / Facebook is not set up on this server');
    await social(workspaceId, to, words);
    await logMessage(workspaceId, to, 'OUTBOUND', words);
    return;
  }
  const t = transports.get(workspaceId);
  if (!t) throw new Error('WhatsApp is not connected for this workspace');
  let unsent = words;
  for (const id of t.sendMedia ? photos : []) {
    const caption = unsent && unsent.length <= MAX_CAPTION ? unsent : '';
    if (await sendPhoto(workspaceId, t, to, id, caption)) unsent = caption ? '' : unsent;
  }
  // no photo, a photo that failed, or text too long for a caption: the words always go out
  if (unsent) {
    await t.sendText(to, unsent);
    await logMessage(workspaceId, to, 'OUTBOUND', unsent);
  }
}

/** WhatsApp cuts longer captions short, so a longer text follows the photo as its own message. */
const MAX_CAPTION = 1000;

/** Sends one saved photo; false when it could not be sent (the reply then goes out without it). */
async function sendPhoto(workspaceId: string, t: Transport, to: string, id: string, caption: string): Promise<boolean> {
  let photo: Awaited<ReturnType<typeof loadPhoto>>;
  const fileName = 'photo';
  try {
    photo = await loadPhoto(workspaceId, id);
    if (!photo) return false;
    await t.sendMedia!(to, { kind: 'image', buffer: photo.data, mime: photo.mime, fileName, caption: caption || undefined });
  } catch (err) {
    console.error('[photo] could not send, sending the text without it:', (err as Error).message);
    return false;
  }
  // the caption is logged as the message text, so chat history reads the same with or without a photo
  const name = fileName + (photo.mime === 'image/png' ? '.png' : '.jpg');
  try {
    const stored = saveMedia(workspaceId, photo.data, { kind: 'image', mime: photo.mime, name, caption: caption || undefined });
    await logMessage(workspaceId, to, 'OUTBOUND', caption || `📷 ${name}`, undefined, { media: stored });
  } catch (err) {
    console.error('[log] failed to store attachment:', (err as Error).message);
    await logMessage(workspaceId, to, 'OUTBOUND', caption || `📷 ${name}`);
  }
  return true;
}

/**
 * Runs the handling of one incoming message. Every reply to that customer made meanwhile is merged, in order, into ONE
 * message (separated by a blank line) and delivered when the handling ends. The only exception is a saved text the owner
 * split with "[split]" (see lib/split.ts). Messages to anybody else go out at once.
 */
export async function batchReplies<T>(workspaceId: string, to: string, fn: () => Promise<T>): Promise<T> {
  const batch: Batch = { to, parts: [], open: true };
  try {
    return await batches.run(batch, fn);
  } finally {
    batch.open = false;
    if (batch.parts.length) {
      const reply = batch.parts.join('\n\n');
      await deliver(workspaceId, to, batch.lead ? `${batch.lead} ${reply}` : reply);
    }
  }
}

/** Puts a photo in front of the reply being built for this message; nothing is sent if the bot ends up saying nothing. */
export function leadWithPhoto(tag: string): void {
  const batch = batches.getStore();
  if (batch && batch.open) batch.lead = tag;
}

export async function sendTextMessage(workspaceId: string, to: string, text: string): Promise<void> {
  const batch = batches.getStore();
  // A background task that outlives the handler (the batch is closed) sends on its own
  if (batch && batch.open && batch.to === to) {
    if (text.trim() && batch.parts[batch.parts.length - 1] !== text) batch.parts.push(text);
    return;
  }
  await deliver(workspaceId, to, text);
}
