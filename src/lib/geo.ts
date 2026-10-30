import { lookup } from 'geoip-country';

/** India pays in rupees; everyone else, and anyone we cannot place, in dollars. */
export type Region = 'IN' | 'OTHER';
export type Currency = 'INR' | 'USD';
export const currencyOf = (r: Region): Currency => (r === 'IN' ? 'INR' : 'USD');

type Headers = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** The visitor's address as the proxy in front of the app saw it (Traefik sets X-Real-Ip; Cloudflare, if ever used, sets CF-Connecting-IP). */
export function clientIp(headers: Headers, socketIp = ''): string {
  const candidates = [first(headers['cf-connecting-ip']), first(headers['x-real-ip']), first(headers['x-forwarded-for']).split(',')[0], socketIp];
  for (const c of candidates) {
    const ip = c.trim().replace(/^::ffff:/, '');
    if (ip) return ip;
  }
  return '';
}

/**
 * Two-letter country of the visitor, or null when unknown (private networks, anycast addresses and the like).
 * A country header from a proxy that already did the work (Cloudflare) wins; otherwise an offline database is used, so the
 * visitor's address never leaves our server.
 */
export function countryOf(headers: Headers, socketIp = ''): string | null {
  const header = first(headers['cf-ipcountry']).trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(header) && header !== 'XX' && header !== 'T1') return header;
  const ip = clientIp(headers, socketIp);
  if (!ip) return null;
  try {
    return lookup(ip)?.country ?? null;
  } catch {
    return null;
  }
}

const COOKIE = 'region';

/** What the visitor chose with a switch link, if anything: "?region=in" or "?region=world". */
export function chosenRegion(query: Record<string, unknown> | undefined, cookie: string | undefined): Region | null {
  const q = String(query?.region ?? '').toLowerCase();
  if (q === 'in' || q === 'india') return 'IN';
  if (q === 'world' || q === 'other' || q === 'usd') return 'OTHER';
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=(IN|OTHER)(?:;|$)`).exec(cookie ?? '');
  return (m?.[1] as Region | undefined) ?? null;
}

export interface Detected {
  region: Region;
  country: string | null;
  source: 'choice' | 'ip' | 'default';
  /** Set when the visitor just used a switch link, so the choice sticks */
  setCookie?: string;
}

export function detectRegion(headers: Headers, socketIp: string, query?: Record<string, unknown>): Detected {
  const country = countryOf(headers, socketIp);
  const picked = chosenRegion(query, first(headers.cookie));
  const justChose = chosenRegion(query, undefined);
  const setCookie = justChose ? `${COOKIE}=${justChose}; Path=/; Max-Age=31536000; SameSite=Lax; Secure` : undefined;
  if (picked) return { region: picked, country, source: 'choice', setCookie };
  if (country) return { region: country === 'IN' ? 'IN' : 'OTHER', country, source: 'ip' };
  return { region: 'OTHER', country: null, source: 'default' };
}
