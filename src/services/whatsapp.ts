import fs from 'fs';
import path from 'path';
import pino from 'pino';
import qrcodeTerminal from 'qrcode-terminal';
import { handleIncomingMessage } from './engine';
import { setTransport, sendTextMessage } from './transport';
import { prisma } from '../lib/prisma';
import { UNSUPPORTED_MEDIA_MESSAGE } from '../constants/questions';

export type WaStatus = 'starting' | 'qr' | 'authenticated' | 'ready' | 'disconnected' | 'off';

export const waState: { status: WaStatus; qr: string | null } = { status: 'starting', qr: null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Baileys 7 is ESM-only. A real dynamic import is needed because TypeScript rewrites import() to require() in CommonJS output.
const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>;

// phone number (our session key) -> WhatsApp JID we last heard from (@s.whatsapp.net or @lid)
const jids = new Map<string, string>();
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

const MEDIA_KEYS = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage', 'contactMessage', 'locationMessage'];

/** Unwraps ephemeral/view-once wrappers and returns the inner message object. */
function unwrap(message: any): any {
  let m = message;
  for (let i = 0; i < 4; i++) {
    const inner = m?.ephemeralMessage?.message ?? m?.viewOnceMessage?.message ?? m?.viewOnceMessageV2?.message ?? m?.documentWithCaptionMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m;
}

function extractText(message: any): string {
  const m = unwrap(message);
  return (
    m?.conversation ??
    m?.extendedTextMessage?.text ??
    m?.buttonsResponseMessage?.selectedButtonId ??
    m?.listResponseMessage?.singleSelectReply?.selectedRowId ??
    m?.templateButtonReplyMessage?.selectedId ??
    ''
  );
}

const userPart = (jid: string) => jid.split('@')[0].split(':')[0];

/** Our session key: the real phone number when WhatsApp reveals it, otherwise the anonymous (LID) id. */
function phoneKey(key: any): string {
  const pn = [key.remoteJid, key.remoteJidAlt, key.senderPn, key.participantPn].find(
    (j: unknown) => typeof j === 'string' && j.endsWith('@s.whatsapp.net')
  ) as string | undefined;
  return userPart(pn ?? key.remoteJid);
}

export interface WaController {
  stop(): Promise<void>;
  /** Start linking: shows a QR (or resumes a saved session). */
  connect(): Promise<void>;
  /** Unlink this bot from the phone, wipe the saved session and stay off until connect() is called. */
  disconnect(): Promise<void>;
}

export function startWhatsApp(): WaController {
  const authDir = process.env.WA_SESSION_PATH || '.wa_auth';
  let sock: any = null;
  let stopped = false;
  let attempt = 0;
  let connecting = false;
  // Survives restarts: when an admin disconnects the bot it must not silently ask for a new QR after a redeploy
  const offFlag = path.join(path.dirname(path.resolve(authDir)), 'wa_disabled');
  let manualOff = fs.existsSync(offFlag);

  setTransport({
    async sendText(to, text) {
      if (!sock || waState.status !== 'ready') throw new Error('WhatsApp is not connected');
      const jid = jids.get(to) ?? `${to}@s.whatsapp.net`;
      // Short "typing…" pause: feels human and eases WhatsApp's anti-automation heuristics
      try {
        await sock.presenceSubscribe(jid);
        await sock.sendPresenceUpdate('composing', jid);
      } catch {
        // cosmetic
      }
      await sleep(600 + Math.random() * 900);
      await sock.sendMessage(jid, { text });
      try {
        await sock.sendPresenceUpdate('paused', jid);
      } catch {
        // cosmetic
      }
    }
  });

  async function onMessage(m: any, type: string): Promise<void> {
    const jid: string | undefined = m.key?.remoteJid;
    if (!jid || !m.message) return;
    if (jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return; // 1:1 chats only
    const text = extractText(m.message).trim();

    // Owner takeover: typing !pause / !resume in a customer's chat from the linked phone
    if (m.key.fromMe) {
      const cmd = text.toLowerCase();
      if (cmd !== '!pause' && cmd !== '!resume') return;
      const key = [...jids.entries()].find(([, j]) => j === jid)?.[0] ?? phoneKey(m.key);
      const paused = cmd === '!pause';
      const r = await prisma.session.updateMany({ where: { phoneNumber: key }, data: { isAgentPaused: paused } });
      console.log(`[Takeover] ${key} ${paused ? 'paused' : 'resumed'} (${r.count} session)`);
      return;
    }
    if (type !== 'notify') return; // history/append sync is not a new customer message

    const id: string | undefined = m.key.id;
    if (!id || seen.has(id)) return;
    seen.add(id);
    if (seen.size > 5000) seen.delete(seen.values().next().value as string);

    const key = phoneKey(m.key);
    jids.set(key, jid);
    const name: string | undefined = m.pushName || undefined;
    console.log(`[wa] incoming from ${jid} -> ${key}`);
    try {
      await sock.readMessages([m.key]);
    } catch {
      // blue ticks are cosmetic
    }

    const isMedia = MEDIA_KEYS.some((k) => unwrap(m.message)?.[k]);

    enqueue(key, async () => {
      // Persistent dedupe: WhatsApp redelivers unacked messages after a restart
      const dup = await prisma.webhookLog.findFirst({
        where: { direction: 'INBOUND', payload: { path: ['wamid'], equals: id } },
        select: { id: true }
      });
      if (dup) return;
      if (!text) {
        if (isMedia) {
          const s = await prisma.session.findUnique({ where: { phoneNumber: key } });
          if (!s?.isAgentPaused) await sendTextMessage(key, UNSUPPORTED_MEDIA_MESSAGE);
        }
        return;
      }
      await handleIncomingMessage(key, name, text, id);
    });
  }

  async function connect(): Promise<void> {
    if (stopped || manualOff) return;
    waState.status = 'starting';
    const baileys = await dynamicImport('@whiskeysockets/baileys');
    const makeWASocket = typeof baileys.default === 'function' ? baileys.default : baileys.makeWASocket;
    const { state, saveCreds } = await baileys.useMultiFileAuthState(authDir);
    const latest = await baileys.fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

    sock = makeWASocket({
      auth: state,
      version: latest.version,
      logger: pino({ level: 'silent' }),
      browser: baileys.Browsers.ubuntu('Lead Bot'),
      markOnlineOnConnect: false,
      syncFullHistory: false
    });

    const mine = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u: any) => {
      if (mine !== sock) return; // stale socket (replaced or disconnected)
      const { connection, lastDisconnect, qr } = u;
      if (qr) {
        waState.status = 'qr';
        waState.qr = qr;
        console.log('Scan this QR with WhatsApp > Linked devices:');
        qrcodeTerminal.generate(qr, { small: true });
      }
      if (connection === 'open') {
        waState.status = 'ready';
        waState.qr = null;
        attempt = 0;
        console.log('WhatsApp connected (Baileys).');
      }
      if (connection === 'close') {
        if (stopped || manualOff) return;
        waState.status = 'disconnected';
        waState.qr = null;
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === baileys.DisconnectReason.loggedOut;
        console.error(`WhatsApp connection closed (code ${code ?? 'n/a'})${loggedOut ? ': logged out from the phone, new QR needed' : ', reconnecting'}`);
        if (loggedOut) fs.rmSync(authDir, { recursive: true, force: true });
        const delay = loggedOut ? 1000 : Math.min(30_000, 2000 * ++attempt);
        setTimeout(() => connect().catch((e) => console.error('reconnect failed:', e)), delay);
      }
    });

    sock.ev.on('messages.upsert', ({ messages, type }: { messages: any[]; type: string }) => {
      for (const m of messages) onMessage(m, type).catch((e) => console.error('[wa] message handler error:', e));
    });
  }

  if (manualOff) {
    waState.status = 'off';
    console.log('WhatsApp is switched off (disconnected from the admin console).');
  } else {
    connect().catch((err) => {
      console.error('WhatsApp initialize failed:', err);
      process.exit(1);
    });
  }

  return {
    async connect() {
      if (connecting || waState.status !== 'off') return;
      connecting = true;
      try {
        manualOff = false;
        fs.rmSync(offFlag, { force: true });
        attempt = 0;
        await connect();
      } finally {
        connecting = false;
      }
    },
    async disconnect() {
      manualOff = true;
      fs.mkdirSync(path.dirname(offFlag), { recursive: true });
      fs.writeFileSync(offFlag, new Date().toISOString());
      const s = sock;
      sock = null;
      try {
        // Removes the bot from WhatsApp > Linked devices on the phone
        if (s && waState.status === 'ready') await s.logout();
      } catch {
        // phone unreachable: the local session is wiped below regardless
      }
      try {
        s?.end(undefined);
      } catch {
        // already closed
      }
      fs.rmSync(authDir, { recursive: true, force: true });
      waState.status = 'off';
      waState.qr = null;
    },
    async stop() {
      stopped = true;
      try {
        sock?.end(undefined);
      } catch {
        // already closed
      }
    }
  };
}
