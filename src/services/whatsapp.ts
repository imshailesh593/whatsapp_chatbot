import fs from 'fs';
import path from 'path';
import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import qrcodeTerminal from 'qrcode-terminal';
import { handleIncomingMessage } from './engine';
import { setTransport, sendTextMessage } from './transport';
import { prisma } from '../lib/prisma';
import { UNSUPPORTED_MEDIA_MESSAGE } from '../constants/questions';

export type WaStatus = 'starting' | 'qr' | 'authenticated' | 'ready' | 'disconnected';

export const waState: { status: WaStatus; qr: string | null } = { status: 'starting', qr: null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// phone number (our session key) -> WhatsApp chat id we last heard from (handles @c.us and @lid)
const chatIds = new Map<string, string>();
// per-chat promise chain keeps replies in order and prevents interleaved state updates
const chains = new Map<string, Promise<void>>();
const seen = new Set<string>();

function enqueue(key: string, task: () => Promise<void>): void {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev
    .then(task)
    .catch((err) => console.error(`[Worker Error] ${key}:`, err))
    .finally(() => {
      if (chains.get(key) === next) chains.delete(key);
    });
  chains.set(key, next);
}

async function phoneKey(msg: Message): Promise<string> {
  try {
    const contact = await msg.getContact();
    if (contact.number) return contact.number;
  } catch {
    // fall through
  }
  return msg.from.split('@')[0];
}

/** A recreated container gets a new hostname, so Chromium sees the saved profile as locked by another machine. */
function clearStaleProfileLocks(dataPath: string): void {
  const profile = path.join(dataPath, 'session');
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try {
      fs.rmSync(path.join(profile, f), { force: true });
    } catch {
      // nothing to clear
    }
  }
}

export function startWhatsApp(): Client {
  const dataPath = process.env.WA_SESSION_PATH || '.wwebjs_auth';
  clearStaleProfileLocks(dataPath);
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath }),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    }
  });

  setTransport({
    async sendText(to, text) {
      const chatId = chatIds.get(to) ?? `${to}@c.us`;
      // Small human-like pause; also eases WhatsApp's anti-automation heuristics
      try {
        const chat = await client.getChatById(chatId);
        await chat.sendStateTyping();
      } catch {
        // typing indicator is cosmetic
      }
      await sleep(600 + Math.random() * 900);
      await client.sendMessage(chatId, text);
    }
  });

  client.on('qr', (qr) => {
    waState.status = 'qr';
    waState.qr = qr;
    console.log('Scan this QR with WhatsApp > Linked devices:');
    qrcodeTerminal.generate(qr, { small: true });
  });
  client.on('authenticated', () => {
    waState.status = 'authenticated';
    waState.qr = null;
  });
  client.on('ready', () => {
    waState.status = 'ready';
    waState.qr = null;
    console.log('WhatsApp Web client is ready.');
  });
  client.on('auth_failure', (m) => {
    console.error('WhatsApp auth failure:', m);
    waState.status = 'disconnected';
  });
  client.on('disconnected', (reason) => {
    console.error('WhatsApp disconnected:', reason);
    waState.status = 'disconnected';
    // Exit so the process manager (docker restart policy / pm2) brings up a fresh session
    setTimeout(() => process.exit(1), 1000);
  });

  // Incoming messages from customers
  client.on('message', async (msg) => {
    if (msg.fromMe || msg.isStatus) return;
    if (!/@(c\.us|lid)$/.test(msg.from)) return; // ignore groups, broadcasts, newsletters

    const id = msg.id._serialized;
    if (seen.has(id)) return;
    seen.add(id);
    if (seen.size > 5000) seen.delete(seen.values().next().value as string);

    const key = await phoneKey(msg);
    chatIds.set(key, msg.from);
    const name = (msg as any)._data?.notifyName as string | undefined;

    enqueue(key, async () => {
      if (msg.type !== 'chat') {
        const s = await prisma.session.findUnique({ where: { phoneNumber: key } });
        if (!s?.isAgentPaused) {
          await sendTextMessage(key, UNSUPPORTED_MEDIA_MESSAGE);
        }
        return;
      }
      await handleIncomingMessage(key, name, msg.body);
    });
  });

  // Owner takeover: typing !pause / !resume in a customer's chat from the linked phone
  client.on('message_create', async (msg) => {
    if (!msg.fromMe) return;
    const cmd = msg.body.trim().toLowerCase();
    if (cmd !== '!pause' && cmd !== '!resume') return;
    const key = [...chatIds.entries()].find(([, id]) => id === msg.to)?.[0] ?? msg.to.split('@')[0];
    const paused = cmd === '!pause';
    const r = await prisma.session.updateMany({ where: { phoneNumber: key }, data: { isAgentPaused: paused } });
    console.log(`[Takeover] ${key} ${paused ? 'paused' : 'resumed'} (${r.count} session)`);
  });

  client.initialize().catch((err) => {
    console.error('WhatsApp initialize failed:', err);
    process.exit(1);
  });
  return client;
}
