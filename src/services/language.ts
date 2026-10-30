import type { BotConfig } from './botConfig';
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

/** Turns what the customer typed ("1", "hindi", "हिन्दी", "Tamil") into a language name, or null when it is not a known language. */
export function parseLanguage(input: string): string | null {
  const t = input.trim().toLowerCase().replace(/[.!,]+$/g, '').replace(/^(in|speak|i speak|i want|please|pls)\s+/g, '').trim();
  if (!t || t.length > 30) return null;
  if (/^(1|option 1)$/.test(t)) return 'English';
  if (/^(2|option 2)$/.test(t)) return 'Hindi';
  return LOOKUP.get(t) ?? null;
}

export const LANGUAGE_EXAMPLES = 'English, Hindi, Tamil, Telugu, Marathi, Bengali, Arabic, French';

/** Sent when the answer to the language question was not a language we recognise. */
export const languageHintMessage = () =>
  `Sorry, I did not catch that. Which language would you like to continue in? For example: ${LANGUAGE_EXAMPLES}. Just type the language name.`;

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
