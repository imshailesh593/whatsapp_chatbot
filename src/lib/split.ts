/**
 * An owner's saved message may be sent as more than one WhatsApp message: "[split]" marks where the next one starts.
 * Everything else the bot says while handling one customer message is still merged into one (see batchReplies).
 * A "---" line is deliberately NOT a split: owners already use it as a paragraph break.
 */
export const SPLIT_MARK = '[split]';

/** More than this in a row reads like spam and raises the risk of the WhatsApp number being flagged. */
export const MAX_PARTS = 3;

const SPLIT_RE = /\s*\[split\]\s*/i;

/** The separate messages to send, in order; anything past the limit stays in the last one. */
export function splitMessage(text: string): string[] {
  const parts = text.split(new RegExp(SPLIT_RE, 'gi')).map((p) => p.trim()).filter(Boolean);
  if (parts.length <= MAX_PARTS) return parts;
  return [...parts.slice(0, MAX_PARTS - 1), parts.slice(MAX_PARTS - 1).join('\n\n')];
}

/** The same text as one message: for prompts, labels, comparisons, and anything the AI itself wrote. */
export const stripSplit = (text: string) => splitMessage(text).join(text.includes('\n') ? '\n\n' : ' ');

export const joinParts = (parts: string[], multiline = true) => parts.join(multiline ? `\n${SPLIT_MARK}\n` : ` ${SPLIT_MARK} `);
