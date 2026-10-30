// Country detection from the visitor's address, and the rupee-or-dollar choice built on it. No database needed.
// Usage: npx tsx scripts/geo-test.ts
import { chosenRegion, clientIp, countryOf, currencyOf, detectRegion } from '../src/lib/geo';

const ok = (c: any, m: string) => { if (!c) throw new Error('FAIL: ' + m); console.log('  ok -', m); };

const IN_V4 = '49.36.1.1';
const IN_V6 = '2405:201::1';
const US = '8.8.8.8';

console.log('[the visitor\'s address]');
ok(clientIp({ 'x-real-ip': IN_V4 }, '10.0.1.6') === IN_V4, 'the proxy\'s real-IP header beats the proxy\'s own address');
ok(clientIp({ 'x-forwarded-for': `${US}, 10.0.1.6` }, '10.0.1.6') === US, 'the first address of a forwarded list is the visitor');
ok(clientIp({ 'cf-connecting-ip': IN_V4, 'x-real-ip': US }) === IN_V4, 'a Cloudflare header wins when present');
ok(clientIp({}, '::ffff:49.36.1.1') === '49.36.1.1', 'IPv4 written the IPv6 way is unwrapped');
ok(clientIp({}) === '', 'nothing known gives nothing');

console.log('\n[the country]');
ok(countryOf({ 'x-real-ip': IN_V4 }) === 'IN', 'an Indian address is India');
ok(countryOf({ 'x-real-ip': IN_V6 }) === 'IN', '...also over IPv6');
ok(countryOf({ 'x-real-ip': US }) === 'US', 'an American address is the United States');
ok(countryOf({ 'x-real-ip': '10.0.0.5' }) === null && countryOf({ 'x-real-ip': '127.0.0.1' }) === null && countryOf({ 'x-real-ip': '::1' }) === null, 'private and local addresses are unknown, not guessed');
ok(countryOf({ 'x-real-ip': 'not-an-address' }) === null, 'garbage is unknown, and never throws');
ok(countryOf({ 'cf-ipcountry': 'in', 'x-real-ip': US }) === 'IN', 'a country header from a proxy that already knows is trusted');
ok(countryOf({ 'cf-ipcountry': 'XX', 'x-real-ip': IN_V4 }) === 'IN' && countryOf({ 'cf-ipcountry': 'T1', 'x-real-ip': IN_V4 }) === 'IN', 'Cloudflare\'s "unknown" and "Tor" markers fall back to the address');

console.log('\n[rupees or dollars]');
ok(detectRegion({ 'x-real-ip': IN_V4 }, '10.0.1.6').region === 'IN' && currencyOf('IN') === 'INR', 'India sees rupees');
ok(detectRegion({ 'x-real-ip': US }, '10.0.1.6').region === 'OTHER' && currencyOf('OTHER') === 'USD', 'the United States sees dollars');
const unknown = detectRegion({}, '10.0.1.6');
ok(unknown.region === 'OTHER' && unknown.source === 'default' && unknown.country === null, 'an unknown visitor sees dollars');
ok(detectRegion({ 'x-real-ip': IN_V4 }, '').source === 'ip', 'the source is reported as the address');

console.log('\n[the visitor can switch]');
ok(chosenRegion({ region: 'world' }, undefined) === 'OTHER' && chosenRegion({ region: 'IN' }, undefined) === 'IN' && chosenRegion({ region: 'india' }, undefined) === 'IN' && chosenRegion({ region: 'usd' }, undefined) === 'OTHER', 'the switch links are understood');
ok(chosenRegion({}, 'a=1; region=IN; b=2') === 'IN' && chosenRegion({}, 'region=OTHER') === 'OTHER' && chosenRegion({}, 'region=bogus') === null && chosenRegion({}, undefined) === null, 'a remembered choice is read from the cookie, and junk is ignored');
const sw = detectRegion({ 'x-real-ip': IN_V4 }, '', { region: 'world' });
ok(sw.region === 'OTHER' && sw.source === 'choice' && sw.country === 'IN' && /^region=OTHER;/.test(sw.setCookie ?? '') && /SameSite=Lax/.test(sw.setCookie ?? '') && /Secure/.test(sw.setCookie ?? ''), 'choosing dollars from India overrides the address and sets a cookie');
const remembered = detectRegion({ 'x-real-ip': IN_V4, cookie: 'region=OTHER' }, '');
ok(remembered.region === 'OTHER' && remembered.source === 'choice' && remembered.setCookie === undefined, 'a remembered choice is respected without setting the cookie again');
ok(detectRegion({ 'x-real-ip': US }, '', { region: 'in' }).region === 'IN', 'a visitor abroad can choose rupees');
ok(detectRegion({ 'x-real-ip': IN_V4, cookie: 'region=OTHER' }, '', { region: 'in' }).region === 'IN', 'a new choice beats an old cookie');

console.log('\nGEO TESTS OK');
