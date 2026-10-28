import crypto from 'crypto';

/** Validates Meta's X-Hub-Signature-256 header ("sha256=<hex>") against the raw request body. */
export function verifySignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!rawBody || !header || !header.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const given = header.slice('sha256='.length);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(given, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
