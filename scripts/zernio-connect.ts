// Creates (or reuses) a Zernio profile and prints a connect link: npx tsx scripts/zernio-connect.ts [platform] [profile name]
import 'dotenv/config';
import { connectLink, createProfile, listProfiles, type ZernioPlatform } from '../src/services/zernio';

(async () => {
  const platform = (process.argv[2] || 'instagram') as ZernioPlatform;
  const name = process.argv[3] || 'Wappo';
  const existing = (await listProfiles()).profiles.find((p) => p.name === name);
  const created = existing ? null : await createProfile({ name, description: 'Wappo platform profile' });
  const profile = existing ?? created?.profile ?? (created as any);
  const id = profile?._id ?? profile?.id;
  console.log(existing ? 'profile (existing):' : 'profile (created):', id, name);
  if (!id) { console.log('unexpected response', JSON.stringify(created)); process.exit(1); }
  const link = await connectLink(platform, id);
  console.log(`connect link (${platform}):`, link.authUrl);
})().catch((e) => { console.error('failed:', e.message, e.data ? JSON.stringify(e.data) : ''); process.exit(1); });
