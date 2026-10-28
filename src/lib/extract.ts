export interface InboundMessage {
  id: string;
  from: string;
  name?: string;
  text: string;
}

/** Flattens a Meta webhook payload into the text-like messages we can handle. */
export function extractMessages(body: any): InboundMessage[] {
  const out: InboundMessage[] = [];
  if (body?.object !== 'whatsapp_business_account') return out;

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      const value = change.value ?? {};
      const contacts: any[] = value.contacts ?? [];

      for (const message of value.messages ?? []) {
        let text = '';
        if (message.type === 'text') {
          text = message.text?.body ?? '';
        } else if (message.type === 'interactive') {
          text =
            message.interactive?.list_reply?.id ??
            message.interactive?.button_reply?.id ??
            message.interactive?.button_reply?.title ??
            '';
        } else if (message.type === 'button') {
          text = message.button?.text ?? '';
        }
        if (!message.from || !text) continue;

        const contact = contacts.find((c) => c.wa_id === message.from) ?? contacts[0];
        out.push({ id: message.id, from: message.from, name: contact?.profile?.name, text });
      }
    }
  }
  return out;
}
