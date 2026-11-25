import crypto from 'crypto';

/** Visitors leave a WhatsApp number to see prices; a signed cookie remembers that they did. */
export const PRICE_COOKIE = 'wp_price';
const DAYS = 365;
const secret = () => process.env.SESSION_SECRET || process.env.ADMIN_TOKEN || '';

export const cleanPhone = (v: unknown): string => String(v ?? '').replace(/\D/g, '');
export const validPhone = (digits: string): boolean => digits.length >= 8 && digits.length <= 15;

const sign = (body: string) => crypto.createHmac('sha256', secret()).update('price:' + body).digest('base64url');

export function priceToken(phone: string): string {
  const body = Buffer.from(JSON.stringify({ p: phone, exp: Date.now() + DAYS * 86_400_000 })).toString('base64url');
  return `${body}.${sign(body)}`;
}

/** True only for a cookie this server signed. With no secret configured nothing ever unlocks. */
export function pricesUnlocked(cookieHeader: string | undefined): boolean {
  if (!secret()) return false;
  const m = new RegExp(`(?:^|;\\s*)${PRICE_COOKIE}=([^;]+)`).exec(cookieHeader ?? '');
  if (!m) return false;
  const [body, sig] = m[1].split('.');
  if (!body || !sig) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}

export const priceCookie = (phone: string, secure: boolean) =>
  `${PRICE_COOKIE}=${priceToken(phone)}; Max-Age=${DAYS * 86400}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
