import type { BotConfig } from './botConfig';
import { translateText } from './gemini';
import { admitAiReply } from './usage';

/** Turns what the customer typed ("1", "hindi", "हिन्दी", "Tamil") into a language name, or null when it is not an answer. */
export function parseLanguage(input: string): string | null {
  const t = input.trim();
  if (!t || t.length > 30 || /[?\n]/.test(t)) return null;
  const lower = t.toLowerCase();
  if (/^(1|1\.|option 1|english|eng|en|इंग्लिश|अंग्रेज़ी|अंग्रेजी)$/.test(lower)) return 'English';
  if (/^(2|2\.|option 2|hindi|hin|हिन्दी|हिंदी|hindi\s*\(.*\))$/.test(lower)) return 'Hindi';
  // Anything else short is taken as a language name: "Tamil", "Telugu", "Malayalam", "Arabic"
  const cleaned = t.replace(/[^\p{L}\p{M} -]/gu, '').trim();
  if (cleaned.length < 2) return null;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

const cache = new Map<string, string>();
const CACHE_MAX = 800;

/**
 * Bot copy in the customer's language. English (or no choice) is returned untouched, and so is the original text if the
 * translation is not possible (no Gemini key, over the plan's AI allowance, or an error): the customer always gets a reply.
 */
export async function localize(cfg: BotConfig, body: string, language: string | null | undefined, capturing: boolean): Promise<string> {
  if (!cfg.ws.languageStep || !language || /^english$/i.test(language)) return body;
  const key = `${language}\u0000${body}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (!capturing && !(await admitAiReply(cfg.ws))) return body;
  const out = await translateText(body, language);
  if (!out) return body;
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, out);
  return out;
}
