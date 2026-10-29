import type { AuditEntry, PlatformDetail, PlatformOverview, LeadEventInfo, AnalyticsData, ApiKeyInfo, IntegrationsInfo, WebhookInfo, BroadcastInfo, StageDef, BillingInfo, AdminRow, AdminUser, ChatMessage, ChatTurn, Contact, Draft, Overview, PatchBody, PlatformWorkspace, ServiceDef, TemplateInfo, WaSnapshot, Workspace } from './types';

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
  signup: (businessName: string, email: string, password: string) =>
    post<{ ok: true; user: AdminUser }>('/admin/api/signup', { businessName, email, password }),
  changePassword: (current: string, next: string) => post<{ ok: true }>('/admin/api/password', { current, next }),
  admins: () => request<{ admins: AdminRow[] }>('/admin/api/admins').then((r) => r.admins),
  addAdmin: (email: string, password: string, role: 'admin' | 'agent') => post<{ admin: { id: string; email: string } }>('/admin/api/admins', { email, password, role }),
  removeAdmin: (id: string) => request<{ ok: true }>('/admin/api/admins/' + encodeURIComponent(id), { method: 'DELETE' }),
  logout: () => post<{ ok: true }>('/admin/api/logout', {}),
  whatsapp: () => request<WaSnapshot>('/admin/api/whatsapp'),
  whatsappConnect: () => post<WaSnapshot>('/admin/api/whatsapp/connect', {}),
  whatsappDisconnect: () => post<WaSnapshot>('/admin/api/whatsapp/disconnect', {}),
  overview: () => request<Overview>('/admin/api/overview'),
  saveStages: (stages: StageDef[]) => request<{ stages: StageDef[] }>('/admin/api/stages', { method: 'PUT', body: JSON.stringify({ stages }) }).then((r) => r.stages),
  broadcasts: () => request<{ broadcasts: BroadcastInfo[] }>('/admin/api/broadcasts').then((r) => r.broadcasts),
  audience: (filters: unknown) => post<{ count: number; sample: { name: string | null; phone: string }[] }>('/admin/api/broadcasts/audience', { filters }),
  createBroadcast: (body: unknown) => post<{ broadcast: BroadcastInfo }>('/admin/api/broadcasts', body),
  broadcastAction: (id: string, action: string) => post<{ broadcast: BroadcastInfo }>(`/admin/api/broadcasts/${encodeURIComponent(id)}/${action}`, {}),
  integrations: () => request<IntegrationsInfo>('/admin/api/integrations'),
  createWebhook: (url: string, events: string[]) => post<{ webhook: WebhookInfo }>('/admin/api/webhooks', { url, events }),
  patchWebhook: (id: string, body: { active?: boolean; events?: string[] }) => request<{ webhook: WebhookInfo }>(`/admin/api/webhooks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteWebhook: (id: string) => request<{ ok: true }>(`/admin/api/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  testWebhook: (id: string) => post<{ status: string; responseCode: number | null; error: string }>(`/admin/api/webhooks/${encodeURIComponent(id)}/test`, {}),
  deliveries: (id: string) => request<{ deliveries: { id: string; event: string; status: string; attempts: number; responseCode: number | null; error: string; at: string }[] }>(`/admin/api/webhooks/${encodeURIComponent(id)}/deliveries`).then((r) => r.deliveries),
  createApiKey: (name: string) => post<{ key: string; apiKey: ApiKeyInfo }>('/admin/api/api-keys', { name }),
  deleteApiKey: (id: string) => request<{ ok: true }>(`/admin/api/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  chatLinkQr: (url: string) => post<{ qr: string }>('/admin/api/chat-link/qr', { url }),
  analytics: (days: number) => request<AnalyticsData>(`/admin/api/analytics?days=${days}`),
  leadEvents: (phone: string) => request<{ events: LeadEventInfo[] }>(`/admin/api/contacts/${encodeURIComponent(phone)}/events`).then((r) => r.events),
  alertInfo: () => request<{ emailAvailable: boolean; whatsappReady: boolean }>('/admin/api/alerts'),
  testAlert: () => post<{ whatsapp: string; email: string }>('/admin/api/alerts/test', {}),
  billing: () => request<BillingInfo>('/admin/api/billing'),
  checkout: (plan: string, provider: 'stripe' | 'razorpay') => post<{ url: string }>('/admin/api/billing/checkout', { plan, provider }),
  billingPortal: () => post<{ url: string }>('/admin/api/billing/portal', {}),
  cancelSubscription: () => post<{ ok: true }>('/admin/api/billing/cancel', {}),
  platformOverview: () => request<PlatformOverview>('/admin/api/super/overview'),
  platformDetail: (id: string) => request<PlatformDetail>(`/admin/api/super/workspaces/${encodeURIComponent(id)}`),
  platformCreate: (body: { businessName: string; email: string; password: string; plan: string; days: number }) => post<{ id: string }>('/admin/api/super/workspaces', body),
  platformDelete: (id: string, confirm: string) => post<{ ok: true }>(`/admin/api/super/workspaces/${encodeURIComponent(id)}/delete`, { confirm }),
  platformImpersonate: (id: string) => post<{ ok: true }>(`/admin/api/super/workspaces/${encodeURIComponent(id)}/impersonate`, {}),
  platformResetPassword: (userId: string, password: string) => post<{ ok: true }>(`/admin/api/super/users/${encodeURIComponent(userId)}/password`, { password }),
  platformRemoveUser: (userId: string) => request<{ ok: true }>(`/admin/api/super/users/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  platformAudit: () => request<{ entries: AuditEntry[] }>('/admin/api/super/audit').then((r) => r.entries),
  platformPlan: (id: string, plan: string, days: number) => post<{ ok: true }>(`/admin/api/super/workspaces/${encodeURIComponent(id)}/plan`, { plan, days }),
  saveWorkspace: (body: Partial<Workspace>) => request<{ workspace: Workspace }>('/admin/api/workspace', { method: 'PUT', body: JSON.stringify(body) }).then((r) => r.workspace),
  saveServices: (services: ServiceDef[]) => request<{ services: unknown }>('/admin/api/services', { method: 'PUT', body: JSON.stringify({ services }) }),
  templates: () => request<{ templates: TemplateInfo[] }>('/admin/api/templates').then((r) => r.templates),
  applyTemplate: (id: string) => post<{ workspace: Workspace }>('/admin/api/templates/apply', { id }).then((r) => r.workspace),
  setLive: (enabled: boolean) => post<{ workspace: Workspace }>('/admin/api/workspace/live', { enabled }).then((r) => r.workspace),
  onboardingInfo: () => request<{ aiAvailable: boolean; completed: boolean; businessName: string }>('/admin/api/onboarding'),
  onboardingChat: (history: ChatTurn[], draft: Draft | null) => post<{ reply: string; draft: Draft | null }>('/admin/api/onboarding/chat', { history, draft }),
  onboardingApply: (draft: Draft, extras: Partial<Workspace>) => post<{ workspace: Workspace }>('/admin/api/onboarding/apply', { draft, extras }).then((r) => r.workspace),
  onboardingComplete: () => post<{ workspace: Workspace }>('/admin/api/onboarding/complete', {}).then((r) => r.workspace),
  platformWorkspaces: () => request<{ workspaces: PlatformWorkspace[] }>('/admin/api/super/workspaces').then((r) => r.workspaces),
  platformBot: (id: string, enabled: boolean) => post<{ ok: true }>(`/admin/api/super/workspaces/${encodeURIComponent(id)}/bot`, { enabled }),
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
