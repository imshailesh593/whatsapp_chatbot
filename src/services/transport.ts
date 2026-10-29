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

export async function sendTextMessage(workspaceId: string, to: string, text: string): Promise<void> {
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
