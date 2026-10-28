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
    const contact = await Promise.race([
      msg.getContact(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('getContact timeout')), 3000))
    ]);
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
  // Known flaky case: session restores ("authenticated") but WhatsApp Web never reaches ready. Restart to recover.
  let readyTimer: NodeJS.Timeout | undefined;
  client.on('authenticated', () => {
    waState.status = 'authenticated';
    waState.qr = null;
    readyTimer = setTimeout(() => {
      console.error('Authenticated but not ready after 45s; restarting.');
      process.exit(1);
    }, 45_000);
  });
  client.on('ready', () => {
    clearTimeout(readyTimer);
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
  const onIncoming = async (msg: Message) => {
    if (msg.fromMe || msg.isStatus) return;
    if (!/@(c\.us|lid)$/.test(msg.from)) return; // ignore groups, broadcasts, newsletters

    const id = msg.id._serialized;
    if (seen.has(id)) return;
    seen.add(id);
    if (seen.size > 5000) seen.delete(seen.values().next().value as string);

    const key = await phoneKey(msg);
    console.log(`[wa] incoming ${msg.type} from ${msg.from} -> ${key}`);
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
      // Persistent dedupe (events + poller + restarts can all deliver the same message)
      const dup = await prisma.webhookLog.findFirst({
        where: { direction: 'INBOUND', payload: { path: ['wamid'], equals: id } },
        select: { id: true }
      });
      if (dup) return;
      await handleIncomingMessage(key, name, msg.body, id);
    });
  };
  // Listen on both: some WhatsApp Web builds only emit message_create for certain chats. Dedupe is by message id.
  client.on('message', (msg) => {
    console.log('[wa:raw] message', msg.type, msg.from, 'fromMe=' + msg.fromMe, msg.id._serialized);
    void onIncoming(msg);
  });

  // Owner takeover: typing !pause / !resume in a customer's chat from the linked phone
  client.on('message_create', async (msg) => {
    console.log('[wa:raw] message_create', msg.type, msg.from, 'fromMe=' + msg.fromMe, msg.id._serialized);
    if (!msg.fromMe) return void onIncoming(msg);
    const cmd = msg.body.trim().toLowerCase();
    if (cmd !== '!pause' && cmd !== '!resume') return;
    const key = [...chatIds.entries()].find(([, id]) => id === msg.to)?.[0] ?? msg.to.split('@')[0];
    const paused = cmd === '!pause';
    const r = await prisma.session.updateMany({ where: { phoneNumber: key }, data: { isAgentPaused: paused } });
    console.log(`[Takeover] ${key} ${paused ? 'paused' : 'resumed'} (${r.count} session)`);
  });

  // Poller: events from WhatsApp Web were observed to stop for a chat after the first message, so also check
  // recently active 1:1 chats every few seconds. Dedupe (in-memory + DB by message id) makes this safe.
  let pollSince = Math.floor(Date.now() / 1000) - 120;
  let polling = false;
  let pollErrLogged = false;
  setInterval(async () => {
    if (waState.status !== 'ready' || polling) return;
    polling = true;
    const since = pollSince;
    pollSince = Math.floor(Date.now() / 1000) - 20; // overlap window
    try {
      const chats = (await client.getChats()).filter(
        (c) => !c.isGroup && c.timestamp >= since && /@(c\.us|lid)$/.test(c.id._serialized)
      );
      for (const chat of chats) {
        for (const m of await chat.fetchMessages({ limit: 8 })) {
          if (!m.fromMe && m.timestamp >= since) await onIncoming(m);
        }
      }
    } catch (err) {
      if (!pollErrLogged) console.error('[wa] poll error:', (err as Error).message);
      pollErrLogged = true;
    } finally {
      polling = false;
    }
  }, 4000);

  // Heartbeat: if the page lost its connection but never fired 'disconnected', restart instead of silently ignoring chats.
  let bad = 0;
  setInterval(async () => {
    if (waState.status !== 'ready') return;
    try {
      const st = await Promise.race([client.getState(), new Promise<string>((r) => setTimeout(() => r('TIMEOUT'), 15_000))]);
      bad = st === 'CONNECTED' ? 0 : bad + 1;
      if (st !== 'CONNECTED') console.error('[wa] heartbeat state:', st);
    } catch (err) {
      bad++;
      console.error('[wa] heartbeat error:', (err as Error).message);
    }
    if (bad >= 3) {
      console.error('[wa] connection unhealthy; restarting.');
      process.exit(1);
    }
  }, 60_000);

  client.initialize().catch((err) => {
    console.error('WhatsApp initialize failed:', err);
    process.exit(1);
  });
  return client;
}
