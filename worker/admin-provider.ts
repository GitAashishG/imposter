import type { Env } from "./env";
import { AdminError, ownerIdentity, pkceChallenge } from "./admin-security";

export async function githubAuthorizationUrl(clientId: string, state: string, verifier: string, redirectUri: string): Promise<string> {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: "",
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: "S256",
    allow_signup: "false",
  }).toString();
  return url.href;
}

async function providerJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok || !response.body) throw new AdminError("OAUTH_FAILED", "GitHub sign-in could not be verified. Start again.", 502);
  const reader = response.body.getReader();
  const bytes = new Uint8Array(64 * 1024);
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (size + value.byteLength > bytes.byteLength) {
      await reader.cancel();
      throw new AdminError("OAUTH_FAILED", "GitHub sign-in could not be verified. Start again.", 502);
    }
    bytes.set(value, size);
    size += value.byteLength;
  }
  let result: unknown;
  try { result = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes.subarray(0, size))); }
  catch { throw new AdminError("OAUTH_FAILED", "GitHub sign-in could not be verified. Start again.", 502); }
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new AdminError("OAUTH_FAILED", "GitHub sign-in could not be verified. Start again.", 502);
  return result as Record<string, unknown>;
}

/** The access token is used only for this server-to-server identity request. */
export async function verifyGithubOwner(
  env: Env,
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<{ id: string; login: string }> {
  try {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "KoHo-Owner-Administration" },
      body: new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID!,
        client_secret: env.GITHUB_CLIENT_SECRET!,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        grant_type: "authorization_code",
      }).toString(),
    });
    const result = await providerJson(tokenResponse);
    if (typeof result.access_token !== "string" || !/^[\x21-\x7e]{1,4096}$/.test(result.access_token) ||
        typeof result.token_type !== "string" || result.token_type.toLowerCase() !== "bearer" ||
        (result.scope !== undefined && result.scope !== "")) {
      throw new AdminError("OAUTH_FAILED", "GitHub sign-in did not grant the expected identity-only access. Start again.", 502);
    }
    const identityResponse = await fetch("https://api.github.com/user", {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${result.access_token}`,
        "User-Agent": "KoHo-Owner-Administration",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    return ownerIdentity(await providerJson(identityResponse), env.ADMIN_GITHUB_USER_ID);
  } catch (error) {
    if (error instanceof AdminError) throw error;
    // Fetch errors may contain URLs or provider data; never propagate them.
    throw new AdminError("OAUTH_FAILED", "GitHub sign-in is temporarily unavailable. Start again.", 502);
  }
}
