import { AsyncLocalStorage } from 'async_hooks';
import { prisma } from '../lib/prisma';

/** Thin seam between the conversation engine and whatever actually delivers messages (a WhatsApp link per workspace, or a fake in tests). */
export interface Transport {
  sendText(to: string, text: string): Promise<void>;
  /** Is the underlying connection usable right now? */
  ready?(): boolean;
}

const transports = new Map<string, Transport>();
const capture = new AsyncLocalStorage<string[]>();

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
  wamid?: string
): Promise<void> {
  try {
    await prisma.webhookLog.create({
      data: { workspaceId, phoneNumber: phone, direction, payload: wamid ? { text, wamid } : { text } }
    });
  } catch (err) {
    console.error('[log] failed to store message:', (err as Error).message);
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
}
const batches = new AsyncLocalStorage<Batch>();

async function deliver(workspaceId: string, to: string, text: string): Promise<void> {
  const buf = capture.getStore();
  if (buf) {
    buf.push(text);
    return;
  }
  const t = transports.get(workspaceId);
  if (!t) throw new Error('WhatsApp is not connected for this workspace');
  await t.sendText(to, text);
  await logMessage(workspaceId, to, 'OUTBOUND', text);
}

/**
 * Runs the handling of one incoming message. Every reply to that customer made meanwhile is merged, in order, into ONE
 * message (separated by a blank line) and delivered when the handling ends. Messages to anybody else go out at once.
 */
export async function batchReplies<T>(workspaceId: string, to: string, fn: () => Promise<T>): Promise<T> {
  const batch: Batch = { to, parts: [], open: true };
  try {
    return await batches.run(batch, fn);
  } finally {
    batch.open = false;
    if (batch.parts.length) await deliver(workspaceId, to, batch.parts.join('\n\n'));
  }
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
