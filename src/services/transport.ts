import { AsyncLocalStorage } from 'async_hooks';
import { prisma } from '../lib/prisma';

/** Thin seam between the conversation engine and whatever actually delivers messages (WhatsApp Web, or a fake in tests). */
export interface Transport {
  sendText(to: string, text: string): Promise<void>;
}

let current: Transport | null = null;
const capture = new AsyncLocalStorage<string[]>();

export function setTransport(t: Transport): void {
  current = t;
}

/** True while running inside captureReplies (dashboard simulator): nothing is sent or logged as a real message. */
export const isCapturing = () => capture.getStore() !== undefined;

/** Runs fn and collects every reply the engine would have sent, without delivering any of them. */
export async function captureReplies(fn: () => Promise<void>): Promise<string[]> {
  const buf: string[] = [];
  await capture.run(buf, fn);
  return buf;
}

export async function logMessage(phone: string, direction: 'INBOUND' | 'OUTBOUND', text: string, wamid?: string): Promise<void> {
  try {
    await prisma.webhookLog.create({ data: { phoneNumber: phone, direction, payload: wamid ? { text, wamid } : { text } } });
  } catch (err) {
    console.error('[log] failed to store message:', (err as Error).message);
  }
}

export async function sendTextMessage(to: string, text: string): Promise<void> {
  const buf = capture.getStore();
  if (buf) {
    buf.push(text);
    return;
  }
  if (!current) throw new Error('No transport configured');
  await current.sendText(to, text);
  await logMessage(to, 'OUTBOUND', text);
}
