import axios from 'axios';
import dotenv from 'dotenv';
import { SERVICE_MENU } from '../constants/questions';
dotenv.config();

const TOKEN = process.env.WHATSAPP_API_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const VERSION = process.env.GRAPH_API_VERSION || 'v21.0';

const client = axios.create({
  baseURL: `${process.env.GRAPH_API_BASE_URL || "https://graph.facebook.com"}/${VERSION}/${PHONE_ID}`,
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json'
  },
  timeout: 10000
});

async function post(to: string, body: Record<string, unknown>): Promise<void> {
  try {
    await client.post('/messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      ...body
    });
  } catch (error: any) {
    console.error(`[WhatsApp API Error] Failed to send message to ${to}:`, error.response?.data || error.message);
    throw error;
  }
}

export async function sendTextMessage(to: string, message: string): Promise<void> {
  await post(to, { type: 'text', text: { body: message, preview_url: true } });
}

/** Interactive list for service selection. Row ids "1".."5" match SERVICE_SELECTION_MAP. */
export async function sendServiceList(to: string, bodyText: string): Promise<void> {
  await post(to, {
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: 'MNS Career Services' },
      body: { text: bodyText.slice(0, 1024) },
      action: {
        button: 'Select Service',
        sections: [{ title: 'Services', rows: SERVICE_MENU }]
      }
    }
  });
}

export async function markAsRead(messageId: string): Promise<void> {
  try {
    await client.post('/messages', { messaging_product: 'whatsapp', status: 'read', message_id: messageId });
  } catch {
    // non-critical
  }
}
