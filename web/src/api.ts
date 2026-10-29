import type { AdminRow, AdminUser, ChatMessage, Contact, Overview, PatchBody, WaSnapshot } from './types';

export class UnauthorizedError extends Error {}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers ?? {}) }
  });
  if (res.status === 401 && !url.endsWith('/login')) throw new UnauthorizedError('unauthorized');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

const post = <T,>(url: string, body: unknown) => request<T>(url, { method: 'POST', body: JSON.stringify(body) });

export const api = {
  me: () => request<{ authed: boolean; user?: AdminUser }>('/admin/api/me'),
  login: (email: string, password: string) => post<{ ok: true; user: AdminUser }>('/admin/api/login', { email, password }),
  changePassword: (current: string, next: string) => post<{ ok: true }>('/admin/api/password', { current, next }),
  admins: () => request<{ admins: AdminRow[] }>('/admin/api/admins').then((r) => r.admins),
  addAdmin: (email: string, password: string) => post<{ admin: AdminUser }>('/admin/api/admins', { email, password }),
  removeAdmin: (id: string) => request<{ ok: true }>('/admin/api/admins/' + encodeURIComponent(id), { method: 'DELETE' }),
  logout: () => post<{ ok: true }>('/admin/api/logout', {}),
  whatsapp: () => request<WaSnapshot>('/admin/api/whatsapp'),
  whatsappConnect: () => post<WaSnapshot>('/admin/api/whatsapp/connect', {}),
  whatsappDisconnect: () => post<WaSnapshot>('/admin/api/whatsapp/disconnect', {}),
  overview: () => request<Overview>('/admin/api/overview'),
  contacts: (includeTest: boolean) =>
    request<{ contacts: Contact[] }>(`/admin/api/contacts${includeTest ? '?test=1' : ''}`).then((r) => r.contacts),
  messages: (phone: string) =>
    request<{ messages: ChatMessage[] }>(`/admin/api/contacts/${encodeURIComponent(phone)}/messages`).then((r) => r.messages),
  patch: (phone: string, body: PatchBody) =>
    request<{ contact: Contact }>(`/admin/api/contacts/${encodeURIComponent(phone)}`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    }).then((r) => r.contact),
  send: (phone: string, text: string) => post<{ ok: true }>(`/admin/api/contacts/${encodeURIComponent(phone)}/send`, { text }),
  simulate: (id: string, name: string, text: string) =>
    post<{ replies: string[]; state: { stage: string; service: string | null; step: number; totalSteps: number } }>(
      '/admin/api/simulate',
      { id, name, text }
    ),
  simulateReset: (id: string) => post<{ ok: true }>('/admin/api/simulate/reset', { id })
};
