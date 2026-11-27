/**
 * Where a customer is talking to us from. Chats are keyed by one id string per customer: a plain phone number for WhatsApp,
 * "ig:<id>" for Instagram and "fb:<id>" for Facebook Messenger (the ids Meta gives us are not phone numbers).
 */
export type Channel = 'whatsapp' | 'instagram' | 'messenger';

export const isSocial = (id: string) => id.startsWith('ig:') || id.startsWith('fb:');
export const channelOf = (id: string): Channel => (id.startsWith('ig:') ? 'instagram' : id.startsWith('fb:') ? 'messenger' : 'whatsapp');
export const channelLabel = (c: Channel) => (c === 'instagram' ? 'Instagram' : c === 'messenger' ? 'Facebook Messenger' : 'WhatsApp');

/** Who this is, for alerts and logs: "+9198..." for a phone, "Instagram user" / "Messenger user" otherwise. */
export const contactLabel = (id: string) => (/^\d+$/.test(id) ? `+${id}` : channelOf(id) === 'whatsapp' ? id : `${channelOf(id) === 'instagram' ? 'Instagram' : 'Messenger'} user`);
