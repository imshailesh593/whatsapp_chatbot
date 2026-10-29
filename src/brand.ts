// Per-deployment branding. Everything customer-visible takes the business name from here, so the same
// build can serve any business by changing environment variables.
export const BUSINESS_NAME = process.env.BUSINESS_NAME || 'Your Business';
export const BUSINESS_TAGLINE = process.env.BUSINESS_TAGLINE || '';
// One or two sentences about what the business does; used in the Gemini system prompt.
export const BUSINESS_DESCRIPTION =
  process.env.BUSINESS_DESCRIPTION || 'a business that answers customer enquiries and qualifies leads over WhatsApp';
