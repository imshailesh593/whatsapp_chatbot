import fs from 'fs';
import path from 'path';
import pino from 'pino';
import qrcodeTerminal from 'qrcode-terminal';
import { handleIncomingMessage } from './engine';
import { setTransport, sendTextMessage } from './transport';
import { UNSUPPORTED_MEDIA_MESSAGE } from './botConfig';
import os from 'os';
import { prisma } from '../lib/prisma';
import { getSetting } from './settings';

export type WaStatus = 'starting' | 'qr' | 'authenticated' | 'ready' | 'disconnected' | 'off';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Baileys 7 is ESM-only. A real dynamic import is needed because TypeScript rewrites import() to require() in CommonJS output.
const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>;

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

const authBase = () => path.resolve(process.env.WA_SESSION_PATH || '.wa_auth');

/** Before multi-workspace support the session files lived directly in the base folder: move them under the default workspace. */
export function migrateLegacyAuth(defaultWorkspaceId: string): void {
  const base = authBase();
  if (!fs.existsSync(path.join(base, 'creds.json'))) return;
  const target = path.join(base, defaultWorkspaceId);
  fs.mkdirSync(target, { recursive: true });
  for (const name of fs.readdirSync(base)) {
    const from = path.join(base, name);
    if (name === defaultWorkspaceId || fs.statSync(from).isDirectory()) continue;
    fs.renameSync(from, path.join(target, name));
  }
  console.log(`[wa] moved legacy session into ${target}`);
}

/** True when this workspace's phone has completed linking before (so it should reconnect on boot). */
function wasLinked(dir: string): boolean {
  try {
    // `me` is set once pairing succeeded (the `registered` flag stays false for linked devices)
    return !!JSON.parse(fs.readFileSync(path.join(dir, 'creds.json'), 'utf8'))?.me;
  } catch {
    return false;
  }
}

/** One linked WhatsApp number for one workspace. */
export class WaConnection {
  status: WaStatus = 'off';
  qr: string | null = null;
  /** The linked number (digits), once connected; used for click-to-chat links */
  phone: string | null = null;
  private sock: any = null;
  private stopped = false;
  private attempt = 0;
  private connecting = false;
  private qrTimer: NodeJS.Timeout | null = null;
  private readonly authDir: string;
  private readonly jids = new Map<string, string>();
  private readonly chains = new Map<string, Promise<void>>();
  private readonly seen = new Set<string>();

  constructor(readonly workspaceId: string) {
    this.authDir = path.join(authBase(), workspaceId);
    setTransport(workspaceId, {
      sendText: (to, text) => this.sendText(to, text),
      ready: () => this.status === 'ready'
    });
  }

  get linked(): boolean {
    return wasLinked(this.authDir);
  }

  /** Reconnect on boot only when this workspace had finished linking earlier. */
  autoStart(): void {
    if (this.linked) this.open().catch((e) => console.error(`[wa ${this.workspaceId.slice(0, 8)}] start failed:`, e));
  }

  /** User pressed Connect: show a QR (or resume a saved session). */
  async connect(): Promise<void> {
    if (this.connecting || this.status !== 'off') return;
    this.connecting = true;
    try {
      // Each linked number keeps a live session in memory: new links wait for a free slot (existing ones always reconnect)
      const { used, max } = await connectionSlots();
      if (used >= max) throw new SlotsFullError();
      this.stopped = false;
      this.attempt = 0;
      await this.open();
    } finally {
      this.connecting = false;
    }
  }

  /** Unlink from the phone, wipe the saved session and stay off until connect() is called. */
  async disconnect(): Promise<void> {
    this.stopped = true;
    const s = this.sock;
    this.sock = null;
    try {
      // Removes the bot from WhatsApp > Linked devices on the phone
      if (s && this.status === 'ready') await s.logout();
    } catch {
      // phone unreachable: the local session is wiped below regardless
    }
    try {
      s?.end(undefined);
    } catch {
      // already closed
    }
    fs.rmSync(this.authDir, { recursive: true, force: true });
    if (this.qrTimer) {
      clearTimeout(this.qrTimer);
      this.qrTimer = null;
    }
    this.status = 'off';
    this.qr = null;
  }

  async stop(): Promise<void> {
    if (this.qrTimer) clearTimeout(this.qrTimer);
    this.stopped = true;
    try {
      this.sock?.end(undefined);
    } catch {
      // already closed
    }
  }

  private enqueue(key: string, task: () => Promise<void>): void {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev
      .then(task)
      .catch((err) => console.error(`[Worker Error] ${this.workspaceId}/${key}:`, err))
      .finally(() => {
        if (this.chains.get(key) === next) this.chains.delete(key);
      });
    this.chains.set(key, next);
  }

  private async sendText(to: string, text: string): Promise<void> {
    if (!this.sock || this.status !== 'ready') throw new Error('WhatsApp is not connected');
    const sock = this.sock;
    const jid = this.jids.get(to) ?? `${to}@s.whatsapp.net`;
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

  private async onMessage(m: any, type: string): Promise<void> {
    const wsId = this.workspaceId;
    const jid: string | undefined = m.key?.remoteJid;
    if (!jid || !m.message) return;
    if (jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return; // 1:1 chats only
    const text = extractText(m.message).trim();

    // Owner takeover: typing !pause / !resume in a customer's chat from the linked phone
    if (m.key.fromMe) {
      const cmd = text.toLowerCase();
      if (cmd !== '!pause' && cmd !== '!resume') return;
      const key = [...this.jids.entries()].find(([, j]) => j === jid)?.[0] ?? phoneKey(m.key);
      const paused = cmd === '!pause';
      const r = await prisma.session.updateMany({ where: { workspaceId: wsId, phoneNumber: key }, data: { isAgentPaused: paused } });
      console.log(`[Takeover] ${wsId}/${key} ${paused ? 'paused' : 'resumed'} (${r.count} session)`);
      return;
    }
    if (type !== 'notify') return; // history/append sync is not a new customer message

    const id: string | undefined = m.key.id;
    if (!id || this.seen.has(id)) return;
    this.seen.add(id);
    if (this.seen.size > 5000) this.seen.delete(this.seen.values().next().value as string);

    const key = phoneKey(m.key);
    this.jids.set(key, jid);
    const name: string | undefined = m.pushName || undefined;
    console.log(`[wa ${wsId.slice(0, 8)}] incoming from ${jid} -> ${key}`);
    try {
      await this.sock?.readMessages([m.key]);
    } catch {
      // blue ticks are cosmetic
    }

    const isMedia = MEDIA_KEYS.some((k) => unwrap(m.message)?.[k]);

    this.enqueue(key, async () => {
      // Persistent dedupe: WhatsApp redelivers unacked messages after a restart
      const dup = await prisma.webhookLog.findFirst({
        where: { workspaceId: wsId, direction: 'INBOUND', payload: { path: ['wamid'], equals: id } },
        select: { id: true }
      });
      if (dup) return;
      if (!text) {
        if (isMedia) {
          const s = await prisma.session.findUnique({ where: { workspaceId_phoneNumber: { workspaceId: wsId, phoneNumber: key } } });
          if (!s?.isAgentPaused) await sendTextMessage(wsId, key, UNSUPPORTED_MEDIA_MESSAGE);
        }
        return;
      }
      await handleIncomingMessage(wsId, key, name, text, id);
    });
  }

  private async open(): Promise<void> {
    if (this.stopped) return;
    this.status = 'starting';
    const baileys = await dynamicImport('@whiskeysockets/baileys');
    const makeWASocket = typeof baileys.default === 'function' ? baileys.default : baileys.makeWASocket;
    const { state, saveCreds } = await baileys.useMultiFileAuthState(this.authDir);
    const latest = await baileys.fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

    const sock = makeWASocket({
      auth: state,
      version: latest.version,
      logger: pino({ level: 'silent' }),
      browser: baileys.Browsers.ubuntu('Lead Bot'),
      markOnlineOnConnect: false,
      syncFullHistory: false
    });
    this.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u: any) => {
      if (sock !== this.sock) return; // stale socket (replaced or disconnected)
      const { connection, lastDisconnect, qr } = u;
      if (qr) {
        this.status = 'qr';
        this.qr = qr;
        // An unscanned QR must not hold a slot forever
        if (!this.qrTimer) {
          this.qrTimer = setTimeout(() => {
            this.qrTimer = null;
            if (this.status === 'qr') {
              console.log(`[wa ${this.workspaceId.slice(0, 8)}] QR not scanned in 5 minutes, releasing the slot`);
              void this.disconnect();
            }
          }, 5 * 60_000);
        }
        console.log(`[wa ${this.workspaceId.slice(0, 8)}] QR ready`);
        if (process.env.WA_QR_IN_LOG === '1') qrcodeTerminal.generate(qr, { small: true });
      }
      if (connection === 'open') {
        this.status = 'ready';
        this.qr = null;
        if (this.qrTimer) {
          clearTimeout(this.qrTimer);
          this.qrTimer = null;
        }
        this.phone = sock.user?.id ? userPart(String(sock.user.id)) : this.phone;
        this.attempt = 0;
        console.log(`[wa ${this.workspaceId.slice(0, 8)}] connected`);
      }
      if (connection === 'close') {
        if (this.stopped) return;
        this.status = 'disconnected';
        this.qr = null;
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === baileys.DisconnectReason.loggedOut;
        console.error(`[wa ${this.workspaceId.slice(0, 8)}] closed (code ${code ?? 'n/a'})${loggedOut ? ': logged out from the phone' : ', reconnecting'}`);
        if (loggedOut) {
          // The owner removed the device on the phone: wipe and go idle until they press Connect again
          fs.rmSync(this.authDir, { recursive: true, force: true });
          this.sock = null;
          this.status = 'off';
          return;
        }
        const delay = Math.min(30_000, 2000 * ++this.attempt);
        setTimeout(() => this.open().catch((e) => console.error('reconnect failed:', e)), delay);
      }
    });

    sock.ev.on('messages.upsert', ({ messages, type }: { messages: any[]; type: string }) => {
      for (const m of messages) this.onMessage(m, type).catch((e) => console.error('[wa] message handler error:', e));
    });
  }
}

// ---------- registry: one connection per workspace ----------

const connections = new Map<string, WaConnection>();

export function waFor(workspaceId: string): WaConnection {
  let c = connections.get(workspaceId);
  if (!c) {
    c = new WaConnection(workspaceId);
    connections.set(workspaceId, c);
  }
  return c;
}

/** Boot: reconnect every workspace that had finished linking before the restart. */
export async function startWhatsApp(): Promise<{ stop(): Promise<void> }> {
  migrateLegacyAuth('default-workspace');
  const all = await prisma.workspace.findMany({ select: { id: true } });
  for (const { id } of all) waFor(id).autoStart();
  return {
    async stop() {
      await Promise.all([...connections.values()].map((c) => c.stop()));
    }
  };
}

export class SlotsFullError extends Error {
  constructor() {
    super('WhatsApp connections are full right now. Please try again later: we have been notified.');
  }
}

/** How many numbers are linked (or linking) versus how many this server is set up to hold. */
export async function connectionSlots(): Promise<{ used: number; max: number }> {
  const configured = await getSetting<number>('waMaxConnections', 0);
  const max = configured > 0 ? configured : Number(process.env.WA_MAX_CONNECTIONS) || 20;
  return { used: [...connections.values()].filter((c) => c.status !== 'off').length, max };
}

export function serverMemory() {
  const mem = process.memoryUsage();
  return { botRssMb: Math.round(mem.rss / 1048576), systemTotalMb: Math.round(os.totalmem() / 1048576), systemFreeMb: Math.round(os.freemem() / 1048576) };
}

export const waSummary = () => ({
  total: connections.size,
  ready: [...connections.values()].filter((c) => c.status === 'ready').length
});
