import crypto from 'crypto';
import { decryptToken, encryptToken } from './calendar';
import { getSetting, setSetting } from './settings';

/**
 * Keys the operator can set from the admin panel instead of editing the server .env. They are stored encrypted in the
 * database and copied into process.env at start-up and on every save, so the rest of the code keeps reading plain
 * environment variables. A value saved in the panel wins over the .env one; clearing it falls back to the .env.
 */
interface KeyDef {
  key: string;
  label: string;
  secret: boolean;
  /** Returns an error message, or null when the value is acceptable */
  check: (v: string) => string | null;
}

const prefix = (p: string, what: string) => (v: string) => (v.startsWith(p) ? null : `${what} should start with ${p}`);

export const MANAGED_KEYS: KeyDef[] = [
  { key: 'RAZORPAY_KEY_ID', label: 'Razorpay key id', secret: false, check: prefix('rzp_', 'The key id') },
  { key: 'RAZORPAY_KEY_SECRET', label: 'Razorpay key secret', secret: true, check: (v) => (v.length >= 10 ? null : 'That secret looks too short') },
  { key: 'RAZORPAY_WEBHOOK_SECRET', label: 'Razorpay webhook secret', secret: true, check: (v) => (v.length >= 8 ? null : 'The webhook secret must be at least 8 characters') },
  { key: 'RAZORPAY_PLAN_PRO', label: 'Razorpay plan id', secret: false, check: prefix('plan_', 'The plan id') },
  { key: 'RAZORPAY_MODE', label: 'Razorpay mode', secret: false, check: (v) => (['subscription', 'link'].includes(v) ? null : 'Mode must be subscription or link') },
  { key: 'PAYPAL_PLAN_PRO', label: 'PayPal plan id', secret: false, check: prefix('P-', 'The plan id') },
  { key: 'RESEND_API_KEY', label: 'Resend API key', secret: true, check: prefix('re_', 'The API key') },
  { key: 'MAIL_FROM', label: 'Email sender', secret: false, check: (v) => (/@/.test(v) && v.length <= 200 ? null : 'Use an address like: Wappo <hello@wappoai.com>') }
];

const STORE = 'runtimeConfig';
/** What the server .env held before the panel overrode it, so clearing a value restores it */
const original = new Map<string, string | undefined>();

const apply = (stored: Record<string, string>) => {
  for (const { key } of MANAGED_KEYS) {
    if (!original.has(key)) original.set(key, process.env[key]);
    const blob = stored[key];
    let value: string | undefined;
    if (blob) {
      try {
        value = decryptToken(blob);
      } catch {
        value = undefined; // secret changed: ignore what cannot be read
      }
    }
    // 'subscription' is the default mode: leave the variable unset
    if (key === 'RAZORPAY_MODE' && value === 'subscription') value = '';
    const next = value !== undefined ? value : original.get(key);
    if (next) process.env[key] = next;
    else delete process.env[key];
  }
};

/** Call once at start-up, before the first payment or email. */
export async function loadRuntimeConfig(): Promise<void> {
  apply(await getSetting<Record<string, string>>(STORE, {}));
}

/** Saves values (an empty string clears the panel value). Throws a readable Error for a bad value. */
export async function saveRuntimeConfig(patch: Record<string, unknown>): Promise<void> {
  const stored = { ...(await getSetting<Record<string, string>>(STORE, {})) };
  for (const [key, raw] of Object.entries(patch)) {
    const def = MANAGED_KEYS.find((k) => k.key === key);
    if (!def) throw new Error(`${key} cannot be changed here`);
    const value = String(raw ?? '').trim();
    if (!value) {
      delete stored[key];
      continue;
    }
    const problem = def.check(value);
    if (problem) throw new Error(problem);
    stored[key] = encryptToken(value);
  }
  await setSetting(STORE, stored);
  apply(stored);
}

export interface ConfigField {
  key: string;
  label: string;
  secret: boolean;
  set: boolean;
  /** Where the value in use comes from */
  source: 'panel' | 'server' | 'none';
  /** The value, or only its last four characters for a secret */
  preview: string;
}

export async function describeRuntimeConfig(): Promise<ConfigField[]> {
  const stored = await getSetting<Record<string, string>>(STORE, {});
  return MANAGED_KEYS.map((d) => {
    const value = process.env[d.key] ?? '';
    return {
      key: d.key,
      label: d.label,
      secret: d.secret,
      set: !!value,
      source: stored[d.key] ? 'panel' : value ? 'server' : 'none',
      preview: !value ? '' : d.secret ? `••••${value.slice(-4)}` : value
    };
  });
}

/** A fresh random webhook secret (Razorpay accepts any string you choose). */
export const newWebhookSecret = () => crypto.randomBytes(24).toString('base64url');
