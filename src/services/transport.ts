/** Thin seam between the conversation engine and whatever actually delivers messages (WhatsApp Web, or a fake in tests). */
export interface Transport {
  sendText(to: string, text: string): Promise<void>;
}

let current: Transport | null = null;

export function setTransport(t: Transport): void {
  current = t;
}

export async function sendTextMessage(to: string, text: string): Promise<void> {
  if (!current) throw new Error('No transport configured');
  await current.sendText(to, text);
}
