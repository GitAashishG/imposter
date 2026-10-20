import { AdminError, OAUTH_NONCE_MS } from "./admin-security";

export const OAUTH_FRESH_START_LIMIT = 8;
export const OAUTH_START_BUCKET_LIMIT = 256;

export interface OAuthStartRate {
  ip_hash: string;
  started_at: number;
  expires_at: number;
  count: number;
}

/** New browser flows allocate storage; renewing an existing browser flow does not. */
export function admitFreshOAuthStart(previous: OAuthStartRate | null, ipHash: string, now: number): OAuthStartRate {
  const current = previous?.ip_hash === ipHash && previous.expires_at > now ? previous : null;
  if (current && current.count >= OAUTH_FRESH_START_LIMIT) {
    throw new AdminError("OAUTH_RATE_LIMITED", "Too many new sign-in attempts from this network. Wait up to ten minutes, or continue an already-open sign-in flow.", 429);
  }
  return current ? { ...current, count: current.count + 1 } : { ip_hash: ipHash, started_at: now, expires_at: now + OAUTH_NONCE_MS, count: 1 };
}
