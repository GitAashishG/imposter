import { PartyError } from "./model";

export function makeToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export async function hashSecret(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function hashToken(value: unknown): Promise<string> {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new PartyError(
      "SESSION_ENDED",
      "This player session has ended.",
      401,
    );
  }
  return hashSecret(value);
}

/** Every entry point uses this queue, including crypto awaits and alarm/storage awaits. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

export interface PinAttempt {
  key: string;
  startedAt: number;
  count: number;
}

export const PIN_WINDOW_MS = 10 * 60 * 1000;
const MAX_PIN_BUCKETS = 256;

/** Persisted, bounded failure buckets. Correct joins do not consume an attempt. */
export function checkPinThrottle(
  attempts: PinAttempt[],
  key: string,
  now: number,
): void {
  const active = attempts.filter(
    (attempt) => now - attempt.startedAt < PIN_WINDOW_MS,
  );
  if (
    active.some(
      (attempt) =>
        (attempt.key === key && attempt.count >= 20) ||
        (attempt.key === "global" && attempt.count >= 120),
    )
  ) {
    throw new PartyError(
      "PIN_THROTTLED",
      "Too many incorrect PINs. Please wait up to ten minutes and try again.",
      429,
    );
  }
}

export function recordWrongPin(
  attempts: PinAttempt[],
  key: string,
  now: number,
): PinAttempt[] {
  const active = attempts.filter(
    (attempt) => now - attempt.startedAt < PIN_WINDOW_MS,
  );
  for (const bucketKey of [key, "global"]) {
    const existing = active.find((attempt) => attempt.key === bucketKey);
    if (existing) existing.count += 1;
    else active.push({ key: bucketKey, startedAt: now, count: 1 });
  }
  while (active.length > MAX_PIN_BUCKETS) {
    const index = active.findIndex((attempt) => attempt.key !== "global");
    active.splice(index, 1);
  }
  return active;
}
