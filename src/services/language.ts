import { DEFAULT_LANGUAGE_WELCOME, type BotConfig } from './botConfig';
import { translateText } from './gemini';
import { admitAiReply } from './usage';

// Languages a customer can ask for, by the names people actually type (English names and their own script).
// A reply that is not on this list is NOT taken as a language: a greeting like "Hy" or "Hey" must not turn the chat into Armenian.
const LANGUAGE_NAMES: Record<string, string[]> = {
  English: ['english', 'eng', 'इंग्लिश', 'अंग्रेज़ी', 'अंग्रेजी'],
  Hindi: ['hindi', 'हिन्दी', 'हिंदी'],
  Hinglish: ['hinglish'],
  Tamil: ['tamil', 'தமிழ்'],
  Telugu: ['telugu', 'తెలుగు'],
  Kannada: ['kannada', 'ಕನ್ನಡ'],
  Malayalam: ['malayalam', 'മലയാളം'],
  Marathi: ['marathi', 'मराठी'],
  Gujarati: ['gujarati', 'ગુજરાતી'],
  Bengali: ['bengali', 'bangla', 'বাংলা'],
  Punjabi: ['punjabi', 'panjabi', 'ਪੰਜਾਬੀ'],
  Urdu: ['urdu', 'اردو'],
  Odia: ['odia', 'oriya'],
  Assamese: ['assamese'],
  Nepali: ['nepali', 'नेपाली'],
  Sinhala: ['sinhala', 'sinhalese'],
  Arabic: ['arabic', 'العربية'],
  French: ['french', 'francais', 'français'],
  German: ['german', 'deutsch'],
  Spanish: ['spanish', 'espanol', 'español'],
  Portuguese: ['portuguese', 'portugues', 'português'],
  Italian: ['italian', 'italiano'],
  Dutch: ['dutch', 'nederlands'],
  Russian: ['russian', 'русский'],
  Ukrainian: ['ukrainian'],
  Armenian: ['armenian'],
  Turkish: ['turkish'],
  Persian: ['persian', 'farsi'],
  Chinese: ['chinese', 'mandarin', 'cantonese', '中文'],
  Japanese: ['japanese', '日本語'],
  Korean: ['korean', '한국어'],
  Indonesian: ['indonesian', 'bahasa indonesia'],
  Malay: ['malay', 'bahasa melayu'],
  Filipino: ['filipino', 'tagalog'],
  Thai: ['thai'],
  Vietnamese: ['vietnamese'],
  Swahili: ['swahili', 'kiswahili'],
  Greek: ['greek'],
  Polish: ['polish'],
  Romanian: ['romanian'],
  Hebrew: ['hebrew']
};
const LOOKUP = new Map<string, string>();
for (const [name, aliases] of Object.entries(LANGUAGE_NAMES)) for (const a of [name.toLowerCase(), ...aliases]) LOOKUP.set(a.toLowerCase(), name);

/** How each language is written on the choice list: its own script first, so people recognise it. */
const LABELS: Record<string, string> = {
  English: 'English',
  Hindi: 'हिन्दी (Hindi)',
  Hinglish: 'Hinglish (Hindi in English letters)',
  Tamil: 'தமிழ் (Tamil)',
  Malayalam: 'മലയാളം (Malayalam)',
  Telugu: 'తెలుగు (Telugu)',
  Kannada: 'ಕನ್ನಡ (Kannada)',
  Marathi: 'मराठी (Marathi)',
  Gujarati: 'ગુજરાતી (Gujarati)',
  Bengali: 'বাংলা (Bengali)',
  Punjabi: 'ਪੰਜਾਬੀ (Punjabi)',
  Urdu: 'اردو (Urdu)'
};
const NUM = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];

/** The languages a business offers, from its "languages" setting ("English, Hindi, Hinglish, Tamil, Malayalam"), in that order. At least two, at most nine. */
export function offeredLanguages(setting: string): string[] {
  const out: string[] = [];
  for (const part of setting.split(/[,/&]|\band\b/i)) {
    const name = LOOKUP.get(part.trim().toLowerCase().replace(/\s*only$/, ''));
    if (name && !out.includes(name)) out.push(name);
  }
  return out.length >= 2 ? out.slice(0, 9) : ['English', 'Hindi'];
}

/** The numbered choice list shown with the language question. */
export const languageOptionsText = (offered: string[]) => offered.map((l, i) => `${NUM[i]} ${LABELS[l] ?? l}`).join('\n');

/**
 * Turns what the customer typed ("3", "hindi", "हिन्दी", "Tamil") into a language name, or null when it is not one of the
 * languages offered. With no list, any known language is accepted and 1 and 2 mean English and Hindi.
 */
export function parseLanguage(input: string, offered?: string[]): string | null {
  const t = input.trim().toLowerCase().replace(/[.!,)]+$/g, '').replace(/^(in|speak|i speak|i want|please|pls|option)\s+/g, '').trim();
  if (!t || t.length > 30) return null;
  const list = offered ?? ['English', 'Hindi'];
  const digit = /^([1-9])$/.exec(t);
  if (digit) return list[Number(digit[1]) - 1] ?? null;
  const name = LOOKUP.get(t) ?? null;
  if (!name) return null;
  return offered && !offered.includes(name) ? null : name;
}

/** The first message of a workspace that asks the language first: the greeting, then the numbered choices. */
export function languagePrompt(cfg: BotConfig): string {
  const greeting = cfg.ws.languageWelcome.trim() || DEFAULT_LANGUAGE_WELCOME;
  return `${greeting}\n\n${languageOptionsText(offeredLanguages(cfg.ws.languages))}\n\nPlease reply with the number, or type the language name.`;
}

/** Sent when the answer to the language question was not one of the languages offered. */
export const languageHintMessage = (cfg: BotConfig) =>
  `Sorry, I did not catch that. Please choose your language:\n\n${languageOptionsText(offeredLanguages(cfg.ws.languages))}\n\nReply with the number, or type the language name.`;

/** After two misses the chat carries on in English instead of getting stuck. */
export const languageFallbackMessage = () => 'No problem, we will continue in English. Type *LANGUAGE* at any time to change it.';

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
