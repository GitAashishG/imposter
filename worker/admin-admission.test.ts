import { describe, expect, test } from "bun:test";
import { AdminError, OAUTH_NONCE_MS } from "./admin-security";
import { admitFreshOAuthStart, OAUTH_FRESH_START_LIMIT, type OAuthStartRate } from "./admin-admission";

describe("anonymous OAuth flow admission", () => {
  test("one source cannot allocate the global nonce pool by dropping its cookies", () => {
    let rate: OAuthStartRate | null = null;
    for (let index = 0; index < OAUTH_FRESH_START_LIMIT; index++) rate = admitFreshOAuthStart(rate, "source-a", 1000 + index);
    const before = { ...rate! };
    expect(() => admitFreshOAuthStart(rate, "source-a", 2000)).toThrow(AdminError);
    try { admitFreshOAuthStart(rate, "source-a", 2000); } catch (error) { expect((error as AdminError).code).toBe("OAUTH_RATE_LIMITED"); }
    expect(rate).toEqual(before);
    expect(rate!.expires_at).toBe(1000 + OAUTH_NONCE_MS);
  });

  test("the exact window boundary resets only that source's allocation budget", () => {
    const full: OAuthStartRate = { ip_hash: "source-a", started_at: 1000, expires_at: 1000 + OAUTH_NONCE_MS, count: OAUTH_FRESH_START_LIMIT };
    expect(() => admitFreshOAuthStart(full, "source-a", full.expires_at - 1)).toThrow();
    const reset = admitFreshOAuthStart(full, "source-a", full.expires_at);
    expect(reset.count).toBe(1);
    expect(reset.started_at).toBe(full.expires_at);
    expect(reset.expires_at).toBe(full.expires_at + OAUTH_NONCE_MS);
    expect(admitFreshOAuthStart(full, "source-b", 2000).count).toBe(1);
  });
});
