declare module 'geoip-country' {
  export function lookup(ip: string): { country: string; name?: string } | null;
}
