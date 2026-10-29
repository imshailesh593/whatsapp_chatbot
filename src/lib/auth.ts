import crypto from 'crypto';
import { promisify } from 'util';
import { prisma } from './prisma';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const MIN_PASSWORD_LENGTH = 10;
export const normalizeEmail = (e: unknown) => String(e ?? '').trim().toLowerCase();
export const isValidEmail = (e: string) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// Compared against when the email is unknown, so response time doesn't reveal which emails exist
let dummyHash: Promise<string> | null = null;
export const verifyAgainstDummy = async (password: string) => {
  dummyHash ??= hashPassword('not-a-real-password');
  await verifyPassword(password, await dummyHash);
  return false;
};

// ---- stateless signed session cookie: base64url(json).hmac ----
const secret = () => process.env.SESSION_SECRET || process.env.ADMIN_TOKEN || '';
const SESSION_DAYS = 30;

export const authConfigured = () => secret().length > 0;

export function signSession(userId: string): string {
  const body = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + SESSION_DAYS * 86_400_000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function readSession(value: string | undefined): string | null {
  if (!value || !authConfigured()) return null;
  const [body, sig] = value.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return typeof uid === 'string' && typeof exp === 'number' && exp > Date.now() ? uid : null;
  } catch {
    return null;
  }
}

/** First-run convenience: create the initial admin from ADMIN_EMAIL / ADMIN_PASSWORD when no admin exists yet. */
export async function bootstrapAdmin(): Promise<void> {
  const email = normalizeEmail(process.env.ADMIN_EMAIL);
  const password = process.env.ADMIN_PASSWORD ?? '';
  if (!email || !password) return;
  if ((await prisma.adminUser.count()) > 0) return;
  if (!isValidEmail(email) || password.length < MIN_PASSWORD_LENGTH) {
    console.error(`[admin] ADMIN_EMAIL/ADMIN_PASSWORD ignored: need a valid email and a password of at least ${MIN_PASSWORD_LENGTH} characters`);
    return;
  }
  await prisma.adminUser.create({
    data: { email, passwordHash: await hashPassword(password), workspaceId: 'default-workspace', role: 'owner', isSuperAdmin: true }
  });
  console.log(`[admin] created initial admin ${email}`);
}
