import { isIP } from 'node:net';

/** Default host suffixes for GHL / LeadConnector media CDNs. */
const DEFAULT_ALLOWED_HOST_SUFFIXES = [
  'leadconnectorhq.com',
  'msgsndr.com',
  'highlevel.com',
  'ghl.io',
  'filesafe.space',
  'googleusercontent.com',
  'googleapis.com',
  'amazonaws.com',
  'cloudfront.net',
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
]);

function extraAllowedHostsFromEnv(): string[] {
  const raw = String(process.env['MEDIA_FETCH_ALLOWED_HOSTS'] ?? '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === '::1' || h === '::') return true;
  if (h.startsWith('fc') || h.startsWith('fd')) return true;
  if (h.startsWith('fe80:')) return true;
  return false;
}

function hostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host || BLOCKED_HOSTNAMES.has(host)) return false;
  if (host.endsWith('.localhost') || host.endsWith('.local')) return false;

  const ipKind = isIP(host);
  if (ipKind === 4) return !isPrivateIpv4(host);
  if (ipKind === 6) return !isPrivateIpv6(host);

  const extras = extraAllowedHostsFromEnv();
  const suffixes = [...DEFAULT_ALLOWED_HOST_SUFFIXES, ...extras];
  return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export type MediaFetchUrlValidation =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

/** Validate an outbound media URL before server-side fetch (SSRF guard). */
export function validateMediaFetchUrl(rawUrl: string): MediaFetchUrlValidation {
  const trimmed = rawUrl.trim();
  if (!trimmed) return { ok: false, reason: 'empty_url' };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: 'unsupported_protocol' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'credentials_in_url' };
  }

  if (!hostAllowed(parsed.hostname)) {
    return { ok: false, reason: 'host_not_allowed' };
  }

  return { ok: true, url: parsed };
}
