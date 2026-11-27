/** Minimal Zernio client (https://zernio.com/llms.txt). The API key is read from ZERNIO_API_KEY. */
const BASE = 'https://zernio.com/api/v1';

export const zernioConfigured = (): boolean => !!process.env.ZERNIO_API_KEY;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const key = process.env.ZERNIO_API_KEY;
  if (!key) throw new Error('ZERNIO_API_KEY is not set');
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000)
  });
  const text = await res.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 300) }; }
  if (!res.ok) throw Object.assign(new Error(data.error || data.message || `Zernio ${res.status}`), { status: res.status, data });
  return data as T;
}

export interface ZernioProfile { _id: string; name: string; description?: string; color?: string; externalId?: string; isDefault?: boolean }
export type ZernioPlatform = 'twitter' | 'instagram' | 'facebook' | 'youtube' | 'linkedin' | 'threads' | 'tiktok' | 'pinterest';

export const listProfiles = () => call<{ profiles: ZernioProfile[] }>('GET', '/profiles');

/** One profile per tenant: pass the workspace id as externalId so it can be looked up again. */
export const createProfile = (p: { name: string; description?: string; color?: string; externalId?: string }) =>
  call<{ profile?: ZernioProfile } & Partial<ZernioProfile>>('POST', '/profiles', p);

/** Returns the platform's OAuth URL; the user opens it to connect an account to the profile. */
export const connectLink = (platform: ZernioPlatform, profileId: string, redirectUrl?: string) =>
  call<{ authUrl: string; state: string }>(
    'GET',
    `/connect/${platform}?profileId=${encodeURIComponent(profileId)}${redirectUrl ? `&redirect_url=${encodeURIComponent(redirectUrl)}` : ''}`
  );

export interface ZernioAccount { _id: string; platform: string; profileId?: string; username?: string; displayName?: string; isActive?: boolean }

export const listAccounts = (profileId: string) => call<{ accounts: ZernioAccount[] }>('GET', `/accounts?profileId=${encodeURIComponent(profileId)}`);
export const deleteAccount = (accountId: string) => call<unknown>('DELETE', `/accounts/${encodeURIComponent(accountId)}`);

export const ZERNIO_PLATFORMS: ZernioPlatform[] = ['instagram', 'facebook', 'linkedin', 'youtube', 'tiktok', 'twitter', 'threads', 'pinterest'];

/** The workspace's Zernio profile id, creating the profile on first use (externalId makes this safe to race). */
export async function ensureProfile(workspaceId: string, name: string): Promise<string> {
  const { prisma } = await import('../lib/prisma');
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { zernioProfileId: true } });
  if (ws.zernioProfileId) return ws.zernioProfileId;
  let id = '';
  try {
    const r = await createProfile({ name: name.slice(0, 80), externalId: workspaceId });
    id = r.profile?._id ?? r._id ?? '';
  } catch (e) {
    if ((e as any).status !== 409) throw e;
    // adopt an existing profile only if it really was created for this workspace
    id = (await listProfiles()).profiles.find((p) => p.externalId === workspaceId)?._id ?? '';
    if (!id) throw e;
  }
  if (!id) throw new Error('Zernio did not return a profile id');
  await prisma.workspace.update({ where: { id: workspaceId }, data: { zernioProfileId: id } });
  return id;
}
